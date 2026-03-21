import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Send, Plus, Brain, LogOut, Bot, User, X, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import { CollapsibleJsonBlock } from "@/components/CollapsibleJsonBlock";
import remarkGfm from "remark-gfm";
import { listAgents } from "@/api/agents";
import { listSessions, getSession, hideSession } from "@/api/invocations";
import { listMemories, getMemoryRecords } from "@/api/memories";
import { trackAction } from "@/api/audit";
import { useInvoke, clearInvokeState } from "@/hooks/useInvoke";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, isLightTheme, THEME_LABELS, type Theme } from "@/contexts/ThemeContext";
import type { AgentResponse, SessionResponse, MemoryResponse, MemoryRecordItem } from "@/api/types";

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


export function ChatPage({ userGroups, onLogout, viewAsUser, onExitViewAs }: ChatPageProps) {
  const { user, browserSessionId } = useAuth();
  const { theme, setTheme } = useTheme();

  const userGroupNames = userGroups
    .filter((g) => g.startsWith("g-users-"))
    .map((g) => g.replace("g-users-", ""));

  const currentUserId = user?.username ?? user?.sub;

  // Agent state
  const [agents, setAgents] = useState<AgentResponse[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  // Agent list search/sort
  const [agentSearch, setAgentSearch] = useState("");
  const [agentSort, setAgentSort] = useState<"asc" | "desc">("asc");
  const [showThemePicker, setShowThemePicker] = useState(false);

  // Session state
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionToHide, setSessionToHide] = useState<string | null>(null);
  const [hidingSession, setHidingSession] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [input, setInput] = useState("");

  // Memory panel state
  const [showMemory, setShowMemory] = useState(false);
  const [memories, setMemories] = useState<MemoryResponse[]>([]);
  const [memoryRecords, setMemoryRecords] = useState<MemoryRecordItem[]>([]);
  const [memoryRecordsLoading, setMemoryRecordsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Per-agent chat state preservation (enables background streaming)
  const savedAgentState = useRef<
    Map<number, { messages: ChatMessage[]; pendingPrompt: string | null; currentSessionId: string | null }>
  >(new Map());

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

  // Load memory records when panel is opened (scoped to current user via JWT)
  useEffect(() => {
    if (!showMemory || memories.length === 0) {
      if (!showMemory) setMemoryRecords([]);
      return;
    }
    setMemoryRecordsLoading(true);
    const firstMemory = memories[0];
    if (!firstMemory) {
      setMemoryRecordsLoading(false);
      return;
    }
    getMemoryRecords(firstMemory.id)
      .then((res) => setMemoryRecords(res.records))
      .catch(() => setMemoryRecords([]))
      .finally(() => setMemoryRecordsLoading(false));
  }, [showMemory, memories]);

  const filteredAgents = useMemo(() => {
    let result = agents;
    if (agentSearch.trim()) {
      const q = agentSearch.toLowerCase();
      result = result.filter(
        (a) =>
          (a.name ?? a.runtime_id).toLowerCase().includes(q) ||
          (a.description ?? "").toLowerCase().includes(q),
      );
    }
    result = [...result].sort((a, b) => {
      const cmp = (a.name ?? a.runtime_id).localeCompare(b.name ?? b.runtime_id);
      return agentSort === "desc" ? -cmp : cmp;
    });
    return result;
  }, [agents, agentSearch, agentSort]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const { streamedText, sessionStart, sessionEnd, isStreaming, error, invoke, cancel } = useInvoke(
    selectedAgentId ?? 0,
  );

  // When a session starts, immediately refresh the sessions list so the tab appears in the sidebar
  const lastSessionStartRef = useRef<typeof sessionStart>(null);
  useEffect(() => {
    if (sessionStart && sessionStart !== lastSessionStartRef.current && selectedAgentId !== null) {
      lastSessionStartRef.current = sessionStart;
      setCurrentSessionId(sessionStart.session_id);
      listSessions(selectedAgentId)
        .then((data) => {
          const userSessions = data.filter(
            (s) => !s.user_id || !currentUserId || s.user_id === currentUserId,
          );
          setSessions(userSessions);
        })
        .catch(() => {});
    }
  }, [sessionStart, selectedAgentId, currentUserId]);

  // When invocation completes, load the authoritative session from the backend
  // and use it to populate the chat history. setPendingPrompt(null) is deferred
  // until AFTER setMessages so the streaming bubble stays visible while the
  // fetch is in progress — eliminating the flash-of-empty-content.
  const lastSessionEndRef = useRef<typeof sessionEnd>(null);
  const pendingPromptRef = useRef<string | null>(null);
  pendingPromptRef.current = pendingPrompt;
  const streamedTextRef = useRef<string>("");
  streamedTextRef.current = streamedText;

  useEffect(() => {
    if (sessionEnd && sessionEnd !== lastSessionEndRef.current && pendingPromptRef.current) {
      lastSessionEndRef.current = sessionEnd;
      setCurrentSessionId(sessionEnd.session_id);

      if (selectedAgentId !== null) {
        const sessionId = sessionEnd.session_id;
        // Load authoritative messages from the backend, then clear pendingPrompt.
        // Keeping pendingPrompt set until setMessages runs prevents the streaming
        // bubble from disappearing before the persisted messages are ready.
        getSession(selectedAgentId, sessionId)
          .then((session) => {
            const msgs: ChatMessage[] = [];
            for (const inv of session.invocations) {
              if (inv.prompt_text)
                msgs.push({ id: `user-${inv.invocation_id}`, role: "user", text: inv.prompt_text });
              if (inv.response_text)
                msgs.push({ id: `assistant-${inv.invocation_id}`, role: "assistant", text: inv.response_text });
            }
            setMessages(msgs);
            setPendingPrompt(null);
          })
          .catch(() => setPendingPrompt(null));

        listSessions(selectedAgentId)
          .then((data) => {
            const userSessions = data.filter(
              (s) => !s.user_id || !currentUserId || s.user_id === currentUserId,
            );
            setSessions(userSessions);
          })
          .catch(() => {});
      } else {
        setPendingPrompt(null);
      }
    }
  }, [sessionEnd, selectedAgentId, currentUserId]);

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
    const agentName = agents.find((a) => a.id === selectedAgentId)?.name ?? String(selectedAgentId);
    if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, "agent", "invoke", agentName);
    await invoke(prompt, "DEFAULT", currentSessionId ?? undefined);
  }, [input, isStreaming, selectedAgentId, currentSessionId, invoke, agents, user, browserSessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleConfirmHideSession = useCallback(async () => {
    if (!sessionToHide || selectedAgentId === null) return;
    setHidingSession(true);
    try {
      await hideSession(selectedAgentId, sessionToHide);
      const agentName = agents.find((a) => a.id === selectedAgentId)?.name ?? String(selectedAgentId);
      if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, "agent", "remove_conversation", agentName);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionToHide));
      // If the hidden session was active, reset to blank chat
      if (currentSessionId === sessionToHide) {
        setMessages([]);
        setCurrentSessionId(null);
        setPendingPrompt(null);
      }
      setSessionToHide(null);
    } finally {
      setHidingSession(false);
    }
  }, [sessionToHide, selectedAgentId, currentSessionId, agents, user, browserSessionId]);

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setCurrentSessionId(null);
    setPendingPrompt(null);
    lastSessionEndRef.current = null;
    lastSessionStartRef.current = null;
    if (selectedAgentId !== null) {
      clearInvokeState(selectedAgentId);
      const agentName = agents.find((a) => a.id === selectedAgentId)?.name ?? String(selectedAgentId);
      if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, "agent", "new_conversation", agentName);
    }
  }, [selectedAgentId, agents, user, browserSessionId]);

  const handleSelectAgent = useCallback(
    (id: number) => {
      if (id === selectedAgentId) return;
      const agentName = agents.find((a) => a.id === id)?.name ?? String(id);
      if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, "navigation", "agent_detail", agentName);
      // Save current agent state without cancelling the in-flight stream
      if (selectedAgentId !== null) {
        savedAgentState.current.set(selectedAgentId, {
          messages,
          pendingPrompt,
          currentSessionId,
        });
      }
      // Restore saved state for the target agent (or blank slate)
      const saved = savedAgentState.current.get(id);
      setMessages(saved?.messages ?? []);
      setPendingPrompt(saved?.pendingPrompt ?? null);
      setCurrentSessionId(saved?.currentSessionId ?? null);
      // Reset so the sessionEnd effect re-fires for the restored agent
      lastSessionEndRef.current = null;
      setSelectedAgentId(id);
    },
    [selectedAgentId, messages, pendingPrompt, currentSessionId, agents, user, browserSessionId],
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (selectedAgentId === null) return;
      if (user && browserSessionId) trackAction(user.username ?? user.sub, browserSessionId, "navigation", "session_detail", sessionId);
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
    [selectedAgentId, user, browserSessionId],
  );

  // Only show streaming indicators for the session that is actively streaming.
  // When a user views a different session while a new one is streaming in the
  // background, the thinking/response bubbles must not appear in that other session.
  const isCurrentlyStreaming =
    isStreaming && (!sessionStart || sessionStart.session_id === currentSessionId);

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
              className="h-15"
            />
          </div>

          {/* Agent picker (shown when multiple agents available) */}
          {agents.length > 1 && (
            <div className="p-3 border-b shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-muted-foreground">Agent</p>
                <div className="flex gap-1">
                  {(["asc", "desc"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAgentSort(opt)}
                      className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                        agentSort === opt
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:bg-accent"
                      }`}
                      title={opt === "asc" ? "Sort A–Z" : "Sort Z–A"}
                    >
                      {opt === "asc" ? "A–Z" : "Z–A"}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                placeholder="Search agents…"
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="w-full text-xs rounded border bg-background px-2 py-1 mb-2 outline-none focus:ring-1 ring-ring placeholder:text-muted-foreground/50"
              />
              <div className="space-y-1">
                {filteredAgents.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1">No agents match</p>
                ) : (
                  filteredAgents.map((a) => (
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
                  ))
                )}
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

            {/* Inline hide confirmation */}
            {sessionToHide && (
              <div className="mx-1 mb-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-2">
                <p className="font-medium text-foreground">Remove this conversation?</p>
                <p className="text-muted-foreground">This removes it from your view only. The underlying data, logs, and any memories the agent formed remain on the backend.</p>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => void handleConfirmHideSession()} disabled={hidingSession}>
                    {hidingSession ? "Removing…" : "Remove"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setSessionToHide(null)} disabled={hidingSession}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {sessions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">No conversations yet</p>
            ) : (
              sessions.map((session) => {
                const isActive = currentSessionId === session.session_id;
                const isComplete = session.status !== "pending" && session.status !== "streaming";
                const isOwned = !!session.user_id && session.user_id === currentUserId;
                return (
                  <div
                    key={session.session_id}
                    className={`group relative flex items-stretch rounded text-xs transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <button
                      onClick={() => void handleSelectSession(session.session_id)}
                      className="flex-1 text-left px-3 py-2 min-w-0"
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
                      <div className={isActive ? "opacity-75" : "text-muted-foreground"}>
                        {session.invocations.length}{" "}
                        {session.invocations.length === 1 ? "exchange" : "exchanges"}
                      </div>
                    </button>
                    {isComplete && isOwned && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSessionToHide(session.session_id); }}
                        className={`opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-1.5 flex items-center ${
                          isActive ? "text-primary-foreground/70 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Remove from history"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Memory button */}
          {hasMemory && (
            <div className="p-3 shrink-0">
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

          {/* User info + theme + logout */}
          <div className="p-3 border-t shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate">
                  {user?.username ?? "User"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <div className="relative">
                  <button
                    onClick={() => setShowThemePicker((v) => !v)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Change theme"
                  >
                    <Palette className="h-3.5 w-3.5" />
                  </button>
                  {showThemePicker && (
                    <div className="absolute bottom-6 right-0 z-50 w-44 rounded border bg-popover shadow-md py-1">
                      {(Object.entries(THEME_LABELS) as [Theme, string][]).map(([k, v]) => (
                        <button
                          key={k}
                          onClick={() => {
                            setTheme(k);
                            setShowThemePicker(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-accent ${
                            theme === k ? "font-medium text-primary" : "text-foreground"
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={onLogout}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
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
                <Bot className="h-5 w-5 text-muted-foreground shrink-0 self-start mt-0.5" />
                <div>
                  <div className="font-medium">
                    {selectedAgent?.name ?? selectedAgent?.runtime_id ?? "Agent"}
                  </div>
                  {selectedAgent?.description && (
                    <div className="text-xs text-muted-foreground">
                      {selectedAgent.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto relative">
                {messages.length === 0 && !isCurrentlyStreaming && !pendingPrompt ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                      <p className="text-sm">
                        Start a conversation with{" "}
                        {selectedAgent?.name ?? "the agent"}
                      </p>
                      <p className="text-xs mt-1">Type a message below to begin</p>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
                    {messages.map((msg) => (
                      <MessageBubble key={msg.id} role={msg.role} text={msg.text} />
                    ))}

                    {/* In-flight user message */}
                    {pendingPrompt && (
                      <MessageBubble role="user" text={pendingPrompt} />
                    )}

                    {/* Thinking indicator — shown while waiting for first response chunk */}
                    {isCurrentlyStreaming && !streamedText && <ThinkingBubble />}

                    {/* Streaming bubble — switches on once text starts arriving */}
                    {((isCurrentlyStreaming && !!streamedText) ||
                      (!isCurrentlyStreaming && pendingPrompt !== null && !!streamedText)) && (
                      <MessageBubble
                        role="assistant"
                        text={streamedText}
                        isStreaming={isCurrentlyStreaming}
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
                )}
              </div>

              {/* Input area */}
              <div className="p-4 shrink-0">
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
                <p className="text-center text-xs text-muted-foreground mt-2 max-w-3xl mx-auto">
                  Be mindful of personal information you enter into conversations.
                </p>
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
            records={memoryRecords}
            recordsLoading={memoryRecordsLoading}
            onClose={() => setShowMemory(false)}
          />
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const id = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "." : prev + "."));
    }, 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-2xl px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span>
          thinking<span className="inline-block w-5 text-left">{dots}</span>
        </span>
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
        className={`${isUser ? "max-w-[70%]" : "max-w-[84%]"} rounded-2xl px-4 py-3 text-sm break-words ${
          isUser ? "bg-primary text-primary-foreground whitespace-pre-wrap" : "bg-muted"
        }`}
      >
        {isUser ? (
          text
        ) : (
          <>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              h1: ({ children }) => (
                <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-sm font-bold mb-2 mt-3 first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-snug">{children}</li>,
              pre: ({ children }) => {
                const codeClass = (children as { props?: { className?: string } } | null)?.props?.className ?? '';
                if (codeClass.includes('language-json')) {
                  return <CollapsibleJsonBlock>{children}</CollapsibleJsonBlock>;
                }
                return (
                  <pre className="mb-2 overflow-x-auto rounded bg-black/10 dark:bg-white/10 p-3 text-xs font-mono">{children}</pre>
                );
              },
              code: ({ className, children }) =>
                className?.startsWith("language-") ? (
                  <code className={className}>{children}</code>
                ) : (
                  <code className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-xs font-mono">
                    {children}
                  </code>
                ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground mb-2">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto mb-2">
                  <table className="border-collapse text-xs w-full">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead>{children}</thead>,
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => <tr>{children}</tr>,
              th: ({ children }) => (
                <th className="border border-border px-2 py-1 text-left font-semibold bg-muted/50">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border px-2 py-1">{children}</td>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold">{children}</strong>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="underline underline-offset-2 hover:opacity-80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
            }}
          >
            {text}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-text-bottom opacity-70" />
          )}
          </>
        )}
      </div>
    </div>
  );
}

// Map a memoryStrategyId prefix to a human-readable group label
function strategyLabel(strategyId: string): string {
  if (strategyId.includes("userPreference") || strategyId.includes("user_preference")) return "Preferences";
  if (strategyId.includes("summary") || strategyId.includes("Summary")) return "Summaries";
  if (strategyId.includes("semantic") || strategyId.includes("Semantic")) return "Facts & Context";
  if (strategyId.includes("episodic") || strategyId.includes("Episodic")) return "Episodes";
  return "Memory";
}

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  } catch {
    return "";
  }
}

function MemoryPanel({
  memories,
  sessions,
  currentSessionId,
  records,
  recordsLoading,
  onClose,
}: {
  memories: MemoryResponse[];
  sessions: SessionResponse[];
  currentSessionId: string | null;
  records: MemoryRecordItem[];
  recordsLoading: boolean;
  onClose: () => void;
}) {
  // Group records by strategy type label
  const grouped = new Map<string, MemoryRecordItem[]>();
  for (const rec of records) {
    const label = strategyLabel(rec.memoryStrategyId);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(rec);
  }

  // Current session's invocation count
  const currentSession = sessions.find((s) => s.session_id === currentSessionId);
  const sessionMessageCount = currentSession?.invocations.length ?? 0;

  const noMemoryConfigured = memories.length === 0;

  return (
    <div className="w-80 border-l bg-card flex flex-col h-full shrink-0">
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
        {noMemoryConfigured ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No memory configured for this agent.
          </p>
        ) : recordsLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading memories…
          </div>
        ) : records.length === 0 ? (
          <div className="space-y-3">
            {currentSessionId && (
              <div className="rounded border p-3 text-xs text-muted-foreground">
                Current conversation:{" "}
                <span className="font-medium text-foreground">
                  {sessionMessageCount} {sessionMessageCount === 1 ? "exchange" : "exchanges"}
                </span>
              </div>
            )}
            <p className="text-sm text-muted-foreground text-center py-4">
              No memories stored yet. Keep chatting — the agent will remember things as you go.
            </p>
          </div>
        ) : (
          <>
            {currentSessionId && (
              <div className="rounded border p-3 text-xs text-muted-foreground">
                Current conversation:{" "}
                <span className="font-medium text-foreground">
                  {sessionMessageCount} {sessionMessageCount === 1 ? "exchange" : "exchanges"}
                </span>
              </div>
            )}

            {Array.from(grouped.entries()).map(([label, items]) => (
              <div key={label}>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                  {label}
                </h3>
                <div className="space-y-2">
                  {items.map((rec) => (
                    <div key={rec.memoryRecordId} className="rounded border p-3 text-sm">
                      <p className="leading-snug">{rec.text}</p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Updated {formatRelativeDate(rec.updatedAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <p className="text-xs text-muted-foreground pt-4 border-t">
          Memory is managed automatically by the agent during your conversations. You can only see your own memories.
        </p>
      </div>
    </div>
  );
}
