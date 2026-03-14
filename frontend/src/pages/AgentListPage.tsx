import { useState, useEffect } from "react";
import { Plus, LayoutGrid, TableIcon, Eraser, Network, Users } from "lucide-react";
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [cleanupAws, setCleanupAws] = useState(false);
  const [tagPolicies, setTagPolicies] = useState<TagPolicy[]>([]);
  const [tagFilters, setTagFilters] = useState<Record<string, string[]>>({});
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
          <div className="flex flex-wrap items-center gap-3">
            {showOnCardPolicies.map(tp => {
              const distinctValues = [...new Set(
                agents.map(a => a.tags?.[tp.key]).filter(Boolean)
              )] as string[];
              if (distinctValues.length === 0) return null;
              return (
                <div key={tp.key} className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">{tp.key.replace(/^loom:/, "")}</label>
                  <MultiSelect
                    values={tagFilters[tp.key] ?? []}
                    options={distinctValues.sort()}
                    onChange={(v) => setTagFilters(prev => ({ ...prev, [tp.key]: v }))}
                  />
                </div>
              );
            })}
            {Object.values(tagFilters).some(v => v.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setTagFilters({})}
              >
                Clear filters
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
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
                    showOnCardKeys={showOnCardKeys}
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
