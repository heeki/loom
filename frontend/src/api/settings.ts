import { apiFetch } from "./client";
import type { TagPolicy, TagPolicyCreateRequest, TagPolicyUpdateRequest, TagProfile, TagProfileCreateRequest } from "./types";

// Site Settings API
export interface SiteSetting {
  id: number | null;
  key: string;
  value: string;
  updated_at: string | null;
}

export function listSiteSettings(): Promise<SiteSetting[]> {
  return apiFetch<SiteSetting[]>("/api/settings/site");
}

export function updateSiteSetting(key: string, value: string): Promise<SiteSetting> {
  return apiFetch<SiteSetting>(`/api/settings/site/${key}`, {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  });
}

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

// Registry Configuration API
export interface RegistryConfig {
  registry_arn: string;
  registry_id: string;
  enabled: boolean;
}

export function getRegistryConfig(): Promise<RegistryConfig> {
  return apiFetch<RegistryConfig>("/api/settings/registry");
}

export function updateRegistryConfig(registry_arn: string): Promise<RegistryConfig> {
  return apiFetch<RegistryConfig>("/api/settings/registry", {
    method: "PUT",
    body: JSON.stringify({ registry_arn }),
  });
}
