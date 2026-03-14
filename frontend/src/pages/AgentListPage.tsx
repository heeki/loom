import { useState, useEffect } from "react";
import { Plus, LayoutGrid, TableIcon, Network, Users, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MultiSelect } from "@/components/ui/multi-select";
import { AddFilterDropdown } from "@/components/ui/add-filter-dropdown";
import { AgentRegistrationForm } from "@/components/AgentRegistrationForm";
import { AgentCard } from "@/components/AgentCard";
import { SortableCardGrid } from "@/components/SortableCardGrid";
import { toast } from "sonner";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import { statusVariant } from "@/lib/status";
import { listTagPolicies } from "@/api/settings";
import type { AgentDeployRequest, AgentResponse, TagPolicy } from "@/api/types";

type BuilderTab = "register" | "deploy";

interface AgentListPageProps {
  agents: AgentResponse[];
  loading: boolean;
  viewMode: "cards" | "table";
  onViewModeChange: (mode: "cards" | "table") => void;
  onRegister: (arn: string, modelId?: string) => Promise<unknown>;
  onDeploy?: (request: AgentDeployRequest) => Promise<unknown>;
  onSelectAgent: (id: number) => void;
  onRefreshAgent: (id: number) => void;
  onFetchAgents?: () => void;
  onDelete: (id: number, cleanupAws: boolean) => void;
  readOnly?: boolean;
}

export function AgentListPage({
  agents,
  loading,
  viewMode,
  onViewModeChange,
  onRegister,
  onDeploy,
  onSelectAgent,
  onRefreshAgent,
  onFetchAgents,
  onDelete,
  readOnly,
}: AgentListPageProps) {
  const { timezone } = useTimezone();
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<BuilderTab>("deploy");
  const [showAddForm, setShowAddForm] = useState(false);
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("loom:tagFilters:agents") || "{}") as Record<string, string[]>; } catch { return {}; }
  });
  const [deployingName, setDeployingName] = useState<string | null>(null);

  useEffect(() => {
    void listTagPolicies().then(setTagPolicies).catch(() => {});
  }, []);

  // Clear deployingName once the real agents list contains it and it's no longer transitional
  useEffect(() => {
    if (deployingName) {
      const real = agents.find((a) => a.name === deployingName);
      if (real && real.status !== "CREATING" && real.endpoint_status !== "CREATING" && real.deployment_status !== "deploying") {
        setDeployingName(null);
      }
    }
  }, [agents, deployingName]);

  // Immediate fetch to pick up the new DB record; useAgents handles ongoing polling
  useEffect(() => {
    if (deployingName && onFetchAgents) {
      onFetchAgents();
    }
  }, [deployingName, onFetchAgents]);

  const showOnCardPolicies = tagPolicies.filter(tp => tp.show_on_card);
  const showOnCardKeys = showOnCardPolicies.map(tp => tp.key);

  // R3: Progressive disclosure filtering
  const requiredPolicies = showOnCardPolicies.filter(tp => tp.required);
  const customPolicies = showOnCardPolicies.filter(tp => !tp.required);
  const [activeCustomFilterKeys, setActiveCustomFilterKeys] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("loom:customFilterKeys:agents") || "[]") as string[]; } catch { return []; }
  });
  const activePolicies = [...requiredPolicies, ...customPolicies.filter(p => activeCustomFilterKeys.includes(p.key))];

  // Persist filter state to localStorage
  useEffect(() => { localStorage.setItem("loom:tagFilters:agents", JSON.stringify(tagFilters)); }, [tagFilters]);
  useEffect(() => { localStorage.setItem("loom:customFilterKeys:agents", JSON.stringify(activeCustomFilterKeys)); }, [activeCustomFilterKeys]);

  // R4: Custom tag show/hide toggle
  const [showCustomTags, setShowCustomTags] = useState(() => localStorage.getItem("loom:showCustomTags") !== "false");
  const requiredKeySet = new Set(requiredPolicies.map(tp => tp.key));
  const effectiveShowOnCardKeys = showCustomTags ? showOnCardKeys : showOnCardKeys.filter(k => requiredKeySet.has(k));

  const filteredAgents = agents.filter(agent => {
    return Object.entries(tagFilters).every(([key, values]) => {
      if (values.length === 0) return true;
      return values.includes(agent.tags?.[key] ?? "");
    });
  });

  const handleRegister = async (arn: string, modelId?: string) => {
    setSubmitting(true);
    try {
      await onRegister(arn, modelId);
      setShowAddForm(false);
      toast.success("Agent registered");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeploy = async (request: AgentDeployRequest) => {
    if (!onDeploy) return;

    // Immediately collapse form and start polling
    setDeployingName(request.name);
    setShowAddForm(false);
    toast.success("Agent deployment started");

    // Fire deploy in the background
    void onDeploy(request).catch((e) => {
      toast.error(e instanceof Error ? e.message : "Deployment failed");
      setDeployingName(null);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Agent Administration</h2>
          <p className="text-sm text-muted-foreground">Deploy new agents or import existing ones.</p>
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

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Agents</h3>
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">
              {"An agent can be deployed directly from here.\nAn agent that was previously created can also be imported here."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 ml-4"
            onClick={() => setShowAddForm(!showAddForm)}
            disabled={readOnly}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Agent
          </Button>
        </div>

        {showAddForm && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex rounded-md border text-sm w-fit" role="tablist">
                {(["deploy", "register"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`px-4 py-1.5 transition-colors ${
                      tab === "deploy" ? "rounded-l-md" : "rounded-r-md"
                    } ${
                      activeTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === "deploy" ? "Deploy" : "Import"}
                  </button>
                ))}
              </div>

              <AgentRegistrationForm
                mode={activeTab}
                onRegister={handleRegister}
                onDeploy={onDeploy ? handleDeploy : undefined}
                isLoading={submitting}
              />
            </CardContent>
          </Card>
        )}

        {/* Tag Filters */}
        {showOnCardPolicies.length > 0 && agents.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            {activePolicies.map(tp => {
              const isCustom = !tp.required;
              const distinctValues = [...new Set(
                agents.map(a => a.tags?.[tp.key]).filter(Boolean)
              )] as string[];
              if (distinctValues.length === 0 && !isCustom) return null;
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
            {customPolicies.filter(p => !activeCustomFilterKeys.includes(p.key)).length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">custom filters</label>
                <AddFilterDropdown
                  options={customPolicies
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
              Showing {filteredAgents.length} of {agents.length} agents
            </span>
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : filteredAgents.length === 0 && !deployingName ? (
          <p className="text-sm text-muted-foreground py-8">
            {agents.length === 0
              ? "No agents yet. Add one above."
              : "No agents match the selected filters."}
          </p>
        ) : (
          <>
            {viewMode === "cards" ? (
              <SortableCardGrid
                items={filteredAgents}
                getId={(a) => String(a.id)}
                storageKey="builder-agents"
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
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-card hover:bg-card">
                      <TableHead className="w-[30%]">Name</TableHead>
                      <TableHead className="w-[12%]">Status</TableHead>
                      <TableHead className="w-[14%]">Protocol</TableHead>
                      <TableHead className="w-[14%]">Network</TableHead>
                      <TableHead className="w-[14%]">Region</TableHead>
                      <TableHead className="w-[16%]">Registered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAgents.map((agent) => (
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
      </div>

      <section className="space-y-3 pt-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Additional Configuration</h4>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Network className="h-3.5 w-3.5" />
            <span>MCP Servers</span>
            <span className="text-[10px] italic">Coming soon</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            <span>A2A Agents</span>
            <span className="text-[10px] italic">Coming soon</span>
          </div>
        </div>
      </section>
    </div>
  );
}
