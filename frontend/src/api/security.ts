import { apiFetch } from "./client";
import type {
  ManagedRole,
  ManagedRoleCreateRequest,
  ManagedRoleUpdateRequest,
  AuthorizerConfigResponse,
  AuthorizerConfigCreateRequest,
  AuthorizerConfigUpdateRequest,
  PermissionRequestResponse,
  PermissionRequestCreateRequest,
  PermissionRequestReviewRequest,
} from "./types";

// Managed Roles
export function listManagedRoles(): Promise<ManagedRole[]> {
  return apiFetch<ManagedRole[]>("/api/security/roles");
}

export function getManagedRole(id: number): Promise<ManagedRole> {
  return apiFetch<ManagedRole>(`/api/security/roles/${id}`);
}

export function createManagedRole(request: ManagedRoleCreateRequest): Promise<ManagedRole> {
  return apiFetch<ManagedRole>("/api/security/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function updateManagedRole(id: number, request: ManagedRoleUpdateRequest): Promise<ManagedRole> {
  return apiFetch<ManagedRole>(`/api/security/roles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function deleteManagedRole(id: number): Promise<void> {
  return apiFetch<void>(`/api/security/roles/${id}`, { method: "DELETE" });
}

// Authorizer Configs
export function listAuthorizerConfigs(): Promise<AuthorizerConfigResponse[]> {
  return apiFetch<AuthorizerConfigResponse[]>("/api/security/authorizers");
}

export function getAuthorizerConfig(id: number): Promise<AuthorizerConfigResponse> {
  return apiFetch<AuthorizerConfigResponse>(`/api/security/authorizers/${id}`);
}

export function createAuthorizerConfig(request: AuthorizerConfigCreateRequest): Promise<AuthorizerConfigResponse> {
  return apiFetch<AuthorizerConfigResponse>("/api/security/authorizers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function updateAuthorizerConfig(id: number, request: AuthorizerConfigUpdateRequest): Promise<AuthorizerConfigResponse> {
  return apiFetch<AuthorizerConfigResponse>(`/api/security/authorizers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function deleteAuthorizerConfig(id: number): Promise<void> {
  return apiFetch<void>(`/api/security/authorizers/${id}`, { method: "DELETE" });
}

// Permission Requests
export function listPermissionRequests(status?: string): Promise<PermissionRequestResponse[]> {
  const query = status ? `?status=${status}` : "";
  return apiFetch<PermissionRequestResponse[]>(`/api/security/permission-requests${query}`);
}

export function createPermissionRequest(request: PermissionRequestCreateRequest): Promise<PermissionRequestResponse> {
  return apiFetch<PermissionRequestResponse>("/api/security/permission-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function reviewPermissionRequest(id: number, request: PermissionRequestReviewRequest): Promise<PermissionRequestResponse> {
  return apiFetch<PermissionRequestResponse>(`/api/security/permission-requests/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}
