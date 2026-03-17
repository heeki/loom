import { useState, useEffect, useCallback, useRef } from "react";
import { AgentCard } from "@/components/AgentCard";
import { MemoryCard } from "@/components/MemoryCard";
import { SortableCardGrid, SortButton, loadSortDirection, toggleSortDirection, saveSortDirection, type SortDirection } from "@/components/SortableCardGrid";
import { SortableTableHead, sortRows } from "@/components/SortableTableHead";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelect } from "@/components/ui/multi-select";
import { AddFilterDropdown } from "@/components/ui/add-filter-dropdown";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LayoutGrid, TableIcon, Users, X, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import { listMemories, refreshMemory, deleteMemory, purgeMemory } from "@/api/memories";
import { listMcpServers } from "@/api/mcp";
import { listTagPolicies } from "@/api/settings";
import { ApiError } from "@/api/client";
import type { AgentResponse, MemoryResponse, McpServer, TagPolicy } from "@/api/types";

interface CatalogPageProps {
  agents: AgentResponse[];
  loading: boolean;
  viewMode: "cards" | "table";
  onViewModeChange: (mode: "cards" | "table") => void;
  onSelectAgent: (id: number) => void;
  onRefreshAgent: (id: number) => void;
  onDelete: (id: number, cleanupAws: boolean) => void;
  readOnly?: boolean;
  agentDeleteStartTimes?: Record<number, number>;
}

export function CatalogPage({
  agents,
  loading,
  viewMode,
  onViewModeChange,
  onSelectAgent,
  onRefreshAgent,
  onDelete,
  readOnly,
  agentDeleteStartTimes,
}: CatalogPageProps) {
  const { timezone } = useTimezone();
  // Tag filter state
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("loom:tagFilters:catalog") || "{}") as Record<string, string[]>; } catch { return {}; }
  });

  useEffect(() => {
    void listTagPolicies().then(setTagPolicies).catch(() => {});
  }, []);

  const showOnCardPolicies = tagPolicies.filter(tp => tp.show_on_card);
  const showOnCardKeys = showOnCardPolicies.map(tp => tp.key);

  // R3: Progressive disclosure filtering
  const requiredPolicies = showOnCardPolicies.filter(tp => tp.required);
  const customFilterPolicies = showOnCardPolicies.filter(tp => !tp.required);
  const [activeCustomFilterKeys, setActiveCustomFilterKeys] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("loom:customFilterKeys:catalog") || "[]") as string[]; } catch { return []; }
  });

  // Persist filter state to localStorage
  useEffect(() => { localStorage.setItem("loom:tagFilters:catalog", JSON.stringify(tagFilters)); }, [tagFilters]);
  useEffect(() => { localStorage.setItem("loom:customFilterKeys:catalog", JSON.stringify(activeCustomFilterKeys)); }, [activeCustomFilterKeys]);

  // R4: Custom tag show/hide toggle
  const [showCustomTags, setShowCustomTags] = useState(() => localStorage.getItem("loom:showCustomTags") !== "false");
  const requiredKeySet = new Set(requiredPolicies.map(tp => tp.key));
  const effectiveShowOnCardKeys = showCustomTags ? showOnCardKeys : showOnCardKeys.filter(k => requiredKeySet.has(k));

  const matchesFilters = (tags: Record<string, string> | undefined) => {
    return Object.entries(tagFilters).every(([key, values]) => {
      if (values.length === 0) return true;
      return values.includes(tags?.[key] ?? "");
    });
  };

  const [agentSortDir, setAgentSortDir] = useState<SortDirection>(() => loadSortDirection("catalog-agents"));
  const [memorySortDir, setMemorySortDir] = useState<SortDirection>(() => loadSortDirection("catalog-memories"));
  const [mcpSortDir, setMcpSortDir] = useState<SortDirection>(() => loadSortDirection("catalog-mcp"));
  const [agentTableCol, setAgentTableCol] = useState<string | null>("name");
  const [agentTableDir, setAgentTableDir] = useState<SortDirection>("asc");
  const [memoryTableCol, setMemoryTableCol] = useState<string | null>("name");
  const [memoryTableDir, setMemoryTableDir] = useState<SortDirection>("asc");
  const [mcpTableCol, setMcpTableCol] = useState<string | null>("name");
  const [mcpTableDir, setMcpTableDir] = useState<SortDirection>("asc");

  const handleAgentTableSort = (col: string) => {
    if (agentTableCol === col) {
      setAgentTableDir(agentTableDir === "asc" ? "desc" : "asc");
    } else {
      setAgentTableCol(col);
      setAgentTableDir("asc");
    }
  };
  const handleMemoryTableSort = (col: string) => {
    if (memoryTableCol === col) {
      setMemoryTableDir(memoryTableDir === "asc" ? "desc" : "asc");
    } else {
      setMemoryTableCol(col);
      setMemoryTableDir("asc");
    }
  };
  const handleMcpTableSort = (col: string) => {
    if (mcpTableCol === col) {
      setMcpTableDir(mcpTableDir === "asc" ? "desc" : "asc");
    } else {
      setMcpTableCol(col);
      setMcpTableDir("asc");
    }
  };

  const filteredAgents = agents.filter(agent => matchesFilters(agent.tags));

  // MCP server data
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);

  const fetchMcpData = useCallback(async () => {
    try {
      const data = await listMcpServers();
      setMcpServers(data);
    } catch {
      // silently ignore
    } finally {
      setMcpLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMcpData();
  }, [fetchMcpData]);

  // Memory data
  const [memories, setMemories] = useState<MemoryResponse[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [deleteStartTimes, setDeleteStartTimes] = useState<Record<number, number>>({});
  const filteredMemories = memories.filter(mem => matchesFilters(mem.tags));

  // Elapsed timer for transitional states
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;

  const fetchMemoryData = useCallback(async () => {
    try {
      const data = await listMemories();
      setMemories(data);
    } catch {
      // silently ignore
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMemoryData();
  }, [fetchMemoryData]);

  // 1-second tick for elapsed display, 3-second poll for AWS status
  useEffect(() => {
    const hasTransitional = memories.some(
      (m) => m.status === "CREATING" || m.status === "DELETING",
    );

    if (!hasTransitional) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setNow(Date.now());
      }, 1000);
    }

    if (!pollRef.current) {
      pollRef.current = setInterval(async () => {
        const current = memoriesRef.current;
        const transitional = current.filter(
          (m) => m.status === "CREATING" || m.status === "DELETING",
        );
        for (const mem of transitional) {
          try {
            const updated = await refreshMemory(mem.id);
            setMemories((prev) => prev.map((m) => (m.id === mem.id ? updated : m)));
          } catch (e) {
            if (mem.status === "DELETING" && e instanceof ApiError && e.status === 404) {
              try {
                await purgeMemory(mem.id);
              } catch {
                // ignore cleanup errors
              }
              setMemories((prev) => prev.filter((m) => m.id !== mem.id));
              toast.success("Memory resource deleted");
            }
          }
        }
      }, 3000);
    }

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [memories.map((m) => `${m.id}:${m.status}`).join(",")]);

  const handleMemoryRefresh = async (id: number) => {
    setRefreshingId(id);
    try {
      const updated = await refreshMemory(id);
      setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)));
      toast.success("Memory status refreshed");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Failed to refresh memory");
    } finally {
      setRefreshingId(null);
    }
  };

  const handleMemoryDelete = async (id: number, deleteInAws: boolean) => {
    setSubmitting(true);
    try {
      const updated = await deleteMemory(id, deleteInAws);
      if (updated.status === "DELETING") {
        setDeleteStartTimes((prev) => ({ ...prev, [id]: Date.now() }));
        setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)));
        toast.success("Memory deletion initiated");
      } else {
        setMemories((prev) => prev.filter((m) => m.id !== id));
        toast.success(deleteInAws ? "Memory resource deleted" : "Memory removed from Loom");
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Failed to delete memory");
    } finally {
      setSubmitting(false);
    }
  };



  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Platform Catalog</h2>
          <p className="text-sm text-muted-foreground">Browse and manage registered agents and resources.</p>
        </div>
        <div className="flex rounded-md border text-sm shrink-0" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "cards"}
            className={`px-2 py-1 rounded-l-md transition-colors ${viewMode === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            onClick={() => onViewModeChange("cards")}
            title="Card view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "table"}
            className={`px-2 py-1 rounded-r-md transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            onClick={() => onViewModeChange("table")}
            title="Table view"
          >
            <TableIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Tag Filters */}
      {showOnCardPolicies.length > 0 && (agents.length > 0 || memories.length > 0) && (
        <div className="flex flex-wrap items-end gap-3">
          {requiredPolicies.map(tp => {
            const distinctValues = [...new Set([
              ...agents.map(a => a.tags?.[tp.key]).filter(Boolean),
              ...memories.map(m => m.tags?.[tp.key]).filter(Boolean),
            ])] as string[];
            if (distinctValues.length === 0) return null;
            return (
              <div key={tp.key} className="space-y-1">
                <div className="h-4 flex items-center">
                  <label className="text-[10px] text-muted-foreground">{tp.key.replace(/^loom:/, "")}</label>
                </div>
                <MultiSelect
                  values={tagFilters[tp.key] ?? []}
                  options={distinctValues.sort()}
                  onChange={(v) => setTagFilters(prev => ({ ...prev, [tp.key]: v }))}
                />
              </div>
            );
          })}
          <div className="space-y-1">
            <div className="h-4 flex items-center">
              <label className="text-[10px] text-muted-foreground">custom</label>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-[2.25rem] p-0 bg-input-bg"
              onClick={() => {
                const next = !showCustomTags;
                setShowCustomTags(next);
                localStorage.setItem("loom:showCustomTags", String(next));
              }}
              title={showCustomTags ? "Hide custom tags" : "Show custom tags"}
            >
              {showCustomTags ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {customFilterPolicies.filter(p => activeCustomFilterKeys.includes(p.key)).map(tp => {
            const distinctValues = [...new Set([
              ...agents.map(a => a.tags?.[tp.key]).filter(Boolean),
              ...memories.map(m => m.tags?.[tp.key]).filter(Boolean),
            ])] as string[];
            return (
              <div key={tp.key} className="space-y-1">
                <div className="h-4 flex items-center gap-1">
                  <label className="text-[10px] text-muted-foreground">{tp.key}</label>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setActiveCustomFilterKeys(prev => prev.filter(k => k !== tp.key));
                      setTagFilters(prev => {
                        const next = { ...prev };
                        delete next[tp.key];
                        return next;
                      });
                    }}
                    title="Remove filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <MultiSelect
                  values={tagFilters[tp.key] ?? []}
                  options={distinctValues.sort()}
                  onChange={(v) => setTagFilters(prev => ({ ...prev, [tp.key]: v }))}
                />
              </div>
            );
          })}
          {customFilterPolicies.filter(p => !activeCustomFilterKeys.includes(p.key)).length > 0 && (
            <div className="space-y-1">
              <div className="h-4 flex items-center">
                <label className="text-[10px] text-muted-foreground">custom filters</label>
              </div>
              <AddFilterDropdown
                options={customFilterPolicies
                  .filter(p => !activeCustomFilterKeys.includes(p.key))
                  .map(p => ({ key: p.key, label: p.key }))}
                onSelect={(v) => setActiveCustomFilterKeys(prev => [...prev, v])}
              />
            </div>
          )}
          {(Object.values(tagFilters).some(v => v.length > 0) || activeCustomFilterKeys.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs self-end"
              onClick={() => { setTagFilters({}); setActiveCustomFilterKeys([]); }}
            >
              Clear filters
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto self-end">
            Showing {filteredAgents.length} of {agents.length} agents, {filteredMemories.length} of {memories.length} memories
          </span>
        </div>
      )}

      {/* Agents Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Agents</h3>
          <SortButton direction={agentSortDir} onClick={() => setAgentSortDir(toggleSortDirection("catalog-agents", agentSortDir))} />
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {agents.length === 0
              ? "No agents registered. Use the Builder page to register or deploy an agent."
              : "No agents match the selected filters."}
          </p>
        ) : (
          <>
            {viewMode === "cards" ? (
              <SortableCardGrid
                items={filteredAgents}
                getId={(a) => String(a.id)}
                getName={(a) => a.name ?? a.runtime_id ?? ""}
                storageKey="catalog-agents"
                sortDirection={agentSortDir}
                onSortDirectionChange={(d) => { if (d) { setAgentSortDir(d); saveSortDirection("catalog-agents", d); } }}
                renderItem={(agent) => (
                  <AgentCard
                    agent={agent}
                    onSelect={onSelectAgent}
                    onRefresh={onRefreshAgent}
                    onDelete={onDelete}
                    readOnly={readOnly}
                    showOnCardKeys={effectiveShowOnCardKeys}
                    deleteStartTime={agentDeleteStartTimes?.[agent.id]}
                  />
                )}
              />
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-card hover:bg-card">
                      <SortableTableHead column="name" activeColumn={agentTableCol} direction={agentTableDir} onSort={handleAgentTableSort} className="w-[30%]">Name</SortableTableHead>
                      <SortableTableHead column="status" activeColumn={agentTableCol} direction={agentTableDir} onSort={handleAgentTableSort} className="w-[12%]">Status</SortableTableHead>
                      <SortableTableHead column="protocol" activeColumn={agentTableCol} direction={agentTableDir} onSort={handleAgentTableSort} className="w-[14%]">Protocol</SortableTableHead>
                      <SortableTableHead column="network" activeColumn={agentTableCol} direction={agentTableDir} onSort={handleAgentTableSort} className="w-[14%]">Network</SortableTableHead>
                      <SortableTableHead column="region" activeColumn={agentTableCol} direction={agentTableDir} onSort={handleAgentTableSort} className="w-[14%]">Region</SortableTableHead>
                      <SortableTableHead column="registered" activeColumn={agentTableCol} direction={agentTableDir} onSort={handleAgentTableSort} className="w-[16%]">Registered</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortRows(filteredAgents, agentTableCol, agentTableDir, {
                      name: (a) => a.name ?? a.runtime_id ?? "",
                      status: (a) => a.status ?? "",
                      protocol: (a) => a.protocol ?? "",
                      network: (a) => a.network_mode ?? "",
                      region: (a) => a.region ?? "",
                      registered: (a) => a.registered_at ?? "",
                    }).map((agent) => (
                      <TableRow
                        key={agent.id}
                        className="bg-input-bg hover:bg-input-bg/80 cursor-pointer"
                        onClick={() => onSelectAgent(agent.id)}
                      >
                        <TableCell className="font-medium text-sm">
                          {agent.name ?? agent.runtime_id}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(agent.status)} className="text-[10px] px-1.5 py-0">
                            {agent.status ?? "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {agent.protocol ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {agent.network_mode ?? "\u2014"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{agent.region}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatTimestamp(agent.registered_at, timezone)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </section>

      {/* Memory Resources Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Memory Resources</h3>
          <SortButton direction={memorySortDir} onClick={() => setMemorySortDir(toggleSortDirection("catalog-memories", memorySortDir))} />
        </div>

        {memoriesLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : filteredMemories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">
            {memories.length === 0
              ? "No memory resources. Use the Memory page to create or import one."
              : "No memory resources match the selected filters."}
          </p>
        ) : viewMode === "cards" ? (
          <SortableCardGrid
            items={filteredMemories}
            getId={(m) => String(m.id)}
            getName={(m) => m.name}
            storageKey="catalog-memories"
            sortDirection={memorySortDir}
            onSortDirectionChange={(d) => { if (d) { setMemorySortDir(d); saveSortDirection("catalog-memories", d); } }}
            renderItem={(mem) => (
              <MemoryCard
                memory={mem}
                now={now}
                refreshingId={refreshingId}
                submitting={submitting}
                onRefresh={handleMemoryRefresh}
                onDelete={handleMemoryDelete}
                readOnly={readOnly}
                showOnCardKeys={effectiveShowOnCardKeys}
                deleteStartTime={deleteStartTimes[mem.id]}
              />
            )}
          />
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-card hover:bg-card">
                  <SortableTableHead column="name" activeColumn={memoryTableCol} direction={memoryTableDir} onSort={handleMemoryTableSort} className="w-[30%]">Name</SortableTableHead>
                  <SortableTableHead column="status" activeColumn={memoryTableCol} direction={memoryTableDir} onSort={handleMemoryTableSort} className="w-[12%]">Status</SortableTableHead>
                  <SortableTableHead column="strategies" activeColumn={memoryTableCol} direction={memoryTableDir} onSort={handleMemoryTableSort} className="w-[14%]">Strategies</SortableTableHead>
                  <SortableTableHead column="expiry" activeColumn={memoryTableCol} direction={memoryTableDir} onSort={handleMemoryTableSort} className="w-[14%]">Event Expiry</SortableTableHead>
                  <SortableTableHead column="region" activeColumn={memoryTableCol} direction={memoryTableDir} onSort={handleMemoryTableSort} className="w-[14%]">Region</SortableTableHead>
                  <SortableTableHead column="registered" activeColumn={memoryTableCol} direction={memoryTableDir} onSort={handleMemoryTableSort} className="w-[16%]">Registered</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortRows(filteredMemories, memoryTableCol, memoryTableDir, {
                  name: (m) => m.name,
                  status: (m) => m.status,
                  strategies: (m) => Array.isArray(m.strategies_config) ? m.strategies_config.length : Array.isArray(m.strategies_response) ? m.strategies_response.length : 0,
                  expiry: (m) => m.event_expiry_duration,
                  region: (m) => m.region ?? "",
                  registered: (m) => m.created_at ?? "",
                }).map((mem) => (
                  <TableRow key={mem.id} className="bg-input-bg hover:bg-input-bg/80">
                    <TableCell className="font-medium text-sm">{mem.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(mem.status)} className="text-[10px] px-1.5 py-0">
                        {mem.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Array.isArray(mem.strategies_config) ? mem.strategies_config.length : Array.isArray(mem.strategies_response) ? mem.strategies_response.length : 0}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {mem.event_expiry_duration}d
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{mem.region}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTimestamp(mem.created_at, timezone)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* MCP Servers Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">MCP Servers</h3>
          <SortButton direction={mcpSortDir} onClick={() => setMcpSortDir(toggleSortDirection("catalog-mcp", mcpSortDir))} />
        </div>

        {mcpLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : mcpServers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">
            No MCP servers registered. Use the MCP Servers page to register one.
          </p>
        ) : viewMode === "cards" ? (
          <SortableCardGrid
            items={mcpServers}
            getId={(s) => String(s.id)}
            getName={(s) => s.name}
            storageKey="catalog-mcp"
            sortDirection={mcpSortDir}
            onSortDirectionChange={(d) => { if (d) { setMcpSortDir(d); saveSortDirection("catalog-mcp", d); } }}
            renderItem={(server) => (
              <Card className="py-3 gap-1">
                <CardHeader className="gap-0 pb-2">
                  <div className="text-sm font-medium truncate" title={server.name}>
                    {server.name}
                  </div>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <div className="rounded border bg-input-bg p-3 space-y-0.5">
                    <div className="truncate" title={server.endpoint_url}><span className="text-muted-foreground/70">Endpoint:</span> {server.endpoint_url}</div>
                    <div><span className="text-muted-foreground/70">Transport:</span> {server.transport_type === "streamable_http" ? "Streamable HTTP" : "SSE"}</div>
                    <div><span className="text-muted-foreground/70">Authentication:</span> {server.auth_type === "oauth2" ? "OAuth2" : "None"}</div>
                    {server.created_at && (
                      <div><span className="text-muted-foreground/70">Created:</span> {formatTimestamp(server.created_at, timezone)}</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          />
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-card hover:bg-card">
                  <SortableTableHead column="name" activeColumn={mcpTableCol} direction={mcpTableDir} onSort={handleMcpTableSort} className="w-[25%]">Name</SortableTableHead>
                  <SortableTableHead column="endpoint" activeColumn={mcpTableCol} direction={mcpTableDir} onSort={handleMcpTableSort} className="w-[32%]">Endpoint</SortableTableHead>
                  <SortableTableHead column="transport" activeColumn={mcpTableCol} direction={mcpTableDir} onSort={handleMcpTableSort} className="w-[15%]">Transport</SortableTableHead>
                  <SortableTableHead column="auth" activeColumn={mcpTableCol} direction={mcpTableDir} onSort={handleMcpTableSort} className="w-[12%]">Auth</SortableTableHead>
                  <SortableTableHead column="created" activeColumn={mcpTableCol} direction={mcpTableDir} onSort={handleMcpTableSort} className="w-[16%]">Created</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortRows(mcpServers, mcpTableCol, mcpTableDir, {
                  name: (s) => s.name,
                  endpoint: (s) => s.endpoint_url,
                  transport: (s) => s.transport_type,
                  auth: (s) => s.auth_type,
                  created: (s) => s.created_at ?? "",
                }).map((server) => (
                  <TableRow key={server.id} className="bg-input-bg hover:bg-input-bg/80">
                    <TableCell className="font-medium text-sm">{server.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate">{server.endpoint_url}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{server.transport_type === "streamable_http" ? "Streamable HTTP" : "SSE"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{server.auth_type === "oauth2" ? "OAuth2" : "None"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTimestamp(server.created_at, timezone)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* A2A Agents Section */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">A2A Agents</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Users className="h-4 w-4" />
          <span className="italic">Coming soon</span>
        </div>
      </section>
    </div>
  );
}
