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
}

export interface AgentRegisterRequest {
  arn: string;
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
