import { apiFetch } from "./client";
import type {
  McpServer,
  McpServerCreateRequest,
  McpServerUpdateRequest,
  McpTool,
  McpServerAccess,
  McpAccessUpdateRequest,
  TestConnectionResult,
} from "./types";

export function listMcpServers(): Promise<McpServer[]> {
  return apiFetch<McpServer[]>("/api/mcp/servers");
}

export function getMcpServer(id: number): Promise<McpServer> {
  return apiFetch<McpServer>(`/api/mcp/servers/${id}`);
}

export function createMcpServer(request: McpServerCreateRequest): Promise<McpServer> {
  return apiFetch<McpServer>("/api/mcp/servers", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function updateMcpServer(id: number, request: McpServerUpdateRequest): Promise<McpServer> {
  return apiFetch<McpServer>(`/api/mcp/servers/${id}`, {
    method: "PUT",
    body: JSON.stringify(request),
  });
}

export function deleteMcpServer(id: number): Promise<void> {
  return apiFetch<void>(`/api/mcp/servers/${id}`, {
    method: "DELETE",
  });
}

export function testConnection(serverId: number): Promise<TestConnectionResult> {
  return apiFetch<TestConnectionResult>(`/api/mcp/servers/${serverId}/test-connection`, {
    method: "POST",
  });
}

export function getServerTools(serverId: number): Promise<McpTool[]> {
  return apiFetch<McpTool[]>(`/api/mcp/servers/${serverId}/tools`);
}

export function refreshServerTools(serverId: number): Promise<McpTool[]> {
  return apiFetch<McpTool[]>(`/api/mcp/servers/${serverId}/tools/refresh`, {
    method: "POST",
  });
}

export function getServerAccess(serverId: number): Promise<McpServerAccess[]> {
  return apiFetch<McpServerAccess[]>(`/api/mcp/servers/${serverId}/access`);
}

export function updateServerAccess(serverId: number, request: McpAccessUpdateRequest): Promise<McpServerAccess[]> {
  return apiFetch<McpServerAccess[]>(`/api/mcp/servers/${serverId}/access`, {
    method: "PUT",
    body: JSON.stringify(request),
  });
}
