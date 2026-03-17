import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, sortRows } from "@/components/SortableTableHead";
import { fetchCostDashboard } from "@/api/costs";
import type { CostDashboardResponse, AgentCostSummary } from "@/api/types";
import type { SortDirection } from "@/components/SortableCardGrid";
import { useAuth } from "@/contexts/AuthContext";

interface CostDashboardPageProps {
  readOnly?: boolean;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count === 0) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

const SORT_GETTERS: Record<string, (a: AgentCostSummary) => string | number> = {
  agent: (a) => a.agent_name ?? "",
  model: (a) => a.model_id ?? "",
  invocations: (a) => a.total_invocations,
  input: (a) => a.total_input_tokens,
  output: (a) => a.total_output_tokens,
  cost: (a) => a.total_estimated_cost,
  avg: (a) => a.avg_cost_per_invocation,
};

export function CostDashboardPage({ readOnly: _readOnly }: CostDashboardPageProps) {
  const { user: _user } = useAuth();
  const [data, setData] = useState<CostDashboardResponse | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>("cost");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchCostDashboard(days);
      setData(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const sortedAgents = data ? sortRows(data.agents, sortCol, sortDir, SORT_GETTERS) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Cost Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Estimated costs based on token usage and model pricing
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90, 0].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                days === d
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {d === 0 ? "All Time" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Total Cost</div>
                <div className="text-xl font-mono font-semibold">{formatCost(data.total_estimated_cost)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Invocations</div>
                <div className="text-xl font-mono font-semibold">{data.total_invocations.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Input Tokens</div>
                <div className="text-xl font-mono font-semibold">{formatTokens(data.total_input_tokens)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Output Tokens</div>
                <div className="text-xl font-mono font-semibold">{formatTokens(data.total_output_tokens)}</div>
              </CardContent>
            </Card>
          </div>

          {data.group && (
            <div className="text-xs text-muted-foreground">
              Showing costs for group: <Badge variant="secondary" className="text-[10px]">{data.group}</Badge>
              {" "}over {data.days === 0 ? "all time" : `${data.days} days`}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Cost by Agent</CardTitle>
            </CardHeader>
            <CardContent>
              {data.agents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invocations in this period.</p>
              ) : (
                <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead column="agent" activeColumn={sortCol} direction={sortDir} onSort={handleSort}>Agent</SortableTableHead>
                      <SortableTableHead column="model" activeColumn={sortCol} direction={sortDir} onSort={handleSort}>Model</SortableTableHead>
                      <SortableTableHead column="invocations" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Invocations</SortableTableHead>
                      <SortableTableHead column="input" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Input Tokens</SortableTableHead>
                      <SortableTableHead column="output" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Output Tokens</SortableTableHead>
                      <SortableTableHead column="cost" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Total Cost</SortableTableHead>
                      <SortableTableHead column="avg" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Avg/Invoke</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAgents.map((a) => (
                      <TableRow key={a.agent_id} className="bg-white dark:bg-transparent">
                        <TableCell className="text-xs font-medium">{a.agent_name ?? `Agent #${a.agent_id}`}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.model_id?.split(".").pop() ?? "—"}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{a.total_invocations}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{formatTokens(a.total_input_tokens)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{formatTokens(a.total_output_tokens)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{formatCost(a.total_estimated_cost)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{formatCost(a.avg_cost_per_invocation)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {loading && !data && (
        <div className="text-sm text-muted-foreground">Loading cost data...</div>
      )}
    </div>
  );
}
