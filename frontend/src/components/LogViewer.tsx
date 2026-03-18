import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatLogTime } from "@/lib/format";
import type { LogEvent } from "@/api/types";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const PAGE_SIZE = 200;

interface LogViewerProps {
  logs: LogEvent[];
  loading: boolean;
  showTimestamp?: boolean;
  showLineNumbers?: boolean;
}

export function LogViewer({ logs, loading, showTimestamp = true, showLineNumbers = true }: LogViewerProps) {
  const { timezone } = useTimezone();
  const [page, setPage] = useState(1);

  // Reset to page 1 when logs change
  useEffect(() => {
    setPage(1);
  }, [logs]);

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

  const totalPages = Math.ceil(logs.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, logs.length);
  const visibleLogs = logs.slice(start, end);

  return (
    <div className="space-y-2">
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {start + 1}&ndash;{end} of {logs.length} log lines
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === totalPages}
              onClick={() => setPage(totalPages)}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="rounded border bg-input-bg p-3 font-mono text-xs leading-relaxed">
        {visibleLogs.map((event, i) => {
          const lineNum = start + i + 1;
          return (
            <div key={lineNum} className="flex gap-3 hover:bg-accent/30 py-0.5">
              {showLineNumbers && (
                <span className="shrink-0 text-muted-foreground text-right select-none" style={{ minWidth: `${String(logs.length).length + 0.5}ch` }}>
                  {lineNum}
                </span>
              )}
              {showTimestamp && (
                <span className="shrink-0 text-muted-foreground">
                  {formatLogTime(event.timestamp_iso, timezone)}
                </span>
              )}
              <span className="whitespace-pre-wrap break-all">{event.message}</span>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={page === totalPages}
              onClick={() => setPage(totalPages)}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
