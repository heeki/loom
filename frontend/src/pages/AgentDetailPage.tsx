import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Key, Pencil, Check, X, Wrench } from "lucide-react";
import { fetchModels } from "@/api/agents";
import type { ModelOption } from "@/api/types";
import { groupModels } from "@/lib/models";
import ReactMarkdown from "react-markdown";
import { CollapsibleJsonBlock } from "@/components/CollapsibleJsonBlock";
import remarkGfm from "remark-gfm";
import { InvokePanel } from "@/components/InvokePanel";
import { LatencySummary } from "@/components/LatencySummary";
import { SessionTable } from "@/components/SessionTable";
import { DeploymentPanel } from "@/components/DeploymentPanel";
import { RegistryStatusBadge } from "@/components/RegistryStatusBadge";
import { RegistryActions } from "@/components/RegistryActions";
import { ExternalIntegrationSection } from "@/components/ExternalIntegrationSection";
import { useInvoke } from "@/hooks/useInvoke";
import { useAuth } from "@/contexts/AuthContext";
import { trackAction } from "@/api/audit";
import type { AgentResponse, SessionResponse } from "@/api/types";

interface AgentDetailPageProps {
  agent: AgentResponse;
  sessions: SessionResponse[];
  sessionsLoading: boolean;
  onSelectSession: (sessionId: string) => void;
  onSessionsRefresh: () => void;
  onRedeploy?: (id: number) => Promise<void>;
  onPatchAgent?: (id: number, updates: { description?: string | null; model_id?: string; allowed_model_ids?: string[] }) => Promise<AgentResponse>;
  onRefreshAgents?: () => void;
  canInvoke?: boolean;
  registryReadOnly?: boolean;
  registryEnabled?: boolean;
  userGroups?: string[];
}

export function AgentDetailPage({
  agent,
  sessions,
  sessionsLoading,
  onSelectSession,
  onSessionsRefresh,
  onRedeploy,
  onPatchAgent,
  onRefreshAgents,
  canInvoke = true,
  registryReadOnly,
  registryEnabled = false,
  userGroups = [],
}: AgentDetailPageProps) {
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  const handleEditDescription = () => {
    setDescriptionDraft(agent.description ?? "");
    setEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    if (!onPatchAgent) return;
    setSavingDescription(true);
    try {
      await onPatchAgent(agent.id, { description: descriptionDraft.trim() || null });
      setEditingDescription(false);
    } finally {
      setSavingDescription(false);
    }
  };

  const handleCancelDescription = () => {
    setEditingDescription(false);
  };

  // Check if user can invoke this specific agent based on group tags
  const agentGroup = agent.tags?.["loom:group"] || "";
  const isSuperAdmin = userGroups.includes("g-admins-super");
  const isAdmin = userGroups.includes("t-admin");

  // Build allowed groups by stripping prefixes from group names
  let allowedGroups: string[] = [];
  if (isAdmin && !isSuperAdmin) {
    // Non-super admins: strip "g-admins-" prefix
    allowedGroups = userGroups
      .filter(g => g.startsWith("g-admins-"))
      .map(g => g.replace("g-admins-", ""));
  } else if (!isAdmin) {
    // Users: strip "g-users-" prefix
    allowedGroups = userGroups
      .filter(g => g.startsWith("g-users-"))
      .map(g => g.replace("g-users-", ""));
  }

  // Check if agent group matches any of the user's allowed groups
  const canInvokeThisAgent = isSuperAdmin || !agentGroup || allowedGroups.includes(agentGroup);
  const effectiveCanInvoke = canInvoke && canInvokeThisAgent;
  const { user, browserSessionId, authConfig } = useAuth();
  const { streamedText, segments, sessionStart, sessionEnd, isStreaming, error, rawError, invoke, cancel } =
    useInvoke(agent.id, agent.authorizer_config?.name ?? undefined);

  const handleInvoke = async (prompt: string, qualifier: string, sessionId?: string, credentialId?: number, bearerToken?: string, modelId?: string, connectorIds?: number[], useLinkedToken?: boolean) => {
    if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, 'agent', 'invoke', agent.name ?? agent.runtime_id ?? String(agent.id));
    await invoke(prompt, qualifier, sessionId, credentialId, bearerToken, modelId, connectorIds, useLinkedToken);
    onSessionsRefresh();
  };

  const isDeployed = agent.source === "deploy" || agent.source === "harness";

  return (
    <Tabs defaultValue="details" className="space-y-4">
      <TabsList>
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="invoke">Invoke</TabsTrigger>
      </TabsList>

      {/* Details tab: Overview + External Integration */}
      <TabsContent value="details" className="space-y-4">
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">Overview</CardTitle>
              {agent.source === "harness" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">MANAGED</Badge>
              )}
              {agent.source === "deploy" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">CUSTOM</Badge>
              )}
              <RegistryStatusBadge status={agent.registry_status} showUnregistered={registryEnabled} registryEnabled={registryEnabled} />
              {!registryReadOnly && registryEnabled && (
                <RegistryActions
                  resourceType="agent"
                  resourceId={agent.id}
                  registryRecordId={agent.registry_record_id}
                  registryStatus={agent.registry_status}
                  onAction={() => onRefreshAgents?.()}
                />
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-1 text-xs text-muted-foreground">
            {editingDescription ? (
              <div className="space-y-2">
                <Textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  placeholder="Describe what this agent does..."
                  className="text-xs resize-none"
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button size="sm" className="h-6 text-xs" onClick={() => void handleSaveDescription()} disabled={savingDescription}>
                    <Check className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleCancelDescription} disabled={savingDescription}>
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="font-medium shrink-0">Description:</span>
                <span>{agent.description ?? <span className="italic">No description set.</span>}</span>
                {onPatchAgent && (
                  <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={handleEditDescription}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
            {isDeployed && (
              <div>
                <DeploymentPanel
                  agent={agent}
                  onRedeploy={onRedeploy ?? (async () => {})}
                  onPatchAgent={onPatchAgent}
                />
              </div>
            )}
            {!isDeployed && agent.model_id && onPatchAgent && (
              <div className="pt-2">
                <RegisteredAgentModelConfig agent={agent} onPatchAgent={onPatchAgent} />
              </div>
            )}
          </CardContent>
        </Card>

        {agent.status === "READY" && (agent.deployment_status === "deployed" || isDeployed) && (
          <ExternalIntegrationSection agentId={agent.id} />
        )}
      </TabsContent>

      {/* Invoke tab: Sessions + Invoke form + Response */}
      <TabsContent value="invoke" className="space-y-4">
        <section>
          <SessionTable
            sessions={sessions}
            onSelectSession={onSelectSession}
            loading={sessionsLoading}
            currentUserId={user?.username ?? user?.sub}
          />
        </section>

        {effectiveCanInvoke ? (
          <InvokePanel
            agentId={agent.id}
            qualifiers={agent.available_qualifiers}
            sessions={sessions}
            isStreaming={isStreaming}
            modelId={agent.model_id}
            allowedModelIds={agent.allowed_model_ids}
            authorizerName={agent.authorizer_config?.name}
            authorizerPoolId={agent.authorizer_config?.pool_id}
            authorizerDiscoveryUrl={agent.authorizer_config?.discovery_url}
            isExternalIdp={Boolean(authConfig?.provider_type && authConfig.provider_type !== "cognito")}
            loginIssuerUrl={authConfig?.issuer_url}
            currentUserId={user?.username ?? user?.sub}
            onInvoke={handleInvoke}
            onCancel={cancel}
          />
        ) : (
          <Card className="border-muted-foreground/20">
            <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {!canInvoke ? (
                <>
                  <p>You don't have permission to invoke agents.</p>
                  <p className="text-xs mt-1">Contact your administrator for the <code className="px-1 py-0.5 rounded bg-muted">invoke</code> scope.</p>
                </>
              ) : (
                <>
                  <p>This agent is in the <code className="px-1 py-0.5 rounded bg-muted">{agentGroup}</code> group.</p>
                  <p className="text-xs mt-1">You can only invoke agents in your assigned groups.</p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {sessionEnd && <LatencySummary sessionEnd={sessionEnd} />}

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-4 text-sm text-destructive space-y-2">
              <p>{error}</p>
              {rawError && rawError !== error && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Show details
                  </summary>
                  <pre className="mt-1 p-2 rounded bg-muted text-muted-foreground whitespace-pre-wrap font-mono text-xs">
                    {rawError}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {(streamedText || isStreaming || sessionStart) && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium">Response</CardTitle>
                {sessionStart && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {sessionStart.session_id}
                  </Badge>
                )}
                {sessionStart?.has_token && (
                  <Badge variant="outline" className="border-border bg-input-bg text-xs gap-1">
                    <Key className="h-3 w-3" />
                    {sessionStart.token_source ?? "token"}
                  </Badge>
                )}
                {isStreaming && (
                  <Badge variant="secondary" className="animate-pulse">
                    streaming
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isStreaming && segments.length === 0 && (
                <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span>Thinking…</span>
                </div>
              )}
              <div className="rounded border bg-input-bg p-4 text-sm">
                {(() => {
                  const blocks: React.ReactNode[] = [];
                  let toolGroup: { name: string; index: number; total: number; timestamp: number }[] = [];
                  let toolGroupStart = 0;
                  const flushTools = () => {
                    if (toolGroup.length > 0) {
                      const lastIdx = toolGroupStart + toolGroup.length - 1;
                      const active = isStreaming && lastIdx === segments.length - 1;
                      blocks.push(<ToolUseBlock key={`tools-${toolGroupStart}`} tools={toolGroup} isActive={active} />);
                      toolGroup = [];
                    }
                  };
                  segments.forEach((seg, i) => {
                    if (seg.type === "tool_use") {
                      if (toolGroup.length === 0) toolGroupStart = i;
                      toolGroup.push({ name: seg.name, index: seg.index, total: seg.total, timestamp: seg.timestamp });
                    } else {
                      flushTools();
                      blocks.push(<MarkdownBlock key={i} text={seg.content} />);
                    }
                  });
                  flushTools();
                  return blocks;
                })()}
                {isStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}

function formatToolName(raw: string): string {
  const parts = raw.split("___");
  return parts.length > 1 ? parts.slice(1).join(" / ") : raw;
}

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="leading-snug">{children}</li>,
  pre: ({ children }: { children?: React.ReactNode }) => {
    const codeClass = (children as { props?: { className?: string } } | null)?.props?.className ?? "";
    if (codeClass.includes("language-json")) {
      return <CollapsibleJsonBlock>{children}</CollapsibleJsonBlock>;
    }
    return <pre className="mb-2 overflow-x-auto rounded bg-black/10 dark:bg-white/10 p-3 text-xs font-mono">{children}</pre>;
  },
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) =>
    className?.startsWith("language-") ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-xs font-mono">{children}</code>
    ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground mb-2">{children}</blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto mb-2"><table className="border-collapse text-xs w-full">{children}</table></div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead>{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold bg-muted/50">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {text}
    </ReactMarkdown>
  );
}

function ElapsedTimer({ since }: { since: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(Math.floor((Date.now() - since) / 1000));
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span className="tabular-nums">({elapsed}s)</span>;
}

function ToolUseBlock({ tools, isActive }: { tools: { name: string; index: number; total: number; timestamp: number }[]; isActive: boolean }) {
  const last = tools[tools.length - 1]!;
  return (
    <div className="py-1.5 my-1 text-xs text-muted-foreground border-l-2 border-muted-foreground/30 pl-2 space-y-0.5">
      <div className="flex items-center gap-1.5">
        <Wrench className="h-3 w-3 shrink-0" />
        <span>Tool calls ({last.index}/{last.total}):</span>
        {isActive && (
          <>
            <ElapsedTimer since={last.timestamp} />
            <span className="flex gap-0.5 ml-0.5">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
              <span className="h-1 w-1 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
            </span>
          </>
        )}
      </div>
      {tools.map((t, i) => (
        <div key={i} className="pl-[18px] font-medium text-foreground/70">{formatToolName(t.name)}</div>
      ))}
    </div>
  );
}

function RegisteredAgentModelConfig({ agent, onPatchAgent }: {
  agent: AgentResponse;
  onPatchAgent: (id: number, updates: { model_id?: string; allowed_model_ids?: string[] }) => Promise<AgentResponse>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [defaultDraft, setDefaultDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [allModels, setAllModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    fetchModels().then(setAllModels).catch(() => {});
  }, []);

  const handleEdit = () => {
    setDraft([...agent.allowed_model_ids]);
    setDefaultDraft(agent.model_id ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: { model_id?: string; allowed_model_ids: string[] } = {
        allowed_model_ids: draft,
      };
      if (defaultDraft && defaultDraft !== agent.model_id) {
        updates.model_id = defaultDraft;
      }
      await onPatchAgent(agent.id, updates);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (modelId: string) => {
    if (modelId === defaultDraft) return;
    setDraft((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  return (
    <Card className="py-3 gap-1">
      <CardHeader className="gap-1 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">Model Configuration</CardTitle>
          {!editing && (
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleEdit}>
              <Pencil className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-2">
        {editing ? (
          <div className="space-y-2">
            <p className="text-xs">Select which models users may choose at invoke time:</p>
            <div className="space-y-1.5">
              {groupModels(allModels).map(([group, models]) => (
                <div key={group} className="flex flex-wrap gap-x-4 gap-y-1 items-center">
                  <span className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">{group}</span>
                  {models.map((m) => {
                    const isDefault = m.model_id === defaultDraft;
                    const isChecked = draft.includes(m.model_id);
                    return (
                      <label key={m.model_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0"
                          checked={isChecked}
                          disabled={isDefault}
                          onChange={() => toggle(m.model_id)}
                        />
                        <span>{m.display_name}</span>
                        {isChecked && (
                          <button
                            type="button"
                            onClick={() => setDefaultDraft(m.model_id)}
                            className={`text-[10px] px-1 rounded ${
                              isDefault
                                ? "bg-primary text-primary-foreground"
                                : "bg-accent text-muted-foreground hover:bg-accent/80"
                            }`}
                          >
                            {isDefault ? "default" : "set default"}
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-6 text-xs" onClick={() => void handleSave()} disabled={saving}>
                <Check className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditing(false)} disabled={saving}>
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {groupModels(allModels.filter((m) => agent.allowed_model_ids.includes(m.model_id))).map(([group, models]) => (
              <div key={group} className="flex flex-wrap gap-1 items-center">
                <span className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">{group}</span>
                {models.map((m) => (
                  <Badge key={m.model_id} variant="outline" className="text-[10px] px-1.5 py-0">
                    {m.display_name}{m.model_id === agent.model_id ? " (default)" : ""}
                  </Badge>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
