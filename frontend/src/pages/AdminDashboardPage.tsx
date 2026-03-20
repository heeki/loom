import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  fetchAuditSummary,
  fetchSessions,
  fetchLogins,
  fetchActions,
  fetchPageViews,
  fetchSessionTimeline,
} from "@/api/audit";
import type {
  AuditSummary,
  AuditSession,
  AuditLoginRecord,
  AuditActionRecord,
  AuditPageViewRecord,
  AuditTimelineEvent,
} from "@/api/audit";

type TimeRange = "today" | "7d" | "30d" | "all";

function getDateRange(range: TimeRange): { start_date?: string; end_date?: string } {
  if (range === "all") return {};
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  if (range === "today") return { start_date: end, end_date: end };
  const days = range === "7d" ? 7 : 30;
  const start = new Date(now.getTime() - days * 86400000);
  return { start_date: start.toISOString().slice(0, 10), end_date: end };
}

function truncId(id: string): string {
  return id.slice(0, 8);
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const CHART_COLORS = [
  "var(--chart-1, #2563eb)",
  "var(--chart-2, #16a34a)",
  "var(--chart-3, #ea580c)",
  "var(--chart-4, #9333ea)",
  "var(--chart-5, #dc2626)",
  "var(--chart-6, #0891b2)",
];

export function AdminDashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [logins, setLogins] = useState<AuditLoginRecord[]>([]);
  const [actions, setActions] = useState<AuditActionRecord[]>([]);
  const [pageViews, setPageViews] = useState<AuditPageViewRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [loginUserFilter, setLoginUserFilter] = useState("");
  const [actionCategoryFilter, setActionCategoryFilter] = useState<string>("all");
  const [actionTypeFilter, setActionTypeFilter] = useState<string>("all");
  const [pageNameFilter, setPageNameFilter] = useState<string>("all");

  // Session timeline
  const [selectedSession, setSelectedSession] = useState<AuditSession | null>(null);
  const [timeline, setTimeline] = useState<AuditTimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const params = getDateRange(timeRange);
    try {
      const [s, sess, log, act, pv] = await Promise.all([
        fetchAuditSummary(params),
        fetchSessions(params),
        fetchLogins(params),
        fetchActions(params),
        fetchPageViews(params),
      ]);
      setSummary(s);
      setSessions(sess);
      setLogins(log);
      setActions(act);
      setPageViews(pv);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSessionClick = async (session: AuditSession) => {
    setSelectedSession(session);
    setTimelineLoading(true);
    try {
      const tl = await fetchSessionTimeline(session.browser_session_id);
      setTimeline(tl);
    } catch {
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  };

  // Derived data for charts
  const categoryData = summary
    ? Object.entries(summary.actions_by_category).map(([name, value]) => ({ name, value }))
    : [];
  const pageData = summary
    ? Object.entries(summary.page_views_by_page).map(([name, value]) => ({ name, value }))
    : [];
  const mostActivePage = pageData.length > 0
    ? pageData.reduce((a, b) => (b.value > a.value ? b : a)).name
    : "-";

  // Unique filter values
  const categoryOptions = [...new Set(actions.map((a) => a.action_category))].sort();
  const typeOptions = [...new Set(
    actions
      .filter((a) => actionCategoryFilter === "all" || a.action_category === actionCategoryFilter)
      .map((a) => a.action_type),
  )].sort();
  const pageOptions = [...new Set(pageViews.map((p) => p.page_name))].sort();

  // Filtered data
  const filteredLogins = loginUserFilter
    ? logins.filter((l) => l.user_id.toLowerCase().includes(loginUserFilter.toLowerCase()))
    : logins;
  const filteredActions = actions.filter((a) => {
    if (actionCategoryFilter !== "all" && a.action_category !== actionCategoryFilter) return false;
    if (actionTypeFilter !== "all" && a.action_type !== actionTypeFilter) return false;
    return true;
  });
  const filteredPageViews = pageNameFilter !== "all"
    ? pageViews.filter((p) => p.page_name === pageNameFilter)
    : pageViews;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Admin Dashboard</h2>
          <p className="text-sm text-muted-foreground">User activity and audit trail</p>
        </div>
        <div className="flex items-center gap-2">
          {(["today", "7d", "30d", "all"] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                timeRange === r
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {r === "today" ? "Today" : r === "all" ? "All" : r}
            </button>
          ))}
        </div>
      </div>

      {loading && !summary && (
        <div className="text-sm text-muted-foreground">Loading audit data...</div>
      )}

      {summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Total Logins</div>
                <div className="bg-white dark:bg-background rounded-md px-2 py-1 mt-1">
                  <div className="text-xl font-mono font-semibold">{summary.total_logins}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Active Users</div>
                <div className="bg-white dark:bg-background rounded-md px-2 py-1 mt-1">
                  <div className="text-xl font-mono font-semibold">{summary.active_users}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Total Actions</div>
                <div className="bg-white dark:bg-background rounded-md px-2 py-1 mt-1">
                  <div className="text-xl font-mono font-semibold">{summary.total_actions}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-2 pb-2">
                <div className="text-xs text-muted-foreground">Most Active Page</div>
                <div className="bg-white dark:bg-background rounded-md px-2 py-1 mt-1">
                  <div className="text-xl font-mono font-semibold truncate">{mostActivePage}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Logins Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                {summary.logins_by_day.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={summary.logins_by_day}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="var(--chart-1, #2563eb)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-muted-foreground">No login data</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Actions by Category</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={categoryData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                        {categoryData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-muted-foreground">No action data</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Page Views</CardTitle>
              </CardHeader>
              <CardContent>
                {pageData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={pageData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip />
                      <Bar dataKey="value" fill="var(--chart-2, #16a34a)" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-muted-foreground">No page view data</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Tabbed section */}
          <Tabs defaultValue="sessions">
            <TabsList>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              <TabsTrigger value="logins">Logins</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
              <TabsTrigger value="pageviews">Page Views</TabsTrigger>
            </TabsList>

            {/* Sessions Tab */}
            <TabsContent value="sessions">
              <Card className="mt-2">
                <CardContent className="pt-4">
                  {selectedSession ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-medium">
                            Session {truncId(selectedSession.browser_session_id)}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            User: {selectedSession.user_id} | Login: {formatTimestamp(selectedSession.logged_in_at)}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedSession(null)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Back to sessions
                        </button>
                      </div>
                      {timelineLoading ? (
                        <p className="text-xs text-muted-foreground">Loading timeline...</p>
                      ) : timeline.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No timeline events</p>
                      ) : (
                        <div className="border rounded-md overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Type</TableHead>
                                <TableHead className="text-xs">Time</TableHead>
                                <TableHead className="text-xs">Detail</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {timeline.map((evt, i) => (
                                <TableRow key={i}>
                                  <TableCell className="text-xs">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                      evt.type === "login"
                                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                        : evt.type === "action"
                                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                          : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                    }`}>
                                      {evt.type}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-xs font-mono">{formatTimestamp(evt.timestamp)}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {evt.type === "action"
                                      ? `${evt.detail.action_category ?? ""} / ${evt.detail.action_type ?? ""}${evt.detail.resource_name ? ` (${evt.detail.resource_name})` : ""}`
                                      : evt.type === "page_view"
                                        ? `${evt.detail.page_name ?? ""}${evt.detail.duration_seconds != null ? ` (${formatDuration(evt.detail.duration_seconds as number)})` : ""}`
                                        : "Logged in"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  ) : sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sessions found</p>
                  ) : (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Session</TableHead>
                            <TableHead className="text-xs">User</TableHead>
                            <TableHead className="text-xs">Login Time</TableHead>
                            <TableHead className="text-xs text-right">Actions</TableHead>
                            <TableHead className="text-xs text-right">Page Views</TableHead>
                            <TableHead className="text-xs">Last Activity</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sessions.map((s) => (
                            <TableRow
                              key={s.browser_session_id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => void handleSessionClick(s)}
                            >
                              <TableCell className="text-xs font-mono">{truncId(s.browser_session_id)}</TableCell>
                              <TableCell className="text-xs">{s.user_id}</TableCell>
                              <TableCell className="text-xs font-mono">{formatTimestamp(s.logged_in_at)}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{s.action_count}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{s.page_view_count}</TableCell>
                              <TableCell className="text-xs font-mono">
                                {s.last_activity_at ? formatTimestamp(s.last_activity_at) : "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Logins Tab */}
            <TabsContent value="logins">
              <Card className="mt-2">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Filter by user ID..."
                      value={loginUserFilter}
                      onChange={(e) => setLoginUserFilter(e.target.value)}
                      className="h-8 w-64 text-xs"
                    />
                  </div>
                  {filteredLogins.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No logins found</p>
                  ) : (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">User ID</TableHead>
                            <TableHead className="text-xs">Session ID</TableHead>
                            <TableHead className="text-xs">Login Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredLogins.map((l) => (
                            <TableRow key={l.id}>
                              <TableCell className="text-xs">{l.user_id}</TableCell>
                              <TableCell className="text-xs font-mono">{truncId(l.browser_session_id)}</TableCell>
                              <TableCell className="text-xs font-mono">{formatTimestamp(l.logged_in_at)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Actions Tab */}
            <TabsContent value="actions">
              <Card className="mt-2">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Select value={actionCategoryFilter} onValueChange={(v) => { setActionCategoryFilter(v); setActionTypeFilter("all"); }}>
                      <SelectTrigger className="h-8 w-48 text-xs">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {categoryOptions.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
                      <SelectTrigger className="h-8 w-48 text-xs">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {typeOptions.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {filteredActions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No actions found</p>
                  ) : (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">User</TableHead>
                            <TableHead className="text-xs">Session</TableHead>
                            <TableHead className="text-xs">Category</TableHead>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs">Resource</TableHead>
                            <TableHead className="text-xs">Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredActions.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell className="text-xs">{a.user_id}</TableCell>
                              <TableCell className="text-xs font-mono">{truncId(a.browser_session_id)}</TableCell>
                              <TableCell className="text-xs">{a.action_category}</TableCell>
                              <TableCell className="text-xs">{a.action_type}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{a.resource_name ?? "-"}</TableCell>
                              <TableCell className="text-xs font-mono">{formatTimestamp(a.performed_at)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Page Views Tab */}
            <TabsContent value="pageviews">
              <Card className="mt-2">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Select value={pageNameFilter} onValueChange={setPageNameFilter}>
                      <SelectTrigger className="h-8 w-48 text-xs">
                        <SelectValue placeholder="Page" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Pages</SelectItem>
                        {pageOptions.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {filteredPageViews.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No page views found</p>
                  ) : (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">User</TableHead>
                            <TableHead className="text-xs">Session</TableHead>
                            <TableHead className="text-xs">Page</TableHead>
                            <TableHead className="text-xs">Entered At</TableHead>
                            <TableHead className="text-xs">Duration</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredPageViews.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell className="text-xs">{p.user_id}</TableCell>
                              <TableCell className="text-xs font-mono">{truncId(p.browser_session_id)}</TableCell>
                              <TableCell className="text-xs">{p.page_name}</TableCell>
                              <TableCell className="text-xs font-mono">{formatTimestamp(p.entered_at)}</TableCell>
                              <TableCell className="text-xs font-mono">{formatDuration(p.duration_seconds)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
