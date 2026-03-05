# Loom Backend — Specifications

## 1. Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | FastAPI |
| Server | Uvicorn (local dev) |
| ORM | SQLAlchemy (with SQLite) |
| AWS SDK | boto3 |
| Python version | 3.11+ (3.13 for ARM64 runtime deployment) |
| Dependency manager | uv |
| Streaming | SSE via `StreamingResponse` |

---

## 2. Configuration

All runtime configuration is injected via environment variables sourced from `etc/environment.sh`:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLite file path | `sqlite:///./loom.db` |
| `BACKEND_PORT` | Port for uvicorn | `8000` |
| `FRONTEND_PORT` | Port for Vite dev server (CORS) | `5173` |
| `LOG_LEVEL` | Backend log level | `info` |
| `SESSION_IDLE_TIMEOUT_MINUTES` | Idle timeout for session liveness detection | `15` |
| `AWS_REGION` | AWS region for deployments | `us-east-1` |
| `LOOM_ARTIFACT_BUCKET` | S3 bucket for agent deployment artifacts | — |

AWS credentials use the standard boto3 credential chain (environment variables, AWS profile, instance metadata).

---

## 3. Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI application entry point
│   ├── db.py                # SQLAlchemy engine, session factory, init_db
│   ├── models/
│   │   ├── __init__.py      # Re-exports all models
│   │   ├── agent.py         # Agent ORM model
│   │   ├── config_entry.py  # ConfigEntry ORM model (agent key-value configuration)
│   │   ├── session.py       # InvocationSession ORM model
│   │   └── invocation.py    # Invocation ORM model
│   ├── routers/
│   │   ├── agents.py        # Agent CRUD + ARN parsing + log group derivation
│   │   ├── invocations.py   # SSE streaming invoke + session/invocation queries
│   │   ├── logs.py          # CloudWatch log browsing + session log retrieval
│   │   └── utils.py         # Shared router utilities (get_agent_or_404)
│   └── services/
│       ├── agentcore.py     # Bedrock AgentCore API wrapper
│       ├── cloudwatch.py    # CloudWatch log retrieval and parsing
│       ├── cognito.py       # Cognito OAuth2 token retrieval (client credentials grant)
│       ├── credential.py    # AgentCore credential provider management
│       ├── deployment.py    # Agent artifact build, runtime CRUD, secret detection
│       ├── iam.py           # IAM role creation/deletion, Cognito pool listing
│       ├── latency.py       # Latency calculation helpers
│       └── secrets.py       # AWS Secrets Manager wrapper with in-memory caching
├── scripts/
│   └── stream.py            # SSE streaming client for CLI invocations (httpx)
├── tests/
│   ├── test_agentcore.py    # AgentCore service tests
│   ├── test_agents.py       # Agent router tests
│   ├── test_cloudwatch.py   # CloudWatch service tests
│   ├── test_invocations.py  # Invocation router tests
│   ├── test_latency.py      # Latency computation tests
│   ├── test_logs.py         # Logs router tests
│   └── test_agents_deploy.py # Deployment-specific tests
├── makefile
├── pyproject.toml
└── requirements.txt
```

---

## 4. Database Schema

### `agents` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `arn` | TEXT UNIQUE NOT NULL | AgentCore Runtime ARN |
| `runtime_id` | TEXT NOT NULL | Extracted from ARN |
| `name` | TEXT | Human-readable name (from AgentCore describe response) |
| `status` | TEXT | Runtime status (e.g., `READY`, `CREATING`) |
| `region` | TEXT NOT NULL | Extracted from ARN |
| `account_id` | TEXT NOT NULL | Extracted from ARN |
| `log_group` | TEXT | Derived: `/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}` |
| `available_qualifiers` | TEXT | JSON array of endpoint names (e.g., `["DEFAULT"]`) |
| `raw_metadata` | TEXT | Full JSON from AgentCore describe API |
| `source` | TEXT | `register` or `deploy` |
| `deployment_status` | TEXT | `deploying`, `deployed`, `failed`, `removing` |
| `execution_role_arn` | TEXT | IAM execution role ARN |
| `config_hash` | TEXT | Configuration hash |
| `endpoint_name` | TEXT | Runtime endpoint name |
| `endpoint_arn` | TEXT | Runtime endpoint ARN |
| `endpoint_status` | TEXT | Endpoint status |
| `protocol` | TEXT | `HTTP`, `MCP`, or `A2A` |
| `network_mode` | TEXT | `PUBLIC` or `VPC` |
| `authorizer_config` | TEXT | JSON: `{type, pool_id, discovery_url, allowed_clients, allowed_scopes}` |
| `registered_at` | DATETIME | Timestamp of local registration |
| `deployed_at` | DATETIME | Deployment timestamp |
| `last_refreshed_at` | DATETIME | Last time metadata was fetched from AWS |

### `agent_config_entries` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `agent_id` | INTEGER FK → agents.id (CASCADE delete) | Associated agent |
| `key` | TEXT NOT NULL | Configuration key |
| `value` | TEXT | Plaintext for non-secrets, ARN for secrets |
| `is_secret` | BOOLEAN | Whether value references a secret |
| `source` | TEXT | `env_var`, `secrets_manager`, `s3` |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

**Constraints:** UNIQUE on (`agent_id`, `key`).

### `invocation_sessions` table

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | INTEGER FK → agents.id | Associated agent |
| `session_id` | TEXT PK | UUID used as `runtimeSessionId` in the invoke call (primary key) |
| `qualifier` | TEXT NOT NULL | Endpoint qualifier used (e.g., `DEFAULT`) |
| `status` | TEXT NOT NULL | `pending`, `streaming`, `complete`, `error` |
| `created_at` | DATETIME NOT NULL | Session creation timestamp |

**Design decision:** `session_id` (UUID string) is the primary key rather than an auto-incrementing integer. This is a natural key — the session UUID is generated at invocation time and used as the `runtimeSessionId` in AWS API calls.

### `invocations` table

Each session contains one or more invocations. Timing measurements and latency data are stored per-invocation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `session_id` | TEXT FK → invocation_sessions.session_id | Parent session |
| `invocation_id` | TEXT UNIQUE NOT NULL | UUID identifying this specific invocation |
| `client_invoke_time` | REAL | Unix timestamp (seconds) recorded immediately before the invoke call |
| `client_done_time` | REAL | Unix timestamp when the stream completes |
| `agent_start_time` | REAL | Unix timestamp parsed from "Start time:" in CloudWatch logs |
| `cold_start_latency_ms` | REAL | `(agent_start_time - client_invoke_time) * 1000` |
| `client_duration_ms` | REAL | `(client_done_time - client_invoke_time) * 1000` |
| `status` | TEXT NOT NULL | `pending`, `streaming`, `complete`, `error` |
| `error_message` | TEXT | Error detail if status is `error` |
| `created_at` | DATETIME NOT NULL | Invocation creation timestamp |

**Computed fields (not stored in the database):**
- `active_session_count` — returned on agent responses. Counts sessions with at least one invocation whose last activity is within `SESSION_IDLE_TIMEOUT_MINUTES` of the current time. Indicates how many sessions are likely still warm in AWS.
- `live_status` — returned on session responses. Computed from the session's stored `status` and the timestamp of its most recent invocation:
  - `"pending"` / `"streaming"` → returned as-is
  - `"complete"` / `"error"` → `"active"` if last activity is within the idle timeout, otherwise `"expired"`

**Design decisions:**
- Prompt text, thinking text, and response text are stored per invocation (`prompt_text`, `thinking_text`, `response_text` columns on the `invocations` table).
- The `Agent` model retains an integer auto-incrementing PK. This is a surrogate key for internal use. The `arn` and `runtime_id` columns serve as natural identifiers when interacting with AWS. Integer PKs provide the best ergonomics for CLI usage (`AGENT_ID=1`) and fastest joins in SQLite.

---

## 5. ARN Parsing

Runtime ARN format: `arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}`

From the ARN, the backend automatically derives:
- `region` → extracted from ARN segment 3
- `account_id` → extracted from ARN segment 4
- `runtime_id` → extracted from ARN resource path

Log group format (per qualifier): `/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}`

Log stream names are discovered dynamically via `describe_log_streams` (ordered by last event time, filtering out AWS validation streams).

---

## 6. API Endpoints

All endpoints are prefixed `/api`.

### Agent Registration and Deployment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents` | Create agent (register by ARN or deploy new runtime). |
| `GET` | `/api/agents` | List all registered agents. |
| `GET` | `/api/agents/{agent_id}` | Get metadata for a specific registered agent. |
| `DELETE` | `/api/agents/{agent_id}?cleanup_aws=true` | Remove agent; optionally delete runtime from AgentCore. |
| `POST` | `/api/agents/{agent_id}/refresh` | Re-fetch metadata from AgentCore and update the local record. |
| `POST` | `/api/agents/{agent_id}/redeploy` | Redeploy an agent with current config. |
| `GET` | `/api/agents/roles` | List IAM roles suitable for AgentCore. |
| `GET` | `/api/agents/cognito-pools` | List Cognito user pools. |
| `GET` | `/api/agents/models` | List supported foundation models. |
| `PUT` | `/api/agents/{agent_id}/config` | Update agent configuration entries. |
| `GET` | `/api/agents/{agent_id}/config` | Get agent configuration entries. |
| `POST` | `/api/agents/{agent_id}/token` | Get Cognito access token for authenticated invocation. |

**`POST /api/agents` register request body:**
```json
{ "arn": "arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}" }
```

**`POST /api/agents` deploy request body:**

| Field | Description |
|-------|-------------|
| `source` | `register` or `deploy` |
| `name` | Agent name |
| `description` | Agent description |
| `agent_description` | Description passed to the agent prompt |
| `behavioral_guidelines` | Behavioral guidelines for the agent |
| `output_expectations` | Expected output format/behavior |
| `model_id` | Foundation model identifier |
| `role_arn` | IAM execution role ARN |
| `protocol` | `HTTP`, `MCP`, or `A2A` |
| `network_mode` | `PUBLIC` or `VPC` |
| `idle_timeout` | Idle timeout in seconds |
| `max_lifetime` | Maximum lifetime in seconds |
| `authorizer_type` | Authorizer type (e.g., Cognito) |
| `authorizer_pool_id` | Cognito user pool ID |
| `authorizer_discovery_url` | OIDC discovery URL |
| `authorizer_allowed_clients` | Allowed client IDs |
| `authorizer_allowed_scopes` | Allowed OAuth scopes |
| `authorizer_client_id` | Client ID for token retrieval |
| `authorizer_client_secret` | Client secret for token retrieval |
| `memory_enabled` | Whether memory is enabled |
| `mcp_servers` | MCP server configuration |
| `a2a_agents` | A2A agent configuration |

**Supported foundation models:** Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5, Amazon Nova 2 Lite, Nova Pro, Nova Lite, Nova Micro, Nova Nano.

**`GET /api/agents` response:**
```json
[
  {
    "id": 1,
    "arn": "...",
    "runtime_id": "myagent-abc123",
    "name": "My Agent",
    "status": "READY",
    "region": "us-east-1",
    "available_qualifiers": ["DEFAULT"],
    "log_group": "/aws/bedrock-agentcore/runtimes/myagent-abc123-DEFAULT",
    "registered_at": "2026-02-18T10:00:00Z",
    "active_session_count": 2
  }
]
```

The `active_session_count` field is computed at query time — it counts sessions with recent invocation activity within the `SESSION_IDLE_TIMEOUT_MINUTES` window. A value of 0 indicates the next invocation will likely be a cold start.

### Agent Invocation (SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/{agent_id}/invoke` | Invoke the agent and stream the response via SSE. |
| `GET` | `/api/agents/{agent_id}/sessions` | List all invocation sessions with their invocations. Includes computed `live_status`. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}` | Get a specific session with its invocations. Includes computed `live_status`. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/invocations/{invocation_id}` | Get a specific invocation within a session. |

**`POST /api/agents/{agent_id}/invoke` request body:**
```json
{
  "prompt": "Hello, agent!",
  "qualifier": "DEFAULT"
}
```

**SSE event stream format:**

The response is `text/event-stream`. Events:

```
event: session_start
data: {"session_id": "uuid-...", "invocation_id": "uuid-...", "client_invoke_time": 1708000000.123}

event: chunk
data: {"text": "Hello! I am "}

event: chunk
data: {"text": "your agent."}

event: session_end
data: {"session_id": "uuid-...", "invocation_id": "uuid-...", "qualifier": "DEFAULT", "client_invoke_time": 1708000000.123, "client_done_time": 1708000002.456, "client_duration_ms": 2333.0, "cold_start_latency_ms": 500.0, "agent_start_time": 1708000000.623}

event: error
data: {"message": "Invocation failed: ..."}
```

The `cold_start_latency_ms` and `agent_start_time` fields in `session_end` are only present when CloudWatch logs are successfully retrieved. The backend creates session and invocation records before streaming begins, updates them incrementally, and computes latency metrics when the stream completes.

**Streaming architecture:** The boto3 `invoke_agent_runtime` call returns a synchronous `StreamingBody`. Each chunk read is dispatched via `asyncio.to_thread()` to prevent blocking the uvicorn event loop, allowing SSE events to be flushed to the client in real-time.

### CloudWatch Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/{agent_id}/logs/streams` | List available CloudWatch log streams for this agent. |
| `GET` | `/api/agents/{agent_id}/logs` | Retrieve recent logs from the latest (or specified) log stream. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/logs` | Retrieve logs filtered to a specific session (searches across all streams). |

**Query parameters for `GET /logs`:**
- `qualifier` (string, default: `DEFAULT`) — which endpoint's log group to query
- `stream` (string, optional) — specific log stream name; defaults to the latest stream
- `limit` (int, default: `100`, max: `1000`) — max number of log events to return
- `start_time` (ISO 8601, optional) — filter events after this time
- `end_time` (ISO 8601, optional) — filter events before this time

**Query parameters for `GET /sessions/{session_id}/logs`:**
- `qualifier` (string, default: `DEFAULT`) — which endpoint's log group to query
- `limit` (int, default: `100`, max: `1000`) — max number of log events to return

**Log event response shape:**
```json
{
  "log_group": "/aws/bedrock-agentcore/runtimes/myagent-abc123-DEFAULT",
  "log_stream": "stream-name-here",
  "events": [
    {
      "timestamp_ms": 1708000001000,
      "timestamp_iso": "2026-02-18T10:00:01.000+00:00",
      "message": "{\"message\": \"Agent invoked - Start time: 2026-02-18T10:00:01.123456\", \"sessionId\": \"uuid-...\"}",
      "session_id": "uuid-..."
    }
  ]
}
```

**Log streams response shape:**
```json
{
  "log_group": "/aws/bedrock-agentcore/runtimes/myagent-abc123-DEFAULT",
  "streams": [
    {"name": "stream-latest", "last_event_time": 1708000002000},
    {"name": "stream-older", "last_event_time": 1708000001000}
  ]
}
```

**Design decisions:**
- The general logs endpoint (`GET /logs`) queries a single stream (latest by default) and does not retry. This is suitable for log browsing.
- The session logs endpoint (`GET /sessions/{id}/logs`) searches across all streams using `filter_log_events` with the session ID as a filter pattern. It uses `max_retries=1` with no retry interval — retry logic is only appropriate during the invoke flow where logs need time to appear in CloudWatch.
- A separate latency endpoint was removed. Cold-start latency is computed automatically during the invoke flow and included in the `session_end` SSE event.

---

## 7. Service Modules

### `services/agentcore.py`

Wraps `boto3.client('bedrock-agentcore')` and `boto3.client('bedrock-agentcore-control')`:

- `describe_runtime(arn: str, region: str) -> dict` — calls `get_agent_runtime` and returns runtime metadata.
- `list_runtime_endpoints(runtime_id: str, region: str) -> list[str]` — returns available qualifier names; falls back to `["DEFAULT"]` on error.
- `invoke_agent(arn: str, qualifier: str, session_id: str, prompt: str, region: str) -> Generator` — calls `invoke_agent_runtime`, yields decoded text chunks from the SSE-formatted streaming response. Supports OAuth-authorized agents — when an access token is provided, the client skips SigV4 signing and injects a Bearer token header instead.

**Note:** Session liveness (`live_status`, `active_session_count`) is computed locally in the routers using SQLite data and the idle timeout heuristic. No AWS API is called for session status — the Bedrock AgentCore SDK does not expose session listing/querying APIs.

### `services/cloudwatch.py`

Wraps `boto3.client('logs')`:

- `list_log_streams(log_group: str, region: str) -> list[dict]` — lists streams ordered by last event time, filters out AWS validation streams.
- `get_stream_log_events(log_group: str, stream_name: str, region: str, ...) -> list[dict]` — retrieves events from a single log stream without retry logic; suitable for general log browsing.
- `get_log_events(log_group: str, session_id: str, region: str, start_time_ms: int | None, limit: int, max_retries: int, retry_interval: float) -> list[dict]` — retrieves events matching the session_id filter pattern across all streams, with configurable retry logic for CloudWatch ingestion delays.
- `parse_agent_start_time(log_events: list[dict]) -> float | None` — searches events for the "Agent invoked - Start time:" pattern and returns the parsed Unix timestamp. Falls back to the earliest CloudWatch event timestamp when the pattern is not found, supporting agents with non-standard log formats.

### `services/deployment.py`

Handles agent artifact build and runtime lifecycle:

- Builds agent artifacts by cross-compiling pip dependencies for ARM64 (`manylinux2014_aarch64`), copying agent source from `agents/strands_agent/src/`, and packaging into a zip archive uploaded to S3.
- Creates, updates, and deletes AgentCore runtimes and endpoints.
- Validates configuration values for secrets, stores/updates/deletes secrets in AWS Secrets Manager.
- Stores large configuration values in S3.

### `services/cognito.py`

Cognito OAuth2 token retrieval:

- `get_cognito_token(pool_id: str, client_id: str, client_secret: str, scopes: list[str]) -> str` — exchanges client credentials for an access token via the Cognito OAuth2 token endpoint (client credentials grant).

### `services/secrets.py`

AWS Secrets Manager wrapper with in-memory caching:

- `store_secret(name: str, secret_value: str, region: str)` — creates or updates a secret.
- `get_secret(name: str, region: str) -> str` — retrieves a secret value with a 5-minute in-memory cache.
- `delete_secret(name: str, region: str)` — deletes a secret.

### `services/iam.py`

IAM and Cognito management:

- `create_execution_role() -> str` — creates an IAM execution role suitable for AgentCore.
- `delete_execution_role(role_arn: str)` — deletes an IAM execution role.
- `list_agentcore_roles() -> list[dict]` — lists IAM roles suitable for AgentCore.
- `list_cognito_pools() -> list[dict]` — lists Cognito user pools.

### `services/latency.py`

Pure computation helpers (no AWS dependencies):

- `compute_cold_start(client_invoke_time: float, agent_start_time: float) -> float` — returns millisecond delta.
- `compute_client_duration(client_invoke_time: float, client_done_time: float) -> float` — returns millisecond delta.

---

## 8. Agent Deployment Flow

1. User submits a deploy form with agent configuration.
2. Backend creates an IAM execution role (or uses the one provided by the user).
3. Builds the deployment artifact:
   - Copies source from `agents/strands_agent/src/`.
   - Runs `pip install` against `requirements.txt` targeting `linux/arm64` (`manylinux2014_aarch64`).
   - Zips the package and uploads it to S3.
4. Calls `create_agent_runtime` with the artifact location, environment variables, network/protocol/lifecycle/authorizer configuration.
5. Stores authorizer config on the agent record. Stores the Cognito `client_id` as a config entry. Stores the `client_secret` in AWS Secrets Manager and saves the resulting ARN as a config entry.
6. On delete with `cleanup_aws=true`: deletes the endpoint, deletes the runtime, and cleans up the Secrets Manager secret.

---

## 9. Authenticated Invocation Flow

When an agent has a Cognito authorizer configured, the invoke endpoint automatically fetches an access token before calling the runtime:

1. Reads `COGNITO_CLIENT_ID` from the agent's config entries.
2. Reads `COGNITO_CLIENT_SECRET_ARN` from the agent's config entries.
3. Retrieves the actual secret value from AWS Secrets Manager (cached in memory for 5 minutes).
4. Exchanges the client credentials for an access token via the Cognito client credentials grant.
5. Passes the Bearer token to `invoke_agent_runtime` (unsigned SigV4 + `Authorization` header).

---

## 10. Latency Measurement Flow

Latency measurement is integrated into the invoke flow — no separate endpoint is needed. The backend computes cold-start latency automatically after the agent stream completes.

```
Client                  Backend                 AWS
   │                       │                     │
   │── POST /invoke ──────►│                     │
   │                       │── record client_invoke_time
   │                       │── create session + invocation records
   │                       │── invoke_agent_runtime ────────────────►│
   │                       │◄── SSE stream chunks (asyncio.to_thread)│
   │◄── SSE: session_start─│                     │
   │◄── SSE: chunk... ─────│  (real-time flush)  │
   │                       │── record client_done_time               │
   │                       │── compute client_duration_ms            │
   │                       │── filter_log_events (asyncio.to_thread)►│
   │                       │◄── log events ──────────────────────────│
   │                       │── parse "Start time:" from logs         │
   │                       │── compute cold_start_latency_ms         │
   │                       │── persist all metrics to SQLite         │
   │◄── SSE: session_end ──│  (includes latency data)                │
```

**Latency definition:**
- `cold_start_latency_ms = (agent_start_time - client_invoke_time) * 1000`
- `client_duration_ms = (client_done_time - client_invoke_time) * 1000`
- `agent_start_time` is preferentially parsed from the CloudWatch log message pattern:
  `Agent invoked - Start time: {ISO_TIMESTAMP}, ...`
  If this pattern is not found (agents with non-standard log formats), the earliest CloudWatch event timestamp is used as a fallback approximation.
- CloudWatch log retrieval is done with `session_id` as the filter pattern.
- During invoke, the system retries CloudWatch polling up to 6 times (5-second intervals, 30-second max) waiting for logs to appear.
- If CloudWatch retrieval fails or no logs are found, the invocation completes successfully without latency data — `cold_start_latency_ms` and `agent_start_time` will be absent from the `session_end` event.

---

## 11. Session Liveness Tracking

Session liveness is computed locally — no AWS API calls are made. The Bedrock AgentCore SDK does not expose `list_runtime_sessions` or `get_runtime_session` APIs, so there is no way to query AWS for the actual state of a runtime session. Instead, the backend uses a local idle timeout heuristic based on invocation timestamps already stored in SQLite.

### Configuration

- `SESSION_IDLE_TIMEOUT_MINUTES` (default: `15`) — how long after the last invocation activity a session is considered still warm in AWS.

### `live_status` Computation

For each session, the `live_status` is computed at query time from the stored `status` and the most recent invocation's timestamp:

| Stored Status | Last Activity | `live_status` |
|---------------|---------------|---------------|
| `pending` | any | `"pending"` |
| `streaming` | any | `"streaming"` |
| `complete` / `error` | within timeout | `"active"` |
| `complete` / `error` | beyond timeout | `"expired"` |

### `active_session_count` Computation

For each agent, `active_session_count` is computed at query time by counting sessions whose `live_status` would be `"pending"`, `"streaming"`, or `"active"`. This tells users how many sessions are likely still warm — when the count is 0, the next invocation will likely incur cold-start latency.

### Design Rationale

- **No AWS API dependency** — avoids throttling, latency, and credential scope concerns.
- **Heuristic accuracy** — AWS session idle timeout behavior is not documented, but 15 minutes is a reasonable default. The timeout is configurable via `SESSION_IDLE_TIMEOUT_MINUTES`.
- **Computed, not stored** — `live_status` and `active_session_count` are derived at query time, ensuring they always reflect the current moment relative to invocation history.

---

## 12. Makefile Targets

The backend `makefile` sources `etc/environment.sh` and provides:

```makefile
install              # uv pip install -r requirements.txt
test                 # python -m pytest tests/ -v
run                  # uvicorn app.main:app --reload --port $BACKEND_PORT

# Manual testing targets
curl.health          # GET /health
curl.agents.register # POST /api/agents (ARN= required)
curl.agents.list     # GET /api/agents
curl.agents.get      # GET /api/agents/{AGENT_ID}
curl.agents.refresh  # POST /api/agents/{AGENT_ID}/refresh
curl.agents.delete   # DELETE /api/agents/{AGENT_ID}
curl.invoke          # POST /api/agents/{AGENT_ID}/invoke (streams via scripts/stream.py)
curl.sessions.list   # GET /api/agents/{AGENT_ID}/sessions
curl.sessions.get    # GET /api/agents/{AGENT_ID}/sessions/{SESSION_ID}
curl.logs            # GET /api/agents/{AGENT_ID}/logs (optional QUALIFIER, LIMIT, STREAM)
curl.logs.streams    # GET /api/agents/{AGENT_ID}/logs/streams
curl.logs.session    # GET /api/agents/{AGENT_ID}/sessions/{SESSION_ID}/logs
```
