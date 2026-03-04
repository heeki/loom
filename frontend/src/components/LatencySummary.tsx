import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatUnixTime, formatMs } from "@/lib/format";
import type { SSESessionEnd } from "@/api/types";

interface LatencySummaryProps {
  sessionEnd: SSESessionEnd | null;
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

export function LatencySummary({ sessionEnd }: LatencySummaryProps) {
  const { timezone } = useTimezone();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Latency Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCell
            label="Client Invoke"
            value={formatUnixTime(sessionEnd?.client_invoke_time ?? null, timezone)}
          />
          <MetricCell
            label="Agent Start"
            value={formatUnixTime(sessionEnd?.agent_start_time ?? null, timezone)}
          />
          <MetricCell
            label="Cold Start"
            value={formatMs(sessionEnd?.cold_start_latency_ms ?? null)}
          />
          <MetricCell
            label="Duration"
            value={formatMs(sessionEnd?.client_duration_ms ?? null)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
