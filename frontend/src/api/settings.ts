import { apiFetch } from "./client";
import type { TagPolicy, TagPolicyCreateRequest, TagPolicyUpdateRequest } from "./types";

export function listTagPolicies(): Promise<TagPolicy[]> {
  return apiFetch<TagPolicy[]>("/api/settings/tags");
}

export function createTagPolicy(request: TagPolicyCreateRequest): Promise<TagPolicy> {
  return apiFetch<TagPolicy>("/api/settings/tags", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function updateTagPolicy(id: number, request: TagPolicyUpdateRequest): Promise<TagPolicy> {
  return apiFetch<TagPolicy>(`/api/settings/tags/${id}`, {
    method: "PUT",
    body: JSON.stringify(request),
  });
}

export function deleteTagPolicy(id: number): Promise<void> {
  return apiFetch<void>(`/api/settings/tags/${id}`, {
    method: "DELETE",
  });
}
