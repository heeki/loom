import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp, formatMs } from "@/lib/format";
import type { AgentResponse, SessionResponse, InvocationResponse } from "@/api/types";

interface InvocationDetailPageProps {
  agent: AgentResponse;
  session: SessionResponse;
  invocation: InvocationResponse;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "complete":
      return "default";
    case "streaming":
    case "pending":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

export function InvocationDetailPage({ invocation }: InvocationDetailPageProps) {
  const { timezone } = useTimezone();

  return (
    <div className="space-y-6">
      <Card className="max-w-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Invocation Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground">Invocation ID</div>
            <div className="font-mono text-sm">{invocation.invocation_id}</div>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <Badge className="mt-0.5" variant={statusVariant(invocation.status)}>
                {invocation.status}
              </Badge>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Cold Start</div>
              <div className="font-mono text-sm mt-0.5">{formatMs(invocation.cold_start_latency_ms)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Duration</div>
              <div className="font-mono text-sm mt-0.5">{formatMs(invocation.client_duration_ms)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Created</div>
              <div className="text-sm mt-0.5">{formatTimestamp(invocation.created_at, timezone)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-input-bg rounded-md p-4 text-sm font-mono whitespace-pre-wrap overflow-x-auto">
            {invocation.prompt_text ?? "Not captured"}
          </pre>
        </CardContent>
      </Card>

      {invocation.thinking_text != null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Thinking</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted rounded-md p-4 text-sm font-mono whitespace-pre-wrap overflow-x-auto">
              {invocation.thinking_text}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Response</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-input-bg rounded-md p-4 text-sm font-mono whitespace-pre-wrap overflow-x-auto">
            {invocation.response_text ?? "Not captured"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
