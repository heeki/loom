import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Key } from "lucide-react";
import { InvokePanel } from "@/components/InvokePanel";
import { LatencySummary } from "@/components/LatencySummary";
import { SessionTable } from "@/components/SessionTable";
import { DeploymentPanel } from "@/components/DeploymentPanel";
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
  canInvoke?: boolean;
  userGroups?: string[];
}

export function AgentDetailPage({
  agent,
  sessions,
  sessionsLoading,
  onSelectSession,
  onSessionsRefresh,
  onRedeploy,
  canInvoke = true,
  userGroups = [],
}: AgentDetailPageProps) {
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

  const handleInvoke = async (prompt: string, qualifier: string, sessionId?: string, credentialId?: number, bearerToken?: string) => {
    if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, 'agent', 'invoke', agent.name ?? agent.runtime_id ?? String(agent.id));
    await invoke(prompt, qualifier, sessionId, credentialId, bearerToken);
    onSessionsRefresh();
  };

  const isDeployed = agent.source === "deploy";

  return (
    <div className="space-y-4">
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
            <div className="rounded border bg-input-bg p-4 whitespace-pre-wrap text-sm font-mono">
              {streamedText}
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
          />
        </>
      )}
    </div>
  );
}
