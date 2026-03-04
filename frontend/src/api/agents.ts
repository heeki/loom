import { apiFetch } from "./client";
import type {
  AgentResponse,
  AgentRegisterRequest,
  AgentDeployRequest,
  ConfigEntry,
  ConfigUpdateRequest,
} from "./types";

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

export function deployAgent(
  request: AgentDeployRequest,
): Promise<AgentResponse> {
  return apiFetch<AgentResponse>("/api/agents/deploy", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function redeployAgent(id: number): Promise<AgentResponse> {
  return apiFetch<AgentResponse>(`/api/agents/${id}/redeploy`, {
    method: "POST",
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

export function getAgentConfig(id: number): Promise<ConfigEntry[]> {
  return apiFetch<ConfigEntry[]>(`/api/agents/${id}/config`);
}

export function updateAgentConfig(
  id: number,
  request: ConfigUpdateRequest,
): Promise<ConfigEntry[]> {
  return apiFetch<ConfigEntry[]>(`/api/agents/${id}/config`, {
    method: "PUT",
    body: JSON.stringify(request),
  });
}
