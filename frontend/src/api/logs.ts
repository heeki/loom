import { apiFetch } from "./client";
import type { LogResponse, LogStreamsResponse } from "./types";

export function listLogStreams(
  agentId: number,
  qualifier = "DEFAULT",
): Promise<LogStreamsResponse> {
  return apiFetch<LogStreamsResponse>(
    `/api/agents/${agentId}/logs/streams?qualifier=${encodeURIComponent(qualifier)}`,
  );
}

export function getAgentLogs(
  agentId: number,
  qualifier = "DEFAULT",
  options?: { stream?: string; limit?: number },
): Promise<LogResponse> {
  const params = new URLSearchParams({ qualifier });
  if (options?.stream) params.set("stream", options.stream);
  if (options?.limit) params.set("limit", String(options.limit));
  return apiFetch<LogResponse>(`/api/agents/${agentId}/logs?${params}`);
}

export function getSessionLogs(
  agentId: number,
  sessionId: string,
  qualifier = "DEFAULT",
  limit = 100,
): Promise<LogResponse> {
  const params = new URLSearchParams({
    qualifier,
    limit: String(limit),
  });
  return apiFetch<LogResponse>(
    `/api/agents/${agentId}/sessions/${sessionId}/logs?${params}`,
  );
}
