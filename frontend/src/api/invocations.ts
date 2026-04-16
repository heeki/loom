import { apiFetch, BASE_URL, getAuthToken } from "./client";
import type {
  InvokeRequest,
  InvocationResponse,
  SessionResponse,
  SSESessionStart,
  SSEChunk,
  SSEToolUse,
  SSESessionEnd,
  SSEError,
} from "./types";

export function listSessions(agentId: number, userId?: string): Promise<SessionResponse[]> {
  const params = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return apiFetch<SessionResponse[]>(`/api/agents/${agentId}/sessions${params}`);
}

export function getInvocation(
  agentId: number,
  sessionId: string,
  invocationId: string,
): Promise<InvocationResponse> {
  return apiFetch<InvocationResponse>(
    `/api/agents/${agentId}/sessions/${sessionId}/invocations/${invocationId}`,
  );
}

export function getSession(
  agentId: number,
  sessionId: string,
): Promise<SessionResponse> {
  return apiFetch<SessionResponse>(
    `/api/agents/${agentId}/sessions/${sessionId}`,
  );
}

export function hideSession(agentId: number, sessionId: string): Promise<void> {
  return apiFetch<void>(`/api/agents/${agentId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export interface StreamCallbacks {
  onSessionStart?: (data: SSESessionStart) => void;
  onChunk?: (data: SSEChunk) => void;
  onToolUse?: (data: SSEToolUse) => void;
  onSessionEnd?: (data: SSESessionEnd) => void;
  onError?: (data: SSEError) => void;
}

export async function invokeAgentStream(
  agentId: number,
  request: InvokeRequest,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}/api/agents/${agentId}/invoke`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // use default detail
    }
    callbacks.onError?.({ message: detail });
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError?.({ message: "No response body" });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages (separated by double newlines)
      const parts = buffer.split("\n\n");
      // Keep the last part as it may be incomplete
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;

        let eventType = "";
        let eventData = "";

        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            eventData = line.slice(5).trim();
          }
        }

        if (!eventType || !eventData) continue;

        try {
          const parsed: unknown = JSON.parse(eventData);
          switch (eventType) {
            case "session_start":
              callbacks.onSessionStart?.(parsed as SSESessionStart);
              break;
            case "chunk":
              callbacks.onChunk?.(parsed as SSEChunk);
              break;
            case "tool_use":
              callbacks.onToolUse?.(parsed as SSEToolUse);
              break;
            case "session_end":
              callbacks.onSessionEnd?.(parsed as SSESessionEnd);
              break;
            case "error":
              callbacks.onError?.(parsed as SSEError);
              break;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
