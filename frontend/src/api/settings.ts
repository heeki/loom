import { apiFetch } from "./client";
import type { TagPolicy, TagPolicyCreateRequest, TagPolicyUpdateRequest, TagProfile, TagProfileCreateRequest } from "./types";

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

// Tag Profile API
export function listTagProfiles(): Promise<TagProfile[]> {
  return apiFetch<TagProfile[]>("/api/settings/tag-profiles");
}

export function createTagProfile(request: TagProfileCreateRequest): Promise<TagProfile> {
  return apiFetch<TagProfile>("/api/settings/tag-profiles", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function updateTagProfile(id: number, request: TagProfileCreateRequest): Promise<TagProfile> {
  return apiFetch<TagProfile>(`/api/settings/tag-profiles/${id}`, {
    method: "PUT",
    body: JSON.stringify(request),
  });
}

export function deleteTagProfile(id: number): Promise<void> {
  return apiFetch<void>(`/api/settings/tag-profiles/${id}`, {
    method: "DELETE",
  });
}
