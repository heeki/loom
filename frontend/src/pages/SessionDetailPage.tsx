import { useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { InvocationTable } from "@/components/InvocationTable";
import { LogViewer } from "@/components/LogViewer";
import { useLogs } from "@/hooks/useLogs";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import type { SessionResponse, AgentResponse } from "@/api/types";

interface SessionDetailPageProps {
  agent: AgentResponse;
  session: SessionResponse;
  onSelectInvocation?: (invocationId: string) => void;
}

export function SessionDetailPage({ agent, session, onSelectInvocation }: SessionDetailPageProps) {
  const { logs, loading: logsLoading, fetchSessionLogs } = useLogs();
  const { timezone } = useTimezone();

  const refreshLogs = useCallback(() => {
    const qualifier = session.qualifier || "DEFAULT";
    void fetchSessionLogs(agent.id, session.session_id, qualifier);
  }, [agent.id, session.session_id, session.qualifier, fetchSessionLogs]);

  useEffect(() => {
    refreshLogs();
  }, [refreshLogs]);

  return (
    <div className="space-y-6">
      <Card className="max-w-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Session Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground">Session ID</div>
            <div className="font-mono text-sm">{session.session_id}</div>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Qualifier</div>
              <Badge variant="outline" className="mt-0.5">{session.qualifier}</Badge>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <Badge
                className="mt-0.5"
                variant={
                  session.live_status === "active"
                    ? "default"
                    : session.live_status === "error"
                      ? "destructive"
                      : session.live_status === "expired"
                        ? "outline"
                        : "secondary"
                }
              >
                {session.live_status}
              </Badge>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Created</div>
              <div className="text-sm mt-0.5">{formatTimestamp(session.created_at, timezone)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-medium mb-2">Invocations</h3>
        <Separator className="mb-4" />
        <InvocationTable invocations={session.invocations} onSelectInvocation={onSelectInvocation} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Logs</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshLogs}
            disabled={logsLoading}
          >
            {logsLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <Separator className="mb-4" />
        <LogViewer logs={logs} loading={logsLoading} />
      </div>
    </div>
  );
}
