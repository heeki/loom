import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Plus, Brain, LogOut, Bot, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listAgents } from "@/api/agents";
import { listSessions, getSession } from "@/api/invocations";
import { listMemories } from "@/api/memories";
import { useInvoke, clearInvokeState } from "@/hooks/useInvoke";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, isLightTheme } from "@/contexts/ThemeContext";
import type { AgentResponse, SessionResponse, MemoryResponse } from "@/api/types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface ChatPageProps {
  userGroups: string[];
  onLogout: () => void;
  viewAsUser?: string | null;
  onExitViewAs?: () => void;
}

const LONG_TERM_STRATEGY_TYPES = ["semantic", "summary", "user_preference", "episodic"];

export function ChatPage({ userGroups, onLogout, viewAsUser, onExitViewAs }: ChatPageProps) {
  const { user } = useAuth();
  const { theme } = useTheme();

  const userGroupNames = userGroups
    .filter((g) => g.startsWith("g-users-"))
    .map((g) => g.replace("g-users-", ""));

  const currentUserId = user?.username ?? user?.sub;

  // Agent state
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  // Session state
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [input, setInput] = useState("");

  // Memory panel state
  const [showMemory, setShowMemory] = useState(false);
  const [memories, setMemories] = useState<MemoryResponse[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load and filter agents by group
  useEffect(() => {
    setAgentsLoading(true);
    listAgents()
      .then((all) => {
        const accessible = all.filter((a) => {
          const group = (a.tags["loom:group"] as string | undefined) ?? "";
          return !group || userGroupNames.includes(group);
        });
        setAgents(accessible);
        if (accessible.length === 1) {
          const first = accessible[0];
          if (first) setSelectedAgentId(first.id);
        }
      })
      .catch(() => {})
      .finally(() => setAgentsLoading(false));
  }, []);

  // Load sessions for selected agent (user-scoped)
  useEffect(() => {
    if (selectedAgentId === null) {
      setSessions([]);
      return;
    }
    listSessions(selectedAgentId)
      .then((data) => {
        // Filter to current user's sessions only
        const userSessions = data.filter(
          (s) => !s.user_id || !currentUserId || s.user_id === currentUserId,
        );
        setSessions(userSessions);
      })
      .catch(() => {});
  }, [selectedAgentId, currentUserId]);

  // Load memories for selected agent
  useEffect(() => {
    if (!selectedAgentId) {
      setMemories([]);
      return;
    }
    const agent = agents.find((a) => a.id === selectedAgentId);
    if (!agent || agent.memory_names.length === 0) {
      setMemories([]);
      return;
    }
    listMemories()
      .then((all) => {
        setMemories(all.filter((m) => agent.memory_names.includes(m.name)));
      })
      .catch(() => {});
  }, [selectedAgentId, agents]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const { streamedText, sessionEnd, isStreaming, error, invoke, cancel } = useInvoke(
    selectedAgentId ?? 0,
  );

  // When invocation completes, move in-flight messages into persistent history
  const lastSessionEndRef = useRef<typeof sessionEnd>(null);
  const pendingPromptRef = useRef<string | null>(null);
  pendingPromptRef.current = pendingPrompt;

  useEffect(() => {
    if (sessionEnd && sessionEnd !== lastSessionEndRef.current && pendingPromptRef.current) {
      const prompt = pendingPromptRef.current;
      lastSessionEndRef.current = sessionEnd;
      setMessages((prev) => [
        ...prev,
        { id: `user-${sessionEnd.invocation_id}`, role: "user", text: prompt },
        { id: `assistant-${sessionEnd.invocation_id}`, role: "assistant", text: streamedText },
      ]);
      setPendingPrompt(null);
      setCurrentSessionId(sessionEnd.session_id);
      // Refresh sessions list
      if (selectedAgentId !== null) {
        listSessions(selectedAgentId)
          .then((data) => {
            const userSessions = data.filter(
              (s) => !s.user_id || !currentUserId || s.user_id === currentUserId,
            );
            setSessions(userSessions);
          })
          .catch(() => {});
      }
    }
  }, [sessionEnd, streamedText, selectedAgentId, currentUserId]);

  // Clear pending prompt on error
  useEffect(() => {
    if (error && pendingPrompt && !isStreaming) {
      setPendingPrompt(null);
    }
  }, [error, pendingPrompt, isStreaming]);

  // Scroll to bottom on new messages or streaming updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamedText, isStreaming]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming || selectedAgentId === null) return;
    const prompt = input.trim();
    setInput("");
    setPendingPrompt(prompt);
    await invoke(prompt, "DEFAULT", currentSessionId ?? undefined);
  }, [input, isStreaming, selectedAgentId, currentSessionId, invoke]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setCurrentSessionId(null);
    setPendingPrompt(null);
    if (selectedAgentId !== null) clearInvokeState(selectedAgentId);
  }, [selectedAgentId]);

  const handleSelectAgent = useCallback(
    (id: number) => {
      if (id === selectedAgentId) return;
      handleNewConversation();
      setSelectedAgentId(id);
    },
    [selectedAgentId, handleNewConversation],
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (selectedAgentId === null) return;
      try {
        const session = await getSession(selectedAgentId, sessionId);
        const msgs: ChatMessage[] = [];
        for (const inv of session.invocations) {
          if (inv.prompt_text) {
            msgs.push({ id: `user-${inv.invocation_id}`, role: "user", text: inv.prompt_text });
          }
          if (inv.response_text) {
            msgs.push({
              id: `assistant-${inv.invocation_id}`,
              role: "assistant",
              text: inv.response_text,
            });
          }
        }
        setMessages(msgs);
        setCurrentSessionId(sessionId);
        setPendingPrompt(null);
      } catch {
        // silently fail
      }
    },
    [selectedAgentId],
  );

  const hasMemory = selectedAgent && selectedAgent.memory_names.length > 0;

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* View-as banner for admins previewing the end-user experience */}
      {viewAsUser && onExitViewAs && (
        <div className="shrink-0 bg-primary/10 border-b border-primary/20 px-4 py-1.5 flex items-center justify-between text-xs text-primary">
          <span>
            Previewing end-user experience as <strong>{viewAsUser}</strong>
          </span>
          <button onClick={onExitViewAs} className="hover:underline font-medium">
            Exit preview
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r bg-card flex flex-col shrink-0 h-full overflow-hidden">
          {/* Logo */}
          <div className="p-4 border-b shrink-0">
            <img
              src={
                isLightTheme(theme)
                  ? "/assets/loom_light_alt.png"
                  : "/assets/loom_dark_alt.png"
              }
              alt="Loom"
              className="h-8"
            />
          </div>

          {/* Agent picker (shown when multiple agents available) */}
          {agents.length > 1 && (
            <div className="p-3 border-b shrink-0">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Agent</p>
              <div className="space-y-1">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleSelectAgent(a.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      selectedAgentId === a.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <span className="truncate block">{a.name ?? a.runtime_id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* New conversation button */}
          <div className="p-3 border-b shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={handleNewConversation}
              disabled={selectedAgentId === null}
            >
              <Plus className="h-3.5 w-3.5" />
              New Conversation
            </Button>
          </div>

          {/* Conversation history */}
          <div className="flex-1 overflow-y-auto p-2">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Conversations</p>
            {sessions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">No conversations yet</p>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.session_id}
                  onClick={() => void handleSelectSession(session.session_id)}
                  className={`w-full text-left px-3 py-2 rounded text-xs hover:bg-accent transition-colors ${
                    currentSessionId === session.session_id ? "bg-accent" : ""
                  }`}
                >
                  <div className="font-medium truncate">
                    {session.created_at
                      ? new Date(session.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : session.session_id.slice(0, 12) + "..."}
                  </div>
                  <div className="text-muted-foreground">
                    {session.invocations.length}{" "}
                    {session.invocations.length === 1 ? "message" : "messages"}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Memory button */}
          {hasMemory && (
            <div className="p-3 border-t shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => setShowMemory((v) => !v)}
              >
                <Brain className="h-3.5 w-3.5" />
                My Memory
              </Button>
            </div>
          )}

          {/* User info + logout */}
          <div className="p-3 border-t shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate">
                {user?.username ?? "User"}
              </span>
            </div>
            <button
              onClick={onLogout}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </aside>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {agentsLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-muted-foreground text-sm">Loading...</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Bot className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground">No agents available for your account.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Contact your administrator for access.
                </p>
              </div>
            </div>
          ) : selectedAgentId === null ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Bot className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground">Select an agent to start chatting</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="border-b px-6 py-3 flex items-center gap-3 shrink-0">
                <Bot className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="font-medium">
                  {selectedAgent?.name ?? selectedAgent?.runtime_id ?? "Agent"}
                </span>
                {isStreaming && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    responding...
                  </span>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 && !isStreaming && !pendingPrompt && (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-muted-foreground">
                      <p className="text-sm">
                        Start a conversation with{" "}
                        {selectedAgent?.name ?? "the agent"}
                      </p>
                      <p className="text-xs mt-1">
                        Type a message below to begin
                      </p>
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble key={msg.id} role={msg.role} text={msg.text} />
                ))}

                {/* In-flight user message */}
                {pendingPrompt && !messages.some((m) => m.text === pendingPrompt) && (
                  <MessageBubble role="user" text={pendingPrompt} />
                )}

                {/* Streaming assistant response */}
                {(isStreaming || (pendingPrompt !== null && streamedText)) && (
                  <MessageBubble
                    role="assistant"
                    text={streamedText}
                    isStreaming={isStreaming}
                  />
                )}

                {/* Error display */}
                {error && !isStreaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[70%] rounded-2xl px-4 py-3 bg-destructive/10 text-destructive text-sm">
                      {error}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t p-4 shrink-0">
                <div className="flex gap-3 items-end max-w-3xl mx-auto">
                  <Textarea
                    placeholder="Message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    className="resize-none flex-1"
                    disabled={isStreaming}
                  />
                  {isStreaming ? (
                    <Button variant="outline" size="icon" onClick={cancel} title="Cancel">
                      <X className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      onClick={() => void handleSend()}
                      disabled={!input.trim()}
                      title="Send"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Memory panel (right side drawer) */}
        {showMemory && (
          <MemoryPanel
            memories={memories}
            sessions={sessions}
            currentSessionId={currentSessionId}
            onClose={() => setShowMemory(false)}
          />
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  text,
  isStreaming,
}: {
  role: "user" | "assistant";
  text: string;
  isStreaming?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {text}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-text-bottom opacity-70" />
        )}
      </div>
    </div>
  );
}

interface StrategyEntry {
  name: string;
  description: string;
}

function MemoryPanel({
  memories,
  sessions,
  currentSessionId,
  onClose,
}: {
  memories: MemoryResponse[];
  sessions: SessionResponse[];
  currentSessionId: string | null;
  onClose: () => void;
}) {
  const sessionStrategies: StrategyEntry[] = [];
  const longTermStrategies: StrategyEntry[] = [];

  for (const mem of memories) {
    if (!mem.strategies_config) continue;
    const strategies = mem.strategies_config as Array<{
      strategy_type: string;
      name: string;
      description?: string;
    }>;
    for (const strat of strategies) {
      const entry: StrategyEntry = {
        name: strat.name,
        description: strat.description ?? "",
      };
      if (LONG_TERM_STRATEGY_TYPES.includes(strat.strategy_type)) {
        longTermStrategies.push(entry);
      } else {
        sessionStrategies.push(entry);
      }
    }
  }

  // Current session's invocation count for session memory display
  const currentSession = sessions.find((s) => s.session_id === currentSessionId);
  const sessionMessageCount = currentSession?.invocations.length ?? 0;

  return (
    <div className="w-72 border-l bg-card flex flex-col h-full shrink-0">
      <div className="p-4 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4" />
          <span className="font-medium text-sm">My Memory</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Session memory section */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Session Memory
          </h3>
          {currentSessionId ? (
            <div className="rounded border p-3 text-sm">
              <p className="text-muted-foreground text-xs">
                Current conversation:{" "}
                <span className="font-medium text-foreground">
                  {sessionMessageCount} {sessionMessageCount === 1 ? "exchange" : "exchanges"}
                </span>
              </p>
              {sessionStrategies.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {sessionStrategies.map((s, i) => (
                    <div key={i}>
                      <div className="font-medium text-xs">{s.name}</div>
                      {s.description && (
                        <div className="text-xs text-muted-foreground">{s.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground px-1">
              Start a conversation to see session memory.
            </p>
          )}
        </div>

        {/* Long-term memory section */}
        {longTermStrategies.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              What I Remember About You
            </h3>
            <div className="space-y-2">
              {longTermStrategies.map((s, i) => (
                <div key={i} className="rounded border p-3">
                  <div className="text-sm font-medium">{s.name}</div>
                  {s.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {sessionStrategies.length === 0 && longTermStrategies.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No memory configured for this agent.
          </p>
        )}

        <p className="text-xs text-muted-foreground pt-4 border-t">
          Memory is managed automatically by the agent during your conversations.
        </p>
      </div>
    </div>
  );
}
