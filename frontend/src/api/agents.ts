import { apiFetch } from "./client";
import type { AgentResponse, AgentRegisterRequest } from "./types";

export function listAgents(): Promise<AgentResponse[]> {
  return apiFetch<AgentResponse[]>("/api/agents");
}

export function getAgent(id: number): Promise<AgentResponse> {
  return apiFetch<AgentResponse>(`/api/agents/${id}`);
}

export function registerAgent(
  request: AgentRegisterRequest,
): Promise<AgentResponse> {
  return apiFetch<AgentResponse>("/api/agents", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function refreshAgent(id: number): Promise<AgentResponse> {
  return apiFetch<AgentResponse>(`/api/agents/${id}/refresh`, {
    method: "POST",
  });
}

export function deleteAgent(id: number): Promise<void> {
  return apiFetch<void>(`/api/agents/${id}`, {
    method: "DELETE",
  });
}
