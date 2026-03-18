import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, sortRows } from "@/components/SortableTableHead";
import { fetchCostDashboard } from "@/api/costs";
import { listSiteSettings } from "@/api/settings";
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
  if (count >= 10_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

/* ---------- derived cost helpers ---------- */

function runtimeCpu(a: AgentCostSummary): number {
  return a.total_compute_cpu_cost;
}
function runtimeMem(a: AgentCostSummary): number {
  return a.total_compute_memory_cost + a.total_idle_memory_cost;
}
function runtimeTotal(a: AgentCostSummary): number {
  return runtimeCpu(a) + runtimeMem(a);
}
function memoryTotal(a: AgentCostSummary): number {
  return a.total_stm_cost + a.total_ltm_cost;
}
function grandTotal(a: AgentCostSummary): number {
  return a.total_estimated_cost + runtimeTotal(a) + memoryTotal(a);
}

const SORT_GETTERS: Record<string, (a: AgentCostSummary) => string | number> = {
  agent: (a) => a.agent_name ?? "",
  model: (a) => a.model_id ?? "",
  invocations: (a) => a.total_invocations,
  model_tokens: (a) => a.total_estimated_cost,
  rt_total: (a) => runtimeTotal(a),
  mem_total: (a) => memoryTotal(a),
  total: (a) => grandTotal(a),
  avg: (a) => a.avg_cost_per_invocation,
};

export function CostDashboardPage({ readOnly: _readOnly }: CostDashboardPageProps) {
  const { user: _user } = useAuth();
  const [data, setData] = useState<CostDashboardResponse | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>("total");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [cpuIdlePercent, setCpuIdlePercent] = useState(75);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const loadCosts = useCallback(async () => {
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

  const loadSettings = useCallback(async () => {
    try {
      const settings = await listSiteSettings();
      const discount = settings.find((s) => s.key === "cpu_io_wait_discount");
      if (discount) setCpuIdlePercent(parseInt(discount.value, 10) || 75);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { void loadCosts(); }, [loadCosts]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const sortedAgents = data ? sortRows(data.agents, sortCol, sortDir, SORT_GETTERS) : [];

  // Derived totals
  const tModel = data ? data.total_estimated_cost : 0;
  const tRtCpu = data ? data.total_compute_cpu_cost : 0;
  const tRtMem = data ? data.total_compute_memory_cost + data.total_idle_memory_cost : 0;
  const tRtTotal = tRtCpu + tRtMem;
  const tStm = data ? data.total_stm_cost : 0;
  const tLtm = data ? data.total_ltm_cost : 0;
  const tMemTotal = tStm + tLtm;
  const tGrand = tModel + tRtTotal + tMemTotal;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Cost Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-amber-600 dark:text-amber-400">Estimated</span>{" "}
            total cost = model tokens + runtime + memory.
          </p>
          <p className="text-sm text-muted-foreground">Runtime CPU assumes {cpuIdlePercent}% I/O wait time, and idle cost is memory only. Memory costs exclude LTM storage.</p>
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
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Total Cost</div>
                <div className="text-xl font-mono font-semibold">{formatCost(tGrand)}</div>
                <div className="text-[10px] text-muted-foreground">Model + Runtime + Memory</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Model Tokens</div>
                <div className="text-xl font-mono font-semibold">{formatCost(tModel)}</div>
                <div className="text-[10px] text-muted-foreground">{data.total_invocations.toLocaleString()} invocations</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Runtime</div>
                <div className="text-xl font-mono font-semibold">{formatCost(tRtTotal)}</div>
                <div className="text-[10px] text-muted-foreground">CPU {formatCost(tRtCpu)} + Mem {formatCost(tRtMem)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Memory</div>
                <div className="text-xl font-mono font-semibold">{formatCost(tMemTotal)}</div>
                <div className="text-[10px] text-muted-foreground">STM {formatCost(tStm)} + LTM {formatCost(tLtm)}</div>
              </CardContent>
            </Card>
          </div>

          {data.group && (
            <div className="text-xs text-muted-foreground">
              Showing costs for group: <Badge variant="secondary" className="text-[10px]">{data.group}</Badge>
              {" "}over {data.days === 0 ? "all time" : `${data.days} days`}
            </div>
          )}

          <Card className="bg-muted/30">
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
                      <SortableTableHead column="model_tokens" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Model Tokens</SortableTableHead>
                      <SortableTableHead column="rt_total" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Runtime</SortableTableHead>
                      <SortableTableHead column="mem_total" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Memory</SortableTableHead>
                      <SortableTableHead column="total" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Total</SortableTableHead>
                      <SortableTableHead column="avg" activeColumn={sortCol} direction={sortDir} onSort={handleSort} className="text-right">Per Invoke</SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAgents.map((a) => {
                      const rtCpu = runtimeCpu(a);
                      const rtMem = runtimeMem(a);
                      const rtTot = runtimeTotal(a);
                      const memTot = memoryTotal(a);
                      const total = grandTotal(a);
                      return (
                        <>
                          {/* Primary row: summary */}
                          <TableRow key={a.agent_id} className="bg-white dark:bg-transparent border-b-0">
                            <TableCell className="text-xs font-medium pb-0">{a.agent_name ?? `Agent #${a.agent_id}`}</TableCell>
                            <TableCell className="text-xs text-muted-foreground pb-0">{a.model_id?.split(".").pop() ?? "—"}</TableCell>
                            <TableCell className="text-xs text-right font-mono pb-0">{a.total_invocations}</TableCell>
                            <TableCell className="text-xs text-right font-mono pb-0">{formatCost(a.total_estimated_cost)}</TableCell>
                            <TableCell className="text-xs text-right font-mono pb-0">{formatCost(rtTot)}</TableCell>
                            <TableCell className="text-xs text-right font-mono pb-0">{formatCost(memTot)}</TableCell>
                            <TableCell className="text-xs text-right font-mono font-semibold pb-0">{formatCost(total)}</TableCell>
                            <TableCell className="text-xs text-right font-mono pb-0">{formatCost(a.avg_cost_per_invocation)}</TableCell>
                          </TableRow>
                          {/* Detail row: breakdowns */}
                          <TableRow key={`${a.agent_id}-detail`} className="bg-white dark:bg-transparent hover:bg-white dark:hover:bg-transparent">
                            <TableCell className="pt-0" colSpan={3} />
                            <TableCell className="text-[10px] text-muted-foreground text-right pt-0">
                              {formatTokens(a.total_input_tokens)} in / {formatTokens(a.total_output_tokens)} out
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground text-right pt-0">
                              CPU {formatCost(rtCpu)} + Mem {formatCost(rtMem)}
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground text-right pt-0">
                              STM {formatCost(a.total_stm_cost)} + LTM {formatCost(a.total_ltm_cost)}
                            </TableCell>
                            <TableCell className="pt-0" colSpan={2} />
                          </TableRow>
                        </>
                      );
                    })}
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
