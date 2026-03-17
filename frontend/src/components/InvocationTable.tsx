import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useTimezone } from "@/contexts/TimezoneContext";
import { formatTimestamp, formatMs } from "@/lib/format";
import type { InvocationResponse } from "@/api/types";

interface InvocationTableProps {
  invocations: InvocationResponse[];
  onSelectInvocation?: (invocationId: string) => void;
}

function formatTokens(count: number | null | undefined): string {
  if (count == null) return "—";
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

function formatCost(cost: number | null | undefined): string {
  if (cost == null) return "—";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
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

export function InvocationTable({ invocations, onSelectInvocation }: InvocationTableProps) {
  const { timezone } = useTimezone();

  if (invocations.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No invocations</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[36ch]">Invocation ID</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Cold Start</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Input Tokens</TableHead>
          <TableHead>Output Tokens</TableHead>
          <TableHead>Est. Cost</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invocations.map((inv) => (
          <TableRow
            key={inv.invocation_id}
            className={onSelectInvocation ? "cursor-pointer hover:bg-accent/50" : ""}
            onClick={() => onSelectInvocation?.(inv.invocation_id)}
          >
            <TableCell className="font-mono text-xs">
              {inv.invocation_id}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {formatMs(inv.cold_start_latency_ms)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {formatMs(inv.client_duration_ms)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {formatTokens(inv.input_tokens)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {formatTokens(inv.output_tokens)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {formatCost(inv.estimated_cost)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatTimestamp(inv.created_at, timezone)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
