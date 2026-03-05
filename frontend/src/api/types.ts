// Agent types
export interface AgentResponse {
  id: number;
  arn: string;
  runtime_id: string;
  name: string | null;
  status: string | null;
  region: string;
  account_id: string;
  log_group: string | null;
  available_qualifiers: string[];
  active_session_count: number;
  registered_at: string | null;
  last_refreshed_at: string | null;
  source: "register" | "deploy" | null;
  deployment_status: string | null;
  execution_role_arn: string | null;
  config_hash: string | null;
  endpoint_name: string | null;
  endpoint_arn: string | null;
  endpoint_status: string | null;
  protocol: string | null;
  network_mode: string | null;
  deployed_at: string | null;
}

export interface AgentRegisterRequest {
  source: "register";
  arn: string;
}

export interface AgentDeployRequest {
  source: "deploy";
  name: string;
  description: string;
  agent_description: string;
  behavioral_guidelines: string;
  output_expectations: string;
  model_id: string;
  role_arn: string | null;
  protocol: string;
  network_mode: string;
  idle_timeout: number | null;
  max_lifetime: number | null;
  authorizer_pool_id: string | null;
  memory_enabled: boolean;
  mcp_servers: unknown[];
  a2a_agents: unknown[];
}

export interface IamRole {
  role_name: string;
  role_arn: string;
  description: string;
}

export interface CognitoPool {
  pool_id: string;
  pool_name: string;
}

export interface ModelOption {
  model_id: string;
  display_name: string;
}

// Config types
export interface ConfigEntry {
  id: number;
  agent_id: number;
  key: string;
  value: string;
  is_secret: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ConfigUpdateRequest {
  config: Record<string, string>;
}

// Credential provider types
export interface CredentialProvider {
  id: number;
  agent_id: number;
  name: string;
  vendor: string;
  callback_url: string;
  scopes: string[];
  provider_type: string;
  created_at: string;
}

export interface CredentialProviderCreateRequest {
  name: string;
  vendor: string;
  client_id: string;
  client_secret: string;
  auth_server_url: string;
  scopes: string[];
  provider_type: string;
}

// Integration types
export interface AgentIntegration {
  id: number;
  agent_id: number;
  integration_type: string;
  integration_config: Record<string, string>;
  credential_provider_id: number | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface IntegrationCreateRequest {
  integration_type: string;
  integration_config: Record<string, string>;
  credential_provider_id?: number;
}

export interface IntegrationUpdateRequest {
  integration_config?: Record<string, string>;
  credential_provider_id?: number | null;
  enabled?: boolean;
}

// Invocation types
export interface InvokeRequest {
  prompt: string;
  qualifier?: string;
  session_id?: string;
}

export interface InvocationResponse {
  id: number;
  session_id: string;
  invocation_id: string;
  client_invoke_time: number | null;
  client_done_time: number | null;
  agent_start_time: number | null;
  cold_start_latency_ms: number | null;
  client_duration_ms: number | null;
  status: string;
  error_message: string | null;
  prompt_text: string | null;
  thinking_text: string | null;
  response_text: string | null;
  created_at: string | null;
}

export interface SessionResponse {
  agent_id: number;
  session_id: string;
  qualifier: string;
  status: string;
  live_status: string;
  created_at: string | null;
  invocations: InvocationResponse[];
}

// Log types
export interface LogEvent {
  timestamp_ms: number;
  timestamp_iso: string;
  message: string;
  session_id: string | null;
}

export interface LogResponse {
  log_group: string;
  log_stream: string;
  events: LogEvent[];
}

export interface LogStreamInfo {
  name: string;
  last_event_time: number;
}

export interface LogStreamsResponse {
  log_group: string;
  streams: LogStreamInfo[];
}

// SSE event types
export interface SSESessionStart {
  session_id: string;
  invocation_id: string;
  client_invoke_time: number;
}

export interface SSEChunk {
  text: string;
}

export interface SSESessionEnd {
  session_id: string;
  invocation_id: string;
  qualifier: string;
  client_invoke_time: number;
  client_done_time: number;
  client_duration_ms: number;
  cold_start_latency_ms: number | null;
  agent_start_time: number | null;
}

export interface SSEError {
  message: string;
}
