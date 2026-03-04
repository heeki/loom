import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
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
import { AgentListPage } from "@/pages/AgentListPage";
import { AgentDetailPage } from "@/pages/AgentDetailPage";
import { SessionDetailPage } from "@/pages/SessionDetailPage";
import { InvocationDetailPage } from "@/pages/InvocationDetailPage";
import type { SessionResponse, InvocationResponse } from "@/api/types";

type Theme = "light" | "dark";

function ThemeSelector({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
      <SelectTrigger className="h-7 w-auto gap-1 text-xs text-muted-foreground">
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
      <SelectTrigger className="h-7 w-auto gap-1 text-xs text-muted-foreground">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="local">{localTz}</SelectItem>
        <SelectItem value="UTC">UTC</SelectItem>
      </SelectContent>
    </Select>
  );
}

function AppContent() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const { agents, loading, fetchAgents, registerAgent, deployAgent, redeployAgent, refreshAgent, deleteAgent } = useAgents();
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

  // Breadcrumb
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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={theme === "light" ? "/assets/loom_light_alt.png" : "/assets/loom_dark_alt.png"}
              alt="Loom"
              className="h-12 shrink-0"
            />
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
          <div className="flex items-center gap-3 shrink-0">
            <ThemeSelector theme={theme} setTheme={setTheme} />
            <TimezoneSelector />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {selectedAgentId !== null && (
          <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
            &larr; Back
          </Button>
        )}

        {selectedAgentId === null && (
          <AgentListPage
            agents={agents}
            loading={loading}
            onSelectAgent={setSelectedAgentId}
            onRegister={registerAgent}
            onDeploy={deployAgent}
            onRefresh={refreshAgent}
            onDelete={deleteAgent}
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
      </main>

      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <TimezoneProvider>
      <AppContent />
    </TimezoneProvider>
  );
}
