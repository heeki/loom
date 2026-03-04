import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp } from "@/lib/format";
import type { SessionResponse } from "@/api/types";

interface SessionTableProps {
  sessions: SessionResponse[];
  onSelectSession: (sessionId: string) => void;
  loading: boolean;
}

type SortDir = "asc" | "desc";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "streaming":
    case "pending":
      return "secondary";
    case "expired":
      return "outline";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

export function SessionTable({ sessions, onSelectSession, loading }: SessionTableProps) {
  const { timezone } = useTimezone();
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortDir === "desc" ? tb - ta : ta - tb;
    });
  }, [sessions, sortDir]);

  const toggleSort = () => setSortDir((d) => (d === "desc" ? "asc" : "desc"));

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No sessions yet</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[36ch]">Session ID</TableHead>
          <TableHead>Qualifier</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Invocations</TableHead>
          <TableHead>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 font-medium hover:bg-transparent"
              onClick={toggleSort}
            >
              Created {sortDir === "desc" ? "\u2193" : "\u2191"}
            </Button>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((session) => (
          <TableRow
            key={session.session_id}
            className="cursor-pointer hover:bg-accent/50"
            onClick={() => onSelectSession(session.session_id)}
          >
            <TableCell className="font-mono text-xs">
              {session.session_id}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{session.qualifier}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(session.live_status)}>{session.live_status}</Badge>
            </TableCell>
            <TableCell>{session.invocations.length}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatTimestamp(session.created_at, timezone)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
