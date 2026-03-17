import { useState, useEffect, useCallback } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TimezoneProvider,
  useTimezone,
} from "@/contexts/TimezoneContext";
import { ThemeProvider, useTheme, isLightTheme } from "@/contexts/ThemeContext";
import { useAgents } from "@/hooks/useAgents";
import { useSessions } from "@/hooks/useSessions";
import { getSession, getInvocation } from "@/api/invocations";
import { CatalogPage } from "@/pages/CatalogPage";
import { AgentListPage } from "@/pages/AgentListPage";
import { AgentDetailPage } from "@/pages/AgentDetailPage";
import { SessionDetailPage } from "@/pages/SessionDetailPage";
import { InvocationDetailPage } from "@/pages/InvocationDetailPage";
import { SecurityAdminPage } from "@/pages/SecurityAdminPage";
import { MemoryManagementPage } from "@/pages/MemoryManagementPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TaggingPage } from "@/pages/TaggingPage";
import { McpServersPage } from "@/pages/McpServersPage";
import { A2aAgentsPage } from "@/pages/A2aAgentsPage";
import type { SessionResponse, InvocationResponse } from "@/api/types";
import { AuthProvider, useAuth, type Scope } from "@/contexts/AuthContext";
import { LoginPage } from "@/pages/LoginPage";
import { BookOpen, Shield, Bot, Brain, Network, Users, LogOut, User, Settings, Eye, Tags } from "lucide-react";

type Persona = "catalog" | "security" | "builder" | "memory" | "tagging" | "settings" | "mcp" | "a2a";

const GROUP_SCOPES: Record<string, Scope[]> = {
  "super-admins": [
    "catalog:read", "catalog:write", "agent:read", "agent:write",
    "memory:read", "memory:write", "security:read", "security:write",
    "settings:read", "settings:write", "mcp:read", "mcp:write",
    "a2a:read", "a2a:write", "invoke",
  ],
  "demo-admins": [
    "catalog:read", "agent:read", "memory:read", "security:read",
    "settings:read", "mcp:read", "a2a:read",
    "catalog:write", "agent:write", "memory:write", "security:write",
    "settings:write", "mcp:write", "a2a:write", "invoke",
  ],
  "security-admins": ["security:read", "security:write"],
  "memory-admins": ["memory:read", "memory:write"],
  "mcp-admins": ["mcp:read", "mcp:write"],
  "a2a-admins": ["a2a:read", "a2a:write"],
  "users": ["invoke"],
};

const USER_GROUPS: Record<string, string[]> = {
  "admin": ["super-admins"],
  "demo-admin-1": ["demo-admins"],
  "demo-admin-2": ["demo-admins"],
  "security-admin": ["security-admins"],
  "integration-admin": ["memory-admins", "mcp-admins", "a2a-admins"],
  "demo-user-1": ["users"],
  "demo-user-2": ["users"],
};

const VIEW_AS_USERS = Object.keys(USER_GROUPS);

function SidebarClock() {
  const { timezone } = useTimezone();

  const formatTime = () => {
    const now = new Date();
    const opts: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: timezone === "UTC" ? "UTC" : undefined,
    };
    return now.toLocaleTimeString(undefined, opts);
  };

  const [time, setTime] = useState(formatTime);

  useEffect(() => {
    const id = setInterval(() => setTime(formatTime()), 1000);
    return () => clearInterval(id);
  });

  return (
    <span className="text-[10px] text-muted-foreground tabular-nums">{time}</span>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
        disabled
          ? "text-muted-foreground/50 cursor-not-allowed"
          : active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {badge && <span className="text-[10px] italic shrink-0">{badge}</span>}
    </button>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, user, logout, hasScope } = useAuth();
  const { theme } = useTheme();
  const [activePersona, setActivePersona] = useState<Persona>("catalog");
  const [viewAsUser, setViewAsUser] = useState<string | null>(null);

  const isAdmin = user?.groups?.includes("super-admins") ?? false;

  const effectiveHasScope = useCallback(
    (scope: Scope) => {
      if (!viewAsUser) return hasScope(scope);
      const groups = USER_GROUPS[viewAsUser] ?? [];
      return groups.some((g) => (GROUP_SCOPES[g] ?? []).includes(scope));
    },
    [viewAsUser, hasScope],
  );

  // Compute group restriction for resource creation.
  // super-admins: no restriction; demo-admins: locked to "demo-admins"; others: locked to first group name
  const effectiveGroups = viewAsUser
    ? (USER_GROUPS[viewAsUser] ?? [])
    : (user?.groups ?? []);
  const groupRestriction = effectiveGroups.includes("super-admins")
    ? undefined
    : effectiveGroups.find((g) => g !== "users");

  const { agents, loading, deleteStartTimes, fetchAgents, registerAgent, deployAgent, redeployAgent, refreshAgent, deleteAgent } = useAgents();

  // Re-fetch agents after authentication completes (initial fetch may race with login)
  useEffect(() => {
    if (isAuthenticated) void fetchAgents();
  }, [isAuthenticated, fetchAgents]);

  type ViewMode = "cards" | "table";
  const [catalogViewMode, setCatalogViewMode] = useState<ViewMode>("cards");
  const [agentsViewMode, setAgentsViewMode] = useState<ViewMode>("cards");
  const [memoryViewMode, setMemoryViewMode] = useState<ViewMode>("cards");
  const [mcpViewMode, setMcpViewMode] = useState<ViewMode>("cards");
  const [a2aViewMode, setA2aViewMode] = useState<ViewMode>("cards");
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionResponse | null>(null);
  const [selectedInvocationId, setSelectedInvocationId] = useState<string | null>(null);
  const [invocationDetail, setInvocationDetail] = useState<InvocationResponse | null>(null);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const { sessions, loading: sessionsLoading, refetch: refetchSessions } =
    useSessions(selectedAgentId);

  // Fetch session detail when selected
  useEffect(() => {
    if (selectedAgentId === null || selectedSessionId === null) {
      setSessionDetail(null);
      return;
    }
    void getSession(selectedAgentId, selectedSessionId).then(setSessionDetail);
  }, [selectedAgentId, selectedSessionId]);

  // Fetch invocation detail when selected
  useEffect(() => {
    if (selectedAgentId === null || selectedSessionId === null || selectedInvocationId === null) {
      setInvocationDetail(null);
      return;
    }
    void getInvocation(selectedAgentId, selectedSessionId, selectedInvocationId).then(setInvocationDetail);
  }, [selectedAgentId, selectedSessionId, selectedInvocationId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const handleBack = () => {
    if (selectedInvocationId) {
      setSelectedInvocationId(null);
      setInvocationDetail(null);
    } else if (selectedSessionId) {
      setSelectedSessionId(null);
      setSessionDetail(null);
    } else {
      setSelectedAgentId(null);
      void fetchAgents();
    }
  };



  const handleDelete = async (id: number, cleanupAws: boolean) => {
    try {
      await deleteAgent(id, cleanupAws);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // Breadcrumb (only for catalog persona drill-down)
  const breadcrumb: { label: string; onClick?: () => void }[] = [
    {
      label: "Agents",
      onClick: selectedAgentId
        ? () => {
            setSelectedAgentId(null);
            setSelectedSessionId(null);
            setSessionDetail(null);
            setSelectedInvocationId(null);
            setInvocationDetail(null);
            void fetchAgents();
          }
        : undefined,
    },
  ];

  if (selectedAgent) {
    breadcrumb.push({
      label: selectedAgent.name ?? selectedAgent.runtime_id,
      onClick: selectedSessionId
        ? () => {
            setSelectedSessionId(null);
            setSessionDetail(null);
            setSelectedInvocationId(null);
            setInvocationDetail(null);
          }
        : undefined,
    });
  }

  if (selectedSessionId) {
    breadcrumb.push({
      label: selectedSessionId,
      onClick: selectedInvocationId
        ? () => {
            setSelectedInvocationId(null);
            setInvocationDetail(null);
          }
        : undefined,
    });
  }

  if (selectedInvocationId) {
    breadcrumb.push({ label: selectedInvocationId });
  }

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 border-r bg-card flex flex-col shrink-0 h-screen overflow-y-auto">
        <div className="p-4 border-b">
          <img
            src={isLightTheme(theme) ? "/assets/loom_light_alt.png" : "/assets/loom_dark_alt.png"}
            alt="Loom"
            className="h-15"
          />
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <SidebarItem
            icon={BookOpen}
            label="Catalog"
            active={activePersona === "catalog"}
            onClick={() => setActivePersona("catalog")}
          />
          {(effectiveHasScope("agent:read") || effectiveHasScope("agent:write")) && (
            <SidebarItem
              icon={Bot}
              label="Agents"
              active={activePersona === "builder"}
              onClick={() => setActivePersona("builder")}
            />
          )}
          {(effectiveHasScope("memory:read") || effectiveHasScope("memory:write")) && (
            <SidebarItem
              icon={Brain}
              label="Memory"
              active={activePersona === "memory"}
              onClick={() => setActivePersona("memory")}
            />
          )}
          {(effectiveHasScope("security:read") || effectiveHasScope("security:write")) && (
            <SidebarItem
              icon={Shield}
              label="Security"
              active={activePersona === "security"}
              onClick={() => setActivePersona("security")}
            />
          )}
          <SidebarItem
            icon={Tags}
            label="Tagging"
            active={activePersona === "tagging"}
            onClick={() => setActivePersona("tagging")}
          />
          <SidebarItem
            icon={Settings}
            label="Settings"
            active={activePersona === "settings"}
            onClick={() => setActivePersona("settings")}
          />
          {(effectiveHasScope("mcp:read") || effectiveHasScope("mcp:write")) && (
            <SidebarItem
              icon={Network}
              label="MCP Servers"
              active={activePersona === "mcp"}
              onClick={() => setActivePersona("mcp")}
            />
          )}
          {(effectiveHasScope("a2a:read") || effectiveHasScope("a2a:write")) && (
            <SidebarItem
              icon={Users}
              label="A2A Agents"
              active={activePersona === "a2a"}
              onClick={() => setActivePersona("a2a")}
            />
          )}
        </nav>
        <div className="p-2 border-t space-y-1">
          {user && (
            <div className="px-3 py-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate">
                  {user.username || "User"}
                </span>
              </div>
              <button
                type="button"
                onClick={logout}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {isAdmin && (
            <div className="px-3 py-1">
              <Select value={viewAsUser ?? "admin"} onValueChange={(v) => setViewAsUser(v === "admin" ? null : v)}>
                <SelectTrigger className="h-7 w-full gap-1 text-xs text-muted-foreground">
                  <Eye className="h-3 w-3 shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIEW_AS_USERS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="px-3 py-1 flex items-center justify-between">
            <span className="inline-flex items-center rounded-full border border-border bg-input-bg px-2 py-0.5">
              <SidebarClock />
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-input-bg px-2 py-0.5 text-[10px] text-muted-foreground">
              v{__APP_VERSION__}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {activePersona === "catalog" && selectedAgentId !== null && (
          <header className="border-b">
            <div className="max-w-6xl px-8 py-3 flex items-center justify-between gap-4">
              <nav className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
                {breadcrumb.map((item, i) => (
                  <span key={i} className="flex items-center gap-1 min-w-0">
                    {i > 0 && <span className="shrink-0">/</span>}
                    {item.onClick ? (
                      <button
                        onClick={item.onClick}
                        className="hover:text-foreground transition-colors truncate"
                      >
                        {item.label}
                      </button>
                    ) : (
                      <span className="text-foreground truncate">{item.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            </div>
          </header>
        )}

        <main className="max-w-6xl px-8 py-6 flex-1 w-full">
          {activePersona === "catalog" && (
            <>
              {selectedAgentId !== null && (
                <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
                  &larr; Back
                </Button>
              )}

              {selectedAgentId === null && (
                <CatalogPage
                  agents={agents}
                  loading={loading}
                  viewMode={catalogViewMode}
                  onViewModeChange={setCatalogViewMode}
                  onSelectAgent={setSelectedAgentId}
                  onRefreshAgent={refreshAgent}
                  onDelete={handleDelete}
                  readOnly={!effectiveHasScope("agent:write")}
                  agentDeleteStartTimes={deleteStartTimes}
                />
              )}

              {selectedAgent && !selectedSessionId && (
                <AgentDetailPage
                  agent={selectedAgent}
                  sessions={sessions}
                  sessionsLoading={sessionsLoading}
                  onSelectSession={setSelectedSessionId}
                  onSessionsRefresh={() => void refetchSessions()}
                  onRedeploy={async (id) => { await redeployAgent(id); }}
                />
              )}

              {selectedAgent && sessionDetail && !selectedInvocationId && (
                <SessionDetailPage
                  agent={selectedAgent}
                  session={sessionDetail}
                  onSelectInvocation={setSelectedInvocationId}
                />
              )}

              {selectedAgent && sessionDetail && invocationDetail && (
                <InvocationDetailPage
                  agent={selectedAgent}
                  session={sessionDetail}
                  invocation={invocationDetail}
                />
              )}
            </>
          )}

          {activePersona === "builder" && (
            <AgentListPage
              agents={agents}
              loading={loading}
              viewMode={agentsViewMode}
              onViewModeChange={setAgentsViewMode}
              onRegister={registerAgent}
              onDeploy={deployAgent}
              onSelectAgent={(id) => {
                setSelectedAgentId(id);
                setActivePersona("catalog");
              }}
              onRefreshAgent={refreshAgent}
              onDelete={handleDelete}
              readOnly={!effectiveHasScope("agent:write")}
              groupRestriction={groupRestriction}
              deleteStartTimes={deleteStartTimes}
            />
          )}

          {activePersona === "security" && <SecurityAdminPage readOnly={!effectiveHasScope("security:write")} />}
          {activePersona === "memory" && <MemoryManagementPage viewMode={memoryViewMode} onViewModeChange={setMemoryViewMode} readOnly={!effectiveHasScope("memory:write")} groupRestriction={groupRestriction} />}
          {activePersona === "tagging" && <TaggingPage readOnly={!(effectiveHasScope("agent:write") || effectiveHasScope("security:write") || effectiveHasScope("memory:write"))} />}
          {activePersona === "mcp" && <McpServersPage viewMode={mcpViewMode} onViewModeChange={setMcpViewMode} readOnly={!effectiveHasScope("mcp:write")} />}
          {activePersona === "a2a" && <A2aAgentsPage viewMode={a2aViewMode} onViewModeChange={setA2aViewMode} readOnly={!effectiveHasScope("a2a:write")} />}
          {activePersona === "settings" && <SettingsPage />}
        </main>
      </div>

      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <TimezoneProvider>
          <AppContent />
        </TimezoneProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
