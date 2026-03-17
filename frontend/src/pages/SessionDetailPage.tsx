import { useEffect, useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, RefreshCw } from "lucide-react";
import { InvocationTable } from "@/components/InvocationTable";
import { LogViewer } from "@/components/LogViewer";
import { useLogs } from "@/hooks/useLogs";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import type { SessionResponse, AgentResponse, LogStreamInfo } from "@/api/types";

const SESSION_LOGS_VALUE = "__session__";

/**
 * Simplify a log stream name for display.
 * Input:  "YYYY/MM/DD/[runtime-logs-<session-id>]<uuid>"
 * Output: "<session-id> (YYYY/MM/DD)"
 */
function formatStreamName(name: string): string {
  const match = name.match(/^(\d{4}\/\d{2}\/\d{2})\/\[runtime-logs-([^\]]+)\]/);
  if (match) {
    return `${match[2]} (${match[1]})`;
  }
  return name;
}

function isOtelStream(name: string): boolean {
  return name.includes("otel-rt-logs");
}

function sortStreams(streams: LogStreamInfo[]): LogStreamInfo[] {
  const regular = streams.filter((s) => !isOtelStream(s.name));
  const otel = streams.filter((s) => isOtelStream(s.name));
  return [...regular, ...otel];
}

interface SessionDetailPageProps {
  agent: AgentResponse;
  session: SessionResponse;
  onSelectInvocation?: (invocationId: string) => void;
}

export function SessionDetailPage({ agent, session, onSelectInvocation }: SessionDetailPageProps) {
  const {
    logs,
    loading: logsLoading,
    streams,
    streamsLoading,
    activeStream,
    fetchSessionLogs,
    fetchLogStreams,
    fetchStreamLogs,
  } = useLogs();
  const { timezone } = useTimezone();
  const [showTimestamp, setShowTimestamp] = useState(true);

  const qualifier = session.qualifier || "DEFAULT";

  const refreshLogs = useCallback(() => {
    if (activeStream) {
      void fetchStreamLogs(agent.id, qualifier, activeStream);
    } else {
      void fetchSessionLogs(agent.id, session.session_id, qualifier);
    }
  }, [agent.id, session.session_id, qualifier, activeStream, fetchSessionLogs, fetchStreamLogs]);

  // Fetch session logs and available streams on mount
  useEffect(() => {
    void fetchSessionLogs(agent.id, session.session_id, qualifier);
    void fetchLogStreams(agent.id, qualifier);
  }, [agent.id, session.session_id, qualifier, fetchSessionLogs, fetchLogStreams]);

  const handleStreamChange = (value: string) => {
    if (value === SESSION_LOGS_VALUE) {
      void fetchSessionLogs(agent.id, session.session_id, qualifier);
    } else {
      void fetchStreamLogs(agent.id, qualifier, value);
    }
  };

  const selectedValue = activeStream || SESSION_LOGS_VALUE;
  const sortedStreams = sortStreams(streams);

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
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium">Logs</h3>
            <Select value={selectedValue} onValueChange={handleStreamChange}>
              <SelectTrigger size="sm" className="text-xs max-w-[340px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Source</SelectLabel>
                  <SelectItem value={SESSION_LOGS_VALUE}>
                    Service-level logs (filtered by session)
                  </SelectItem>
                </SelectGroup>
                {sortedStreams.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Log Streams</SelectLabel>
                      {sortedStreams.map((stream) => (
                        <SelectItem key={stream.name} value={stream.name}>
                          <span className="font-mono">{formatStreamName(stream.name)}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
            {streamsLoading && (
              <span className="text-xs text-muted-foreground">Loading streams...</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showTimestamp ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowTimestamp((v) => !v)}
            >
              <Clock className="h-4 w-4 mr-1" />
              Timestamps
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-[120px]"
              onClick={refreshLogs}
              disabled={logsLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${logsLoading ? "animate-spin" : ""}`} />
              {logsLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>
        <Separator className="mb-4" />
        <div className="text-xs text-muted-foreground mb-2">
          {activeStream
            ? <>Showing all logs from stream: <span className="font-mono">{formatStreamName(activeStream)}</span></>
            : <>Showing service-level logs matching session <span className="font-mono">{session.session_id}</span></>
          }
        </div>
        <LogViewer logs={logs} loading={logsLoading} showTimestamp={showTimestamp} />
      </div>
    </div>
  );
}
