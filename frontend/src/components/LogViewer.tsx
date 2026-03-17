import { Skeleton } from "@/components/ui/skeleton";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatLogTime } from "@/lib/format";
import type { LogEvent } from "@/api/types";

interface LogViewerProps {
  logs: LogEvent[];
  loading: boolean;
  showTimestamp?: boolean;
}

export function LogViewer({ logs, loading, showTimestamp = true }: LogViewerProps) {
  const { timezone } = useTimezone();

  if (loading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No logs available</div>;
  }

  return (
    <div className="rounded border bg-input-bg p-3 font-mono text-xs leading-relaxed">
      {logs.map((event, i) => (
        <div key={i} className="flex gap-3 hover:bg-accent/30 py-0.5">
          {showTimestamp && (
            <span className="shrink-0 text-muted-foreground">
              {formatLogTime(event.timestamp_iso, timezone)}
            </span>
          )}
          <span className="whitespace-pre-wrap break-all">{event.message}</span>
        </div>
      ))}
    </div>
  );
}
