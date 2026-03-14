import { useState, useEffect, useCallback, useRef } from "react";
import { AgentCard } from "@/components/AgentCard";
import { MemoryCard } from "@/components/MemoryCard";
import { SortableCardGrid } from "@/components/SortableCardGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LayoutGrid, TableIcon, Eraser, Network, Users, Plus, X, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import { listMemories, refreshMemory, deleteMemory, purgeMemory } from "@/api/memories";
import { listTagPolicies } from "@/api/settings";
import { ApiError } from "@/api/client";
import type { AgentResponse, MemoryResponse, TagPolicy } from "@/api/types";

interface CatalogPageProps {
  agents: AgentResponse[];
  loading: boolean;
  viewMode: "cards" | "table";
  onViewModeChange: (mode: "cards" | "table") => void;
  onSelectAgent: (id: number) => void;
  onRefreshAgent: (id: number) => void;
  onDelete: (id: number, cleanupAws: boolean) => void;
  readOnly?: boolean;
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
}: CatalogPageProps) {
  const { timezone } = useTimezone();
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [cleanupAws, setCleanupAws] = useState(false);

  // Tag filter state
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>({});

  useEffect(() => {
    void listTagPolicies().then(setTagPolicies).catch(() => {});
  }, []);

  const showOnCardPolicies = tagPolicies.filter(tp => tp.show_on_card);
  const showOnCardKeys = showOnCardPolicies.map(tp => tp.key);

  // R3: Progressive disclosure filtering
  const requiredPolicies = showOnCardPolicies.filter(tp => tp.key.startsWith("loom:"));
  const customFilterPolicies = showOnCardPolicies.filter(tp => !tp.key.startsWith("loom:"));
  const [activeCustomFilterKeys, setActiveCustomFilterKeys] = useState<string[]>([]);
  const activePolicies = [...requiredPolicies, ...customFilterPolicies.filter(p => activeCustomFilterKeys.includes(p.key))];

  // R4: Custom tag show/hide toggle
  const [showCustomTags, setShowCustomTags] = useState(() => localStorage.getItem("loom:showCustomTags") !== "false");
  const effectiveShowOnCardKeys = showCustomTags ? showOnCardKeys : showOnCardKeys.filter(k => k.startsWith("loom:"));

  const filteredAgents = agents.filter(agent => {
    return Object.entries(tagFilters).every(([key, values]) => {
      if (values.length === 0) return true;
      return values.includes(agent.tags?.[key] ?? "");
    });
  });

  // Memory data
  const [memories, setMemories] = useState<MemoryResponse[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [deleteStartTimes, setDeleteStartTimes] = useState<Record<number, number>>({});

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
      {showOnCardPolicies.length > 0 && agents.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {activePolicies.map(tp => {
            const isCustom = !tp.key.startsWith("loom:");
            const distinctValues = [...new Set(
              agents.map(a => a.tags?.[tp.key]).filter(Boolean)
            )] as string[];
            if (distinctValues.length === 0) return null;
            return (
              <div key={tp.key} className="space-y-1">
                <div className="flex items-center gap-1">
                  <label className="text-[10px] text-muted-foreground">{tp.key.replace(/^loom:/, "")}</label>
                  {isCustom && (
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
                  )}
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
              <label className="text-[10px] text-muted-foreground">&nbsp;</label>
              <Select value="" onValueChange={(v) => setActiveCustomFilterKeys(prev => [...prev, v])}>
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <div className="flex items-center gap-1">
                    <Plus className="h-3 w-3" />
                    <span>Add filter</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {customFilterPolicies
                    .filter(p => !activeCustomFilterKeys.includes(p.key))
                    .map(p => (
                      <SelectItem key={p.key} value={p.key}>{p.key}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
          <div className="space-y-1">
            <label className="block text-[10px] text-muted-foreground">custom</label>
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
          <span className="text-xs text-muted-foreground ml-auto self-end">
            Showing {filteredAgents.length} of {agents.length} agents
          </span>
        </div>
      )}

      {/* Agents Section */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Agents</h3>

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
                storageKey="catalog-agents"
                renderItem={(agent) => (
                  <AgentCard
                    agent={agent}
                    onSelect={onSelectAgent}
                    onRefresh={onRefreshAgent}
                    onDelete={onDelete}
                    readOnly={readOnly}
                    showOnCardKeys={effectiveShowOnCardKeys}
                  />
                )}
              />
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-card hover:bg-card">
                      <TableHead>Name</TableHead>
                      <TableHead className="w-[160px]">Status</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Registered</TableHead>
                      <TableHead className="w-[60px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAgents.map((agent) => (
                      <TableRow
                        key={agent.id}
                        className="relative bg-input-bg hover:bg-input-bg/80 cursor-pointer"
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
                        <TableCell>
                          {!readOnly && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(agent.id);
                              }}
                              title="Delete"
                            >
                              <Eraser className="h-3 w-3" />
                            </Button>
                          )}
                          {confirmDeleteId === agent.id && (
                            <div
                              className="absolute inset-x-0 bottom-0 rounded-b-lg border-t bg-card px-4 py-2 space-y-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {agent.runtime_id && (
                                <label className="flex items-end justify-end gap-2 cursor-pointer select-none">
                                  <span className="text-[11px] whitespace-nowrap">Also delete in AgentCore</span>
                                  <input
                                    type="checkbox"
                                    checked={cleanupAws}
                                    onChange={(e) => setCleanupAws(e.target.checked)}
                                    className="h-3.5 w-3.5 shrink-0 mb-0.5"
                                  />
                                </label>
                              )}
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-xs text-muted-foreground mr-auto">
                                  Delete this agent?
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs"
                                  onClick={() => { setConfirmDeleteId(null); setCleanupAws(false); }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-6 text-xs"
                                  onClick={() => {
                                    onDelete(agent.id, cleanupAws);
                                    setConfirmDeleteId(null);
                                    setCleanupAws(false);
                                  }}
                                >
                                  Confirm
                                </Button>
                              </div>
                            </div>
                          )}
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
        <h3 className="text-sm font-medium">Memory Resources</h3>

        {memoriesLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : memories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8">
            No memory resources. Use the Memory page to create or import one.
          </p>
        ) : viewMode === "cards" ? (
          <SortableCardGrid
            items={memories}
            getId={(m) => String(m.id)}
            storageKey="catalog-memories"
            renderItem={(mem) => (
              <MemoryCard
                memory={mem}
                now={now}
                refreshingId={refreshingId}
                submitting={submitting}
                onRefresh={handleMemoryRefresh}
                onDelete={handleMemoryDelete}
                readOnly={readOnly}
                showOnCardKeys={showOnCardKeys}
                deleteStartTime={deleteStartTimes[mem.id]}
              />
            )}
          />
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-card hover:bg-card">
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[160px]">Status</TableHead>
                  <TableHead>Strategies</TableHead>
                  <TableHead>Event Expiry</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memories.map((mem) => (
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
        <h3 className="text-sm font-medium">MCP Servers</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Network className="h-4 w-4" />
          <span className="italic">Coming soon</span>
        </div>
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
