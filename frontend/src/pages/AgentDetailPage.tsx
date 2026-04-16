import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Key, Pencil, Check, X } from "lucide-react";
import { fetchModels } from "@/api/agents";
import type { ModelOption } from "@/api/types";
import ReactMarkdown from "react-markdown";
import { CollapsibleJsonBlock } from "@/components/CollapsibleJsonBlock";
import remarkGfm from "remark-gfm";
import { InvokePanel } from "@/components/InvokePanel";
import { LatencySummary } from "@/components/LatencySummary";
import { SessionTable } from "@/components/SessionTable";
import { DeploymentPanel } from "@/components/DeploymentPanel";
import { RegistryStatusBadge } from "@/components/RegistryStatusBadge";
import { RegistryActions } from "@/components/RegistryActions";
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
  onPatchAgent?: (id: number, updates: { description?: string | null; allowed_model_ids?: string[] }) => Promise<AgentResponse>;
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
  const { user, browserSessionId } = useAuth();
  const { streamedText, sessionStart, sessionEnd, isStreaming, error, rawError, invoke, cancel } =
    useInvoke(agent.id, agent.authorizer_config?.name ?? undefined);

  const handleInvoke = async (prompt: string, qualifier: string, sessionId?: string, credentialId?: number, bearerToken?: string, modelId?: string) => {
    if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, 'agent', 'invoke', agent.name ?? agent.runtime_id ?? String(agent.id));
    await invoke(prompt, qualifier, sessionId, credentialId, bearerToken, modelId);
    onSessionsRefresh();
  };

  const isDeployed = agent.source === "deploy";

  return (
    <div className="space-y-4">
      {/* Description */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">Description</CardTitle>
            <RegistryStatusBadge status={agent.registry_status} showUnregistered={registryEnabled} registryEnabled={registryEnabled} />
            {!editingDescription && onPatchAgent && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleEditDescription}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
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
        <CardContent className="pt-2">
          {editingDescription ? (
            <div className="space-y-2">
              <Textarea
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                placeholder="Describe what this agent does..."
                className="text-sm resize-none"
                rows={3}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleSaveDescription()} disabled={savingDescription}>
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelDescription} disabled={savingDescription}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {agent.description ?? <span className="italic">No description set.</span>}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Sessions — full width across top */}
      <section>
        <SessionTable
          sessions={sessions}
          onSelectSession={onSelectSession}
          loading={sessionsLoading}
          currentUserId={user?.username ?? user?.sub}
        />
      </section>

      {/* Invoke form */}
      {effectiveCanInvoke ? (
        <InvokePanel
          agentId={agent.id}
          qualifiers={agent.available_qualifiers}
          sessions={sessions}
          isStreaming={isStreaming}
          modelId={agent.model_id}
          allowedModelIds={agent.allowed_model_ids}
          authorizerName={agent.authorizer_config?.name}
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

      {/* Latency summary — shown only after invocation completes */}
      {sessionEnd && <LatencySummary sessionEnd={sessionEnd} />}

      {/* Error */}
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

      {/* Response — full width, expands dynamically with content */}
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
            <div className="rounded border bg-input-bg p-4 text-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-sm font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li className="leading-snug">{children}</li>,
                  pre: ({ children }) => {
                    const codeClass = (children as { props?: { className?: string } } | null)?.props?.className ?? '';
                    if (codeClass.includes('language-json')) {
                      return <CollapsibleJsonBlock>{children}</CollapsibleJsonBlock>;
                    }
                    return (
                      <pre className="mb-2 overflow-x-auto rounded bg-black/10 dark:bg-white/10 p-3 text-xs font-mono">{children}</pre>
                    );
                  },
                  code: ({ className, children }) =>
                    className?.startsWith("language-") ? (
                      <code className={className}>{children}</code>
                    ) : (
                      <code className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-xs font-mono">{children}</code>
                    ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground mb-2">{children}</blockquote>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto mb-2">
                      <table className="border-collapse text-xs w-full">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => <thead>{children}</thead>,
                  tbody: ({ children }) => <tbody>{children}</tbody>,
                  tr: ({ children }) => <tr>{children}</tr>,
                  th: ({ children }) => (
                    <th className="border border-border px-2 py-1 text-left font-semibold bg-muted/50">{children}</th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-border px-2 py-1">{children}</td>
                  ),
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  a: ({ href, children }) => (
                    <a href={href} className="underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer">{children}</a>
                  ),
                }}
              >
                {streamedText}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deployment section — only for deployed agents */}
      {isDeployed && (
        <>
          <Separator />
          <h3 className="text-sm font-medium">Deployment</h3>

          <DeploymentPanel
            agent={agent}
            onRedeploy={onRedeploy ?? (async () => {})}
            onPatchAgent={onPatchAgent}
          />
        </>
      )}

      {/* Model configuration for registered (non-deployed) agents */}
      {!isDeployed && agent.model_id && onPatchAgent && (
        <RegisteredAgentModelConfig agent={agent} onPatchAgent={onPatchAgent} />
      )}
    </div>
  );
}

function RegisteredAgentModelConfig({ agent, onPatchAgent }: {
  agent: AgentResponse;
  onPatchAgent: (id: number, updates: { allowed_model_ids?: string[] }) => Promise<AgentResponse>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [allModels, setAllModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    fetchModels().then(setAllModels).catch(() => {});
  }, []);

  const getDisplayName = (modelId: string) =>
    allModels.find((m) => m.model_id === modelId)?.display_name ?? modelId;

  const handleEdit = () => {
    setDraft([...agent.allowed_model_ids]);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onPatchAgent(agent.id, { allowed_model_ids: draft });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (modelId: string) => {
    if (modelId === agent.model_id) return;
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
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {allModels.map((m) => (
                <label key={m.model_id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0"
                    checked={draft.includes(m.model_id)}
                    disabled={m.model_id === agent.model_id}
                    onChange={() => toggle(m.model_id)}
                  />
                  <span>{m.display_name}</span>
                  {m.model_id === agent.model_id && (
                    <span className="text-[10px] text-muted-foreground bg-accent px-1 rounded">default</span>
                  )}
                </label>
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
          <div className="flex flex-wrap gap-1">
            {agent.allowed_model_ids.map((id) => (
              <Badge key={id} variant="outline" className="text-[10px] px-1.5 py-0">
                {getDisplayName(id)}{id === agent.model_id ? " (default)" : ""}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
