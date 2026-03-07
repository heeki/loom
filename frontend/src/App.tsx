import { useState, useEffect } from "react";
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
  type TimezonePreference,
} from "@/contexts/TimezoneContext";
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
import type { SessionResponse, InvocationResponse } from "@/api/types";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LoginPage } from "@/pages/LoginPage";
import { BookOpen, Shield, Bot, Brain, Network, Users, LogOut, User } from "lucide-react";

type Theme = "light" | "dark";
type Persona = "catalog" | "security" | "builder" | "memory";

function ThemeSelector({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
      <SelectTrigger className="h-7 w-full gap-1 text-xs text-muted-foreground">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value="light">Latte</SelectItem>
        <SelectItem value="dark">Mocha</SelectItem>
      </SelectContent>
    </Select>
  );
}

function TimezoneSelector() {
  const { timezone, setTimezone } = useTimezone();
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Select
      value={timezone}
      onValueChange={(v) => setTimezone(v as TimezonePreference)}
    >
      <SelectTrigger className="h-7 w-full gap-1 text-xs text-muted-foreground">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="local">{localTz}</SelectItem>
        <SelectItem value="UTC">UTC</SelectItem>
      </SelectContent>
    </Select>
  );
}

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
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [activePersona, setActivePersona] = useState<Persona>("catalog");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const { agents, loading, fetchAgents, registerAgent, deployAgent, redeployAgent, refreshAgent, deleteAgent } = useAgents();
  type ViewMode = "cards" | "table";
  const [catalogViewMode, setCatalogViewMode] = useState<ViewMode>("cards");
  const [agentsViewMode, setAgentsViewMode] = useState<ViewMode>("cards");
  const [memoryViewMode, setMemoryViewMode] = useState<ViewMode>("cards");
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
      toast.success(cleanupAws ? "Agent removed from Loom and AgentCore" : "Agent removed from Loom");
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
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-56 border-r bg-card flex flex-col shrink-0">
        <div className="p-4 border-b">
          <img
            src={theme === "light" ? "/assets/loom_light_alt.png" : "/assets/loom_dark_alt.png"}
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
          <SidebarItem
            icon={Bot}
            label="Agents"
            active={activePersona === "builder"}
            onClick={() => setActivePersona("builder")}
          />
          <SidebarItem
            icon={Brain}
            label="Memory"
            active={activePersona === "memory"}
            onClick={() => setActivePersona("memory")}
          />
          <SidebarItem
            icon={Shield}
            label="Security"
            active={activePersona === "security"}
            onClick={() => setActivePersona("security")}
          />
          <SidebarItem
            icon={Network}
            label="MCP Servers"
            active={false}
            onClick={() => {}}
            disabled
          />
          <SidebarItem
            icon={Users}
            label="A2A Agents"
            active={false}
            onClick={() => {}}
            disabled
          />
        </nav>
        <div className="p-2 border-t space-y-1">
          {user && (
            <div className="px-3 py-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate">
                  {user.email || user.username || "User"}
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
          <div className="px-3 py-1">
            <ThemeSelector theme={theme} setTheme={setTheme} />
          </div>
          <div className="px-3 py-1">
            <TimezoneSelector />
          </div>
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
      <div className="flex-1 min-h-screen flex flex-col">
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
              onRegister={async (arn, modelId) => {
                await registerAgent(arn, modelId);
                await fetchAgents();
              }}
              onDeploy={async (req) => {
                await deployAgent(req);
                await fetchAgents();
              }}
              onSelectAgent={(id) => {
                setSelectedAgentId(id);
                setActivePersona("catalog");
              }}
              onRefreshAgent={refreshAgent}
              onDelete={handleDelete}
            />
          )}

          {activePersona === "security" && <SecurityAdminPage />}
          {activePersona === "memory" && <MemoryManagementPage viewMode={memoryViewMode} onViewModeChange={setMemoryViewMode} />}
        </main>
      </div>

      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TimezoneProvider>
        <AppContent />
      </TimezoneProvider>
    </AuthProvider>
  );
}
