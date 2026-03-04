import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { InvokePanel } from "@/components/InvokePanel";
import { LatencySummary } from "@/components/LatencySummary";
import { SessionTable } from "@/components/SessionTable";
import { useInvoke } from "@/hooks/useInvoke";
import type { AgentResponse, SessionResponse } from "@/api/types";

interface AgentDetailPageProps {
  agent: AgentResponse;
  sessions: SessionResponse[];
  sessionsLoading: boolean;
  onSelectSession: (sessionId: string) => void;
  onSessionsRefresh: () => void;
}

export function AgentDetailPage({
  agent,
  sessions,
  sessionsLoading,
  onSelectSession,
  onSessionsRefresh,
}: AgentDetailPageProps) {
  const { streamedText, sessionStart, sessionEnd, isStreaming, error, invoke, cancel } =
    useInvoke();

  const handleInvoke = async (prompt: string, qualifier: string, sessionId?: string) => {
    await invoke(agent.id, prompt, qualifier, sessionId);
    onSessionsRefresh();
  };

  return (
    <div className="space-y-4">
      {/* Sessions — full width across top */}
      <section>
        <h3 className="text-sm font-medium mb-2">Sessions</h3>
        <Separator className="mb-4" />
        <SessionTable
          sessions={sessions}
          onSelectSession={onSelectSession}
          loading={sessionsLoading}
        />
      </section>

      {/* Invoke form */}
      <InvokePanel
        qualifiers={agent.available_qualifiers}
        sessions={sessions}
        isStreaming={isStreaming}
        onInvoke={handleInvoke}
        onCancel={cancel}
      />

      {/* Latency summary — shown only after invocation completes */}
      {sessionEnd && <LatencySummary sessionEnd={sessionEnd} />}

      {/* Error */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Response — full width, expands dynamically with content */}
      {(streamedText || isStreaming) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">Response</CardTitle>
              {sessionStart && (
                <Badge variant="outline" className="font-mono text-xs">
                  {sessionStart.session_id}
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
    </div>
  );
}
