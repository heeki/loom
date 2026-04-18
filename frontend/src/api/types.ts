// Agent types
export interface AgentResponse {
  id: number;
  arn: string;
  runtime_id: string;
  name: string | null;
  description: string | null;
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
  authorizer_config: { type?: string; name?: string; pool_id?: string; discovery_url?: string } | null;
  model_id: string | null;
  allowed_model_ids: string[];
  deployed_at: string | null;
  tags: Record<string, string>;
  cost_summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_model_cost: number;
    total_runtime_cost: number;
    total_memory_cost: number;
    total_cost: number;
    total_invocations: number;
  } | null;
  memory_names: string[];
  mcp_names: string[];
  a2a_names: string[];
  registry_record_id: string | null;
  registry_status: string | null;
}

export interface AgentRegisterRequest {
  source: "register";
  arn: string;
  model_id?: string;
}

export interface AgentDeployRequest {
  source: "deploy";
  name: string;
  description: string;
  agent_description: string;
  behavioral_guidelines: string;
  output_expectations: string;
  model_id: string;
  allowed_model_ids?: string[];
  role_arn: string | null;
  protocol: string;
  network_mode: string;
  idle_timeout: number | null;
  max_lifetime: number | null;
  authorizer_type: string | null;
  authorizer_pool_id: string | null;
  authorizer_discovery_url: string | null;
  authorizer_allowed_clients: string[];
  authorizer_allowed_scopes: string[];
  authorizer_client_id: string | null;
  authorizer_client_secret: string | null;
  memory_enabled: boolean;
  memory_ids: number[];
  mcp_servers: number[];
  a2a_agents: number[];
  tags?: Record<string, string>;
}

export interface AgentDeployMeta {
  protocol: string;
  network_mode: string;
  authorizer_config: { type?: string; name?: string } | null;
  memory_names: string[];
  mcp_names: string[];
  a2a_names: string[];
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
  group?: string;
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
  credential_id?: number;
  bearer_token?: string;
  model_id?: string;
}

export interface InvocationResponse {
  id: number;
  session_id: string;
  invocation_id: string;
  request_id: string | null;
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
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  compute_cost: number | null;
  compute_cpu_cost: number | null;
  compute_memory_cost: number | null;
  idle_timeout_cost: number | null;
  idle_cpu_cost: number | null;
  idle_memory_cost: number | null;
  memory_retrievals: number | null;
  memory_events_sent: number | null;
  memory_estimated_cost: number | null;
  stm_cost: number | null;
  ltm_cost: number | null;
  cost_source: string | null;
  created_at: string | null;
}

export interface SessionResponse {
  agent_id: number;
  session_id: string;
  qualifier: string;
  status: string;
  live_status: string;
  created_at: string | null;
  user_id: string | null;
  hidden_at: string | null;
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

export interface VendedLogSource {
  key: string;
  label: string;
  log_group: string;
  stream: string;
}

export interface VendedLogSourcesResponse {
  sources: VendedLogSource[];
}

// Trace types
export interface TraceSummary {
  trace_id: string;
  session_id: string | null;
  start_time_iso: string;
  end_time_iso: string;
  duration_ms: number;
  span_count: number;
  event_count: number;
}

export interface TraceListResponse {
  traces: TraceSummary[];
}

export interface TraceEvent {
  observed_time_iso: string;
  severity_number: number;
  scope: string;
  body: Record<string, unknown> | string;
}

export interface TraceSpan {
  span_id: string;
  scope: string;
  start_time_iso: string;
  end_time_iso: string;
  duration_ms: number;
  event_count: number;
  events: TraceEvent[];
}

export interface TraceDetailResponse {
  trace_id: string;
  session_id: string | null;
  start_time_iso: string;
  end_time_iso: string;
  duration_ms: number;
  span_count: number;
  event_count: number;
  spans: TraceSpan[];
}

// Security types
export interface ManagedRole {
  id: number;
  role_name: string;
  role_arn: string;
  description: string;
  policy_document: PolicyDocument;
  tags: Record<string, string>;
  created_at: string | null;
  updated_at: string | null;
}

export interface PolicyDocument {
  Version?: string;
  Statement?: PolicyStatement[];
}

export interface PolicyStatement {
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
  Sid?: string;
}

export interface ManagedRoleCreateRequest {
  mode: "import" | "wizard";
  role_arn?: string;
  role_name?: string;
  description?: string;
  policy_document?: PolicyDocument;
  tags?: Record<string, string>;
}

export interface ManagedRoleUpdateRequest {
  description?: string;
  policy_document?: PolicyDocument;
}

export interface CognitoPool {
  pool_id: string;
  pool_name: string;
  discovery_url: string;
}

export interface AuthorizerCredential {
  id: number;
  authorizer_config_id: number;
  label: string;
  client_id: string;
  has_secret: boolean;
  created_at: string | null;
}

export interface AuthorizerConfigResponse {
  id: number;
  name: string;
  authorizer_type: string;
  pool_id: string | null;
  discovery_url: string | null;
  allowed_clients: string[];
  allowed_scopes: string[];
  client_id: string | null;
  has_client_secret: boolean;
  tags: Record<string, string>;
  created_at: string | null;
  updated_at: string | null;
}

export interface AuthorizerConfigCreateRequest {
  name: string;
  authorizer_type: string;
  pool_id?: string;
  discovery_url?: string;
  allowed_clients?: string[];
  allowed_scopes?: string[];
}

export interface AuthorizerConfigUpdateRequest {
  name?: string;
  authorizer_type?: string;
  pool_id?: string;
  discovery_url?: string;
  allowed_clients?: string[];
  allowed_scopes?: string[];
}

export interface PermissionRequestResponse {
  id: number;
  managed_role_id: number;
  role_name: string | null;
  role_arn: string | null;
  requested_actions: string[];
  requested_resources: string[];
  justification: string;
  status: "pending" | "approved" | "denied";
  reviewer_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PermissionRequestCreateRequest {
  managed_role_id: number;
  requested_actions: string[];
  requested_resources: string[];
  justification: string;
}

export interface PermissionRequestReviewRequest {
  status: "approved" | "denied";
  reviewer_notes?: string;
}

// Memory types
export interface MemoryStrategyRequest {
  strategy_type: "semantic" | "summary" | "user_preference" | "episodic" | "custom";
  name: string;
  description?: string;
  namespaces?: string[];
  configuration?: Record<string, unknown>;
}

export interface MemoryCreateRequest {
  name: string;
  description?: string;
  event_expiry_duration: number;
  memory_execution_role_arn?: string;
  encryption_key_arn?: string;
  memory_strategies?: MemoryStrategyRequest[];
  tags?: Record<string, string>;
}

export interface MemoryResponse {
  id: number;
  name: string;
  description: string | null;
  arn: string | null;
  memory_id: string | null;
  status: string;
  event_expiry_duration: number;
  strategies_config: unknown[] | null;
  strategies_response: unknown[] | null;
  tags: Record<string, string>;
  failure_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  region: string;
  account_id: string;
  memory_execution_role_arn: string | null;
  encryption_key_arn: string | null;
  cost_summary: {
    total_memory_estimated_cost: number;
    total_stm_cost: number;
    total_ltm_cost: number;
    total_retrievals: number;
    total_events_sent: number;
  } | null;
}

export interface MemoryRecordItem {
  memoryRecordId: string;
  text: string;
  memoryStrategyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecordsResponse {
  memory_id: string;
  actor_id: string;
  records: MemoryRecordItem[];
}

// SSE event types
export interface SSESessionStart {
  session_id: string;
  invocation_id: string;
  client_invoke_time: number;
  token_source?: string;
  has_token?: boolean;
}

export interface SSEChunk {
  text: string;
}

export interface SSESessionEnd {
  session_id: string;
  invocation_id: string;
  request_id: string | null;
  qualifier: string;
  client_invoke_time: number;
  client_done_time: number;
  client_duration_ms: number;
  cold_start_latency_ms: number | null;
  agent_start_time: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  compute_cost: number | null;
  compute_cpu_cost: number | null;
  compute_memory_cost: number | null;
  idle_timeout_cost: number | null;
  idle_cpu_cost: number | null;
  idle_memory_cost: number | null;
  memory_retrievals: number | null;
  memory_events_sent: number | null;
  memory_estimated_cost: number | null;
  stm_cost: number | null;
  ltm_cost: number | null;
}

export interface SSEToolUse {
  name: string;
}

export interface SSEError {
  message: string;
}

// Tag policy types
export interface TagPolicy {
  id: number;
  key: string;
  default_value: string | null;
  designation: "platform:required" | "custom:optional";
  required: boolean;
  show_on_card: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface TagPolicyCreateRequest {
  key: string;
  default_value?: string;
  required?: boolean;
  show_on_card?: boolean;
}

export interface TagPolicyUpdateRequest {
  key: string;
  default_value?: string;
  required?: boolean;
  show_on_card?: boolean;
}

// Tag profile types
export interface TagProfile {
  id: number;
  name: string;
  tags: Record<string, string>;
  created_at: string | null;
  updated_at: string | null;
}

export interface TagProfileCreateRequest {
  name: string;
  tags: Record<string, string>;
}

// MCP Server types
export interface McpServer {
  id: number;
  name: string;
  description: string | null;
  endpoint_url: string;
  transport_type: "sse" | "streamable_http";
  status: "active" | "inactive" | "error";
  auth_type: "none" | "oauth2" | "api_key";
  oauth2_well_known_url: string | null;
  oauth2_client_id: string | null;
  oauth2_scopes: string | null;
  has_oauth2_secret: boolean;
  api_key_header_name: string | null;
  has_admin_api_key: boolean;
  created_at: string | null;
  updated_at: string | null;
  registry_record_id: string | null;
  registry_status: string | null;
}

export interface McpServerCreateRequest {
  name: string;
  description?: string;
  endpoint_url: string;
  transport_type: "sse" | "streamable_http";
  auth_type?: "none" | "oauth2" | "api_key";
  oauth2_well_known_url?: string;
  oauth2_client_id?: string;
  oauth2_client_secret?: string;
  oauth2_scopes?: string;
  api_key_header_name?: string;
  api_key?: string;
}

export interface McpServerUpdateRequest {
  name?: string;
  description?: string;
  endpoint_url?: string;
  transport_type?: "sse" | "streamable_http";
  status?: "active" | "inactive" | "error";
  auth_type?: "none" | "oauth2" | "api_key";
  oauth2_well_known_url?: string;
  oauth2_client_id?: string;
  oauth2_client_secret?: string;
  oauth2_scopes?: string;
  api_key_header_name?: string;
  api_key?: string;
}

export interface McpTool {
  id: number;
  server_id: number;
  tool_name: string;
  description: string | null;
  input_schema: Record<string, unknown> | null;
  last_refreshed_at: string | null;
}

export interface McpServerAccess {
  id: number;
  server_id: number;
  persona_id: number;
  access_level: "all_tools" | "selected_tools";
  allowed_tool_names: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface McpAccessUpdateRequest {
  rules: Array<{
    persona_id: number;
    access_level: "all_tools" | "selected_tools";
    allowed_tool_names?: string[];
  }>;
}

export interface ToolInvokeRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface ToolInvokeResult {
  success: boolean;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

// A2A Agent types
export interface A2aAgent {
  id: number;
  base_url: string;
  name: string;
  description: string;
  agent_version: string;
  documentation_url: string | null;
  provider_organization: string | null;
  provider_url: string | null;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication_schemes: string[];
  default_input_modes: string[];
  default_output_modes: string[];
  agent_card_raw: Record<string, unknown>;
  status: "active" | "inactive" | "error";
  auth_type: "none" | "oauth2";
  oauth2_well_known_url: string | null;
  oauth2_client_id: string | null;
  oauth2_scopes: string | null;
  has_oauth2_secret: boolean;
  agentcore_session_id: string | null;
  last_fetched_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  registry_record_id: string | null;
  registry_status: string | null;
}

export interface A2aAgentCreateRequest {
  base_url: string;
  name?: string;
  auth_type?: "none" | "oauth2";
  oauth2_well_known_url?: string;
  oauth2_client_id?: string;
  oauth2_client_secret?: string;
  oauth2_scopes?: string;
}

export interface A2aAgentUpdateRequest {
  base_url?: string;
  name?: string;
  status?: "active" | "inactive" | "error";
  auth_type?: "none" | "oauth2";
  oauth2_well_known_url?: string;
  oauth2_client_id?: string;
  oauth2_client_secret?: string;
  oauth2_scopes?: string;
}

export interface A2aAgentSkill {
  id: number;
  agent_id: number;
  skill_id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[] | null;
  input_modes: string[] | null;
  output_modes: string[] | null;
  last_refreshed_at: string | null;
}

export interface A2aAgentAccess {
  id: number;
  agent_id: number;
  persona_id: number;
  access_level: "all_skills" | "selected_skills";
  allowed_skill_ids: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface A2aAccessUpdateRequest {
  rules: Array<{
    persona_id: number;
    access_level: "all_skills" | "selected_skills";
    allowed_skill_ids?: string[];
  }>;
}

// Pricing types
export interface ModelPricing {
  model_id: string;
  display_name: string;
  group: string;
  max_tokens: number;
  input_price_per_1k_tokens: number;
  output_price_per_1k_tokens: number;
  pricing_as_of: string;
}

// Cost dashboard types
export interface AgentCostSummary {
  agent_id: number;
  agent_name: string | null;
  model_id: string | null;
  total_invocations: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_estimated_cost: number;
  total_compute_cpu_cost: number;
  total_compute_memory_cost: number;
  total_idle_cpu_cost: number;
  total_idle_memory_cost: number;
  total_stm_cost: number;
  total_ltm_cost: number;
  avg_cost_per_invocation: number;
}

export interface CostDashboardResponse {
  group: string | null;
  days: number;
  total_invocations: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_estimated_cost: number;
  total_compute_cpu_cost: number;
  total_compute_memory_cost: number;
  total_idle_cpu_cost: number;
  total_idle_memory_cost: number;
  total_stm_cost: number;
  total_ltm_cost: number;
  agents: AgentCostSummary[];
}

export interface CostActualSession {
  agent_name: string | null;
  session_id: string | null;
  event_count: number;
  first_timestamp: string | null;
  last_timestamp: string | null;
  vcpu_hours: number;
  memory_gb_hours: number;
  cpu_cost: number;
  memory_cost: number;
  total_cost: number;
}

export interface CostActualAgent {
  agent_id: number;
  agent_name: string;
  runtime_id: string;
  log_group: string;
  sessions: CostActualSession[];
  total_cpu_cost: number;
  total_memory_cost: number;
  total_cost: number;
}

export interface CostActualMemorySession {
  session_id: string;
  log_events: number;
  retrieve_records: number;
  records_stored: number;
  extractions: number;
  consolidations: number;
  errors: number;
  ltm_retrieval_cost: number;
  ltm_storage_cost: number;
  total_cost: number;
}

export interface CostActualMemory {
  memory_id: string;
  memory_name: string;
  log_group: string;
  total_log_events: number;
  retrieve_records: number;
  records_stored: number;
  extractions: number;
  consolidations: number;
  errors: number;
  ltm_retrieval_cost: number;
  ltm_storage_cost: number;
  total_cost: number;
  sessions: CostActualMemorySession[];
}

export interface CostActualsResponse {
  group: string | null;
  days: number;
  io_wait_discount_percent: number;
  agents: CostActualAgent[];
  memory: CostActualMemory[];
  summary: { total_events: number };
}

// Registry types
export type RegistryStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "DEPRECATED";

export interface RegistryRecord {
  record_id: string;
  name: string;
  descriptor_type: string;
  status: string;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface RegistryRecordDetail extends RegistryRecord {
  descriptors: Record<string, unknown>;
  record_version: string | null;
  status_reason: string | null;
}

export type McpNamespace = "aws.agentcore" | "remote.mcp" | "npm" | "custom";

export interface RegistryRecordCreateRequest {
  resource_type: "mcp" | "a2a" | "agent";
  resource_id: number;
  namespace?: McpNamespace;
}

export interface RegistrySearchResult {
  results: Array<Record<string, unknown>>;
}
