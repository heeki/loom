import { apiFetch } from "./client";
import type { MemoryCreateRequest, MemoryResponse } from "./types";

export function createMemory(request: MemoryCreateRequest): Promise<MemoryResponse> {
  return apiFetch<MemoryResponse>("/api/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function listMemories(): Promise<MemoryResponse[]> {
  return apiFetch<MemoryResponse[]>("/api/memories");
}

export function getMemory(id: number): Promise<MemoryResponse> {
  return apiFetch<MemoryResponse>(`/api/memories/${id}`);
}

export function refreshMemory(id: number): Promise<MemoryResponse> {
  return apiFetch<MemoryResponse>(`/api/memories/${id}/refresh`, {
    method: "POST",
  });
}

export function deleteMemory(id: number): Promise<void> {
  return apiFetch<void>(`/api/memories/${id}`, {
    method: "DELETE",
  });
}
