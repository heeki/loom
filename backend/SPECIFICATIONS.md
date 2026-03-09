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
| `LOOM_SESSION_IDLE_TIMEOUT_SECONDS` | Idle timeout for session liveness detection | `300` |
| `LOOM_SESSION_MAX_LIFETIME_SECONDS` | Maximum session lifetime | `3600` |
| `AWS_REGION` | AWS region for deployments | `us-east-1` |
| `LOOM_ARTIFACT_BUCKET` | S3 bucket for agent deployment artifacts | — |
| `MEMORY_NAME` | Default memory resource name | `loom_memory` |
| `MEMORY_EVENT_EXPIRY_DURATION` | Default memory event expiry in days | `30` |

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
│   │   ├── invocation.py    # Invocation ORM model
│   │   ├── managed_role.py  # ManagedRole ORM model (IAM roles)
│   │   ├── authorizer_config.py    # AuthorizerConfig ORM model
│   │   ├── authorizer_credential.py # AuthorizerCredential ORM model
│   │   ├── permission_request.py   # PermissionRequest ORM model
│   │   └── memory.py        # Memory ORM model (AgentCore Memory resources)
│   ├── routers/
│   │   ├── agents.py        # Agent CRUD + ARN parsing + log group derivation
│   │   ├── invocations.py   # SSE streaming invoke + session/invocation queries
│   │   ├── logs.py          # CloudWatch log browsing + session log retrieval
│   │   ├── memories.py      # Memory resource CRUD + strategy mapping
│   │   ├── security.py      # Security admin: roles, authorizers, credentials, permissions
│   │   └── utils.py         # Shared router utilities (get_agent_or_404)
│   └── services/
│       ├── agentcore.py     # Bedrock AgentCore API wrapper
│       ├── cloudwatch.py    # CloudWatch log retrieval and parsing
│       ├── cognito.py       # Cognito OAuth2 token retrieval (client credentials grant)
│       ├── credential.py    # AgentCore credential provider management
│       ├── deployment.py    # Agent artifact build, runtime CRUD, secret detection
│       ├── iam.py           # IAM role creation/deletion, Cognito pool listing
│       ├── latency.py       # Latency calculation helpers
│       ├── memory.py        # Bedrock AgentCore Memory API wrapper
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
│   ├── test_agents_deploy.py # Deployment-specific tests
│   └── test_memories.py     # Memory resource tests
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

### `managed_roles` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `role_name` | TEXT NOT NULL | IAM role name |
| `role_arn` | TEXT UNIQUE NOT NULL | IAM role ARN |
| `description` | TEXT | Role description |
| `policy_document` | TEXT | JSON policy document |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

### `authorizer_configs` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `name` | TEXT UNIQUE NOT NULL | Authorizer config name |
| `authorizer_type` | TEXT NOT NULL | e.g., `cognito` |
| `pool_id` | TEXT | Cognito user pool ID |
| `discovery_url` | TEXT | OIDC discovery URL |
| `allowed_clients` | TEXT | JSON array of allowed client IDs |
| `allowed_scopes` | TEXT | JSON array of allowed OAuth scopes |
| `client_id` | TEXT | Default client ID |
| `client_secret_arn` | TEXT | Secrets Manager ARN for default client secret |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

### `authorizer_credentials` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `authorizer_config_id` | INTEGER FK → authorizer_configs.id (CASCADE delete) | Associated authorizer |
| `label` | TEXT NOT NULL | Human-readable credential label |
| `client_id` | TEXT NOT NULL | OAuth client ID |
| `client_secret_arn` | TEXT NOT NULL | Secrets Manager ARN for client secret |
| `created_at` | DATETIME | Creation timestamp |

### `permission_requests` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `managed_role_id` | INTEGER FK → managed_roles.id | Target role |
| `requested_actions` | TEXT | JSON array of IAM actions |
| `requested_resources` | TEXT | JSON array of IAM resources |
| `justification` | TEXT | Request justification |
| `status` | TEXT NOT NULL | `pending`, `approved`, `denied` |
| `reviewer_notes` | TEXT | Reviewer notes |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

### `memories` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `name` | TEXT NOT NULL | Memory resource name |
| `description` | TEXT | Optional description |
| `arn` | TEXT | ARN returned after creation |
| `memory_id` | TEXT | AWS memory resource ID |
| `region` | TEXT NOT NULL | AWS region |
| `account_id` | TEXT NOT NULL | AWS account ID |
| `status` | TEXT NOT NULL | Resource status (`CREATING`, `ACTIVE`, `FAILED`, `DELETING`) |
| `event_expiry_duration` | INTEGER NOT NULL | Duration in days before memory events expire |
| `memory_execution_role_arn` | TEXT | IAM role ARN for the memory resource |
| `encryption_key_arn` | TEXT | KMS key ARN for encryption |
| `strategies_config` | TEXT | JSON: memory strategies as submitted |
| `strategies_response` | TEXT | JSON: strategies with IDs and statuses from AWS |
| `failure_reason` | TEXT | Failure reason if status is `FAILED` |
| `created_at` | DATETIME | Creation timestamp |
| `updated_at` | DATETIME | Last update timestamp |

### `invocation_sessions` table

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | INTEGER FK → agents.id | Associated agent |
| `session_id` | TEXT PK | UUID used as `runtimeSessionId` in the invoke call (primary key) |
| `qualifier` | TEXT NOT NULL | Endpoint qualifier used (e.g., `DEFAULT`) |
| `status` | TEXT NOT NULL | `pending`, `streaming`, `complete`, `error` |
| `created_at` | DATETIME NOT NULL | Session creation timestamp |

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
- `active_session_count` — returned on agent responses. Counts sessions with at least one invocation whose last activity is within `LOOM_SESSION_IDLE_TIMEOUT_SECONDS` of the current time.
- `live_status` — returned on session responses. Computed from the session's stored `status` and the timestamp of its most recent invocation:
  - `"pending"` / `"streaming"` → returned as-is
  - `"complete"` / `"error"` → `"active"` if last activity is within the idle timeout, otherwise `"expired"`

**Design decisions:**
- Prompt text, thinking text, and response text are stored per invocation (`prompt_text`, `thinking_text`, `response_text` columns on the `invocations` table).
- The `Agent` model retains an integer auto-incrementing PK. The `arn` and `runtime_id` columns serve as natural identifiers when interacting with AWS.

---

## 5. ARN Parsing

Runtime ARN format: `arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}`

From the ARN, the backend automatically derives:
- `region` → extracted from ARN segment 3
- `account_id` → extracted from ARN segment 4
- `runtime_id` → extracted from ARN resource path

Log group format (per qualifier): `/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}`

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
| `GET` | `/api/agents/models` | List supported foundation models (with display name and group). |
| `GET` | `/api/agents/defaults` | Get configurable defaults (idle timeout, max lifetime). |
| `PUT` | `/api/agents/{agent_id}/config` | Update agent configuration entries. |
| `GET` | `/api/agents/{agent_id}/config` | Get agent configuration entries. |

**`POST /api/agents` register request body:**
```json
{
  "arn": "arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}",
  "model_id": "us.anthropic.claude-sonnet-4-6"
}
```

The `model_id` field is optional on registration and stored as an `AGENT_CONFIG_JSON` config entry.

**`POST /api/agents` deploy request body:**

| Field | Description |
|-------|-------------|
| `source` | `register` or `deploy` |
| `name` | Agent name |
| `description` | Agent description |
| `agent_description` | Description passed to the agent prompt |
| `behavioral_guidelines` | Behavioral guidelines for the agent |
| `output_expectations` | Expected output format/behavior |
| `model_id` | Foundation model identifier (required) |
| `role_arn` | IAM execution role ARN (required) |
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

**`GET /api/agents` response includes:**
- `model_id` — extracted from the agent's `AGENT_CONFIG_JSON` config entry
- `active_session_count` — computed at query time based on `LOOM_SESSION_IDLE_TIMEOUT_SECONDS`

**`GET /api/agents/models` response:**
```json
[
  {"model_id": "us.anthropic.claude-opus-4-6-v1", "display_name": "Claude Opus 4.6", "group": "Anthropic"},
  {"model_id": "us.amazon.nova-pro-v1:0", "display_name": "Nova Pro", "group": "Amazon"}
]
```

**`GET /api/agents/defaults` response:**
```json
{
  "idle_timeout_seconds": 300,
  "max_lifetime_seconds": 3600
}
```

### Security Administration

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/security/roles` | Create a managed role (import or wizard mode). |
| `GET` | `/api/security/roles` | List managed roles. |
| `GET` | `/api/security/roles/{role_id}` | Get a specific managed role. |
| `PUT` | `/api/security/roles/{role_id}` | Update a managed role. |
| `DELETE` | `/api/security/roles/{role_id}` | Delete a managed role. |
| `GET` | `/api/security/cognito-pools` | List Cognito pools with discovery URLs. |
| `POST` | `/api/security/authorizers` | Create an authorizer config. |
| `GET` | `/api/security/authorizers` | List authorizer configs. |
| `GET` | `/api/security/authorizers/{auth_id}` | Get a specific authorizer config. |
| `PUT` | `/api/security/authorizers/{auth_id}` | Update an authorizer config. |
| `DELETE` | `/api/security/authorizers/{auth_id}` | Delete an authorizer config. |
| `POST` | `/api/security/authorizers/{auth_id}/credentials` | Add a credential to an authorizer. |
| `GET` | `/api/security/authorizers/{auth_id}/credentials` | List credentials for an authorizer. |
| `DELETE` | `/api/security/authorizers/{auth_id}/credentials/{cred_id}` | Delete a credential. |
| `POST` | `/api/security/authorizers/{auth_id}/credentials/{cred_id}/token` | Generate OAuth token from credential. |
| `POST` | `/api/security/permission-requests` | Create a permission request. |
| `GET` | `/api/security/permission-requests` | List permission requests. |
| `PUT` | `/api/security/permission-requests/{req_id}/review` | Approve or deny a permission request. |

### Memory Resources

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/memories` | Create a new memory resource. |
| `POST` | `/api/memories/import` | Import an existing memory resource by AWS memory ID. |
| `GET` | `/api/memories` | List all memory resources. |
| `GET` | `/api/memories/{memory_id}` | Get a specific memory resource. |
| `POST` | `/api/memories/{memory_id}/refresh` | Refresh memory status from AWS. |
| `DELETE` | `/api/memories/{memory_id}?cleanup_aws=true` | Delete a memory resource; optionally delete from AWS. |
| `DELETE` | `/api/memories/{memory_id}/purge` | Remove from local DB only (no AWS call). |

**Naming convention:** Memory names and strategy names must match `[a-zA-Z][a-zA-Z0-9_]{0,47}` — start with a letter, letters/digits/underscores only, max 48 characters. Hyphens are not allowed.

**`POST /api/memories` request body:**
```json
{
  "name": "my_memory",
  "event_expiry_duration": 30,
  "description": "Optional description",
  "memory_execution_role_arn": "arn:aws:iam::...:role/...",
  "encryption_key_arn": "arn:aws:kms:...",
  "memory_strategies": [
    {
      "strategy_type": "semantic",
      "name": "default-semantic",
      "description": "Optional",
      "namespaces": ["ns1"],
      "configuration": {}
    }
  ]
}
```

**`POST /api/memories/import` request body:**
```json
{
  "memory_id": "my_memory-zYcvlyGXsK"
}
```

Fetches the memory details from AWS via `get_memory` and stores them locally. Returns 409 if the memory is already imported.

**`DELETE /api/memories/{memory_id}?cleanup_aws=true`:**
When `cleanup_aws=true` (default), initiates async deletion in AWS and marks status as DELETING. When `cleanup_aws=false`, removes from local DB only. For FAILED memories, always removes locally without AWS call.

**`DELETE /api/memories/{memory_id}/purge`:**
Removes the memory record from the local database without any AWS API call. Used by the frontend after confirming that AWS deletion is complete (404 on refresh). Returns 204 No Content.

**Strategy type mapping:**

| `strategy_type` | AWS Parameter Key |
|-----------------|-------------------|
| `semantic` | `semanticMemoryStrategy` |
| `summary` | `summaryMemoryStrategy` |
| `user_preference` | `userPreferenceMemoryStrategy` |
| `episodic` | `episodicMemoryStrategy` |
| `custom` | `customMemoryStrategy` |

**Error mapping:**

| AWS Exception | HTTP Status |
|---------------|-------------|
| `ValidationException` | 400 |
| `ConflictException` | 409 |
| `ResourceNotFoundException` | 404 |
| `ServiceQuotaExceededException` | 429 |
| `AccessDeniedException` | 403 |
| `ThrottledException` | 429 |

### Agent Invocation (SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/{agent_id}/invoke` | Invoke the agent and stream the response via SSE. |
| `GET` | `/api/agents/{agent_id}/sessions` | List all invocation sessions with their invocations. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}` | Get a specific session with its invocations. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/invocations/{invocation_id}` | Get a specific invocation. |

**`POST /api/agents/{agent_id}/invoke` request body:**
```json
{
  "prompt": "Hello, agent!",
  "qualifier": "DEFAULT",
  "credential_id": 1
}
```

The optional `credential_id` references an authorizer credential. When provided, the backend fetches the client secret from Secrets Manager and generates an OAuth token for authenticated invocation.

**SSE event stream format:**

```
event: session_start
data: {"session_id": "uuid-...", "invocation_id": "uuid-...", "client_invoke_time": 1708000000.123, "has_token": true, "token_source": "credential:my-cred"}

event: chunk
data: {"text": "Hello! I am your agent."}

event: session_end
data: {"session_id": "uuid-...", "invocation_id": "uuid-...", "qualifier": "DEFAULT", "client_invoke_time": 1708000000.123, "client_done_time": 1708000002.456, "client_duration_ms": 2333.0, "cold_start_latency_ms": 500.0, "agent_start_time": 1708000000.623}

event: error
data: {"message": "Invocation failed: ..."}
```

The `has_token` and `token_source` fields in `session_start` indicate whether an OAuth token was used for the invocation.

### CloudWatch Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/{agent_id}/logs/streams` | List available CloudWatch log streams. |
| `GET` | `/api/agents/{agent_id}/logs` | Retrieve recent logs from the latest (or specified) log stream. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/logs` | Retrieve logs filtered to a specific session. |

---

## 7. Service Modules

### `services/agentcore.py`

Wraps `boto3.client('bedrock-agentcore')` and `boto3.client('bedrock-agentcore-control')`:

- `describe_runtime(arn: str, region: str) -> dict` — calls `get_agent_runtime` and returns runtime metadata.
- `list_runtime_endpoints(runtime_id: str, region: str) -> list[str]` — returns available qualifier names.
- `invoke_agent(arn: str, qualifier: str, session_id: str, prompt: str, region: str) -> Generator` — calls `invoke_agent_runtime`, yields decoded text chunks. Supports OAuth-authorized agents via Bearer token header.

### `services/cloudwatch.py`

Wraps `boto3.client('logs')`:

- `list_log_streams(log_group: str, region: str) -> list[dict]` — lists streams ordered by last event time.
- `get_stream_log_events(log_group: str, stream_name: str, region: str, ...) -> list[dict]` — retrieves events from a single log stream.
- `get_log_events(log_group: str, session_id: str, region: str, ...) -> list[dict]` — retrieves events matching the session_id filter pattern across all streams.
- `parse_agent_start_time(log_events: list[dict]) -> float | None` — parses "Agent invoked - Start time:" pattern; falls back to earliest CloudWatch event timestamp.

### `services/deployment.py`

Handles agent artifact build and runtime lifecycle:

- Builds agent artifacts by cross-compiling pip dependencies for ARM64 (`manylinux2014_aarch64`).
- Creates, updates, and deletes AgentCore runtimes and endpoints.
- Validates configuration values for secrets, stores/updates/deletes secrets in AWS Secrets Manager.

### `services/cognito.py`

- `get_cognito_token(pool_id: str, client_id: str, client_secret: str, scopes: list[str]) -> str` — exchanges client credentials for an access token via the Cognito OAuth2 token endpoint.

### `services/secrets.py`

- `store_secret(name: str, secret_value: str, region: str)` — creates or updates a secret.
- `get_secret(name: str, region: str) -> str` — retrieves a secret value with a 5-minute in-memory cache.
- `delete_secret(name: str, region: str)` — deletes a secret.

### `services/iam.py`

- `create_execution_role() -> str` — creates an IAM execution role suitable for AgentCore.
- `delete_execution_role(role_arn: str)` — deletes an IAM execution role.
- `list_agentcore_roles() -> list[dict]` — lists IAM roles suitable for AgentCore.
- `list_cognito_pools() -> list[dict]` — lists Cognito user pools.

### `services/memory.py`

Wraps `boto3.client('bedrock-agentcore-control')` for memory operations:

- `create_memory(name, event_expiry_duration, ..., region) -> dict` — calls `create_memory` and returns the full response including ARN, ID, and status.
- `get_memory(memory_id, region) -> dict` — calls `get_memory(memoryId=...)` and returns current memory state.
- `list_memories(region) -> dict` — calls `list_memories()` and returns all memory resources.
- `delete_memory(memory_id, region) -> dict` — calls `delete_memory(memoryId=...)`.

### `services/latency.py`

- `compute_cold_start(client_invoke_time: float, agent_start_time: float) -> float` — returns millisecond delta.
- `compute_client_duration(client_invoke_time: float, client_done_time: float) -> float` — returns millisecond delta.

---

## 8. Agent Deployment Flow

1. User submits a deploy form with agent configuration (model and IAM role are required).
2. Backend uses the provided IAM execution role.
3. Builds the deployment artifact:
   - Copies source from `agents/strands_agent/src/`.
   - Runs `pip install` against `requirements.txt` targeting `linux/arm64` (`manylinux2014_aarch64`).
   - Fixes console script shebangs (e.g. `opentelemetry-instrument`) to use `#!/usr/bin/env python3` for Linux compatibility.
   - Zips the package and uploads it to S3.
4. Calls `create_agent_runtime` with the artifact location, environment variables (including `OTEL_SERVICE_NAME` set to the agent name and `AGENT_OBSERVABILITY_ENABLED=true` to activate the `aws-opentelemetry-distro` export pipeline), network/protocol/lifecycle/authorizer configuration.
5. Stores authorizer config on the agent record. Stores the Cognito `client_id` as a config entry. Stores the `client_secret` in AWS Secrets Manager and saves the resulting ARN as a config entry.
6. On delete with `cleanup_aws=true`: deletes the endpoint, deletes the runtime, and cleans up the Secrets Manager secret.

---

## 9. Authenticated Invocation Flow

Invocations can be authenticated using credentials from authorizer configs:

1. The invoke request includes an optional `credential_id`.
2. The backend looks up the `AuthorizerCredential` by ID, resolving the associated `AuthorizerConfig`.
3. Reads the `client_secret` from AWS Secrets Manager (cached in memory for 5 minutes).
4. Exchanges the client credentials for an access token via the Cognito client credentials grant.
5. Passes the Bearer token to `invoke_agent_runtime` (unsigned SigV4 + `Authorization` header).
6. The `session_start` SSE event includes `has_token: true` and `token_source` indicating which credential was used.

---

## 10. Latency Measurement Flow

Latency measurement is integrated into the invoke flow — no separate endpoint is needed.

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

---

## 11. Session Liveness Tracking

Session liveness is computed locally — no AWS API calls are made.

### Configuration

- `LOOM_SESSION_IDLE_TIMEOUT_SECONDS` (default: `300`) — how long after the last invocation activity a session is considered still warm.
- `LOOM_SESSION_MAX_LIFETIME_SECONDS` (default: `3600`) — maximum session lifetime regardless of activity.

Both values are exposed via `GET /api/agents/defaults` for the frontend to display as placeholder hints.

### `live_status` Computation

| Stored Status | Last Activity | `live_status` |
|---------------|---------------|---------------|
| `pending` | any | `"pending"` |
| `streaming` | any | `"streaming"` |
| `complete` / `error` | within timeout | `"active"` |
| `complete` / `error` | beyond timeout | `"expired"` |

### `active_session_count` Computation

Counts sessions whose `live_status` would be `"pending"`, `"streaming"`, or `"active"`. Computed based on the end time (`client_done_time`) of the last invocation.

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

# Memory resource targets
curl.memories.create  # POST /api/memories (MEMORY_NAME, MEMORY_EVENT_EXPIRY_DURATION)
curl.memories.import  # POST /api/memories/import (MEMORY_AWS_ID)
curl.memories.list    # GET /api/memories
curl.memories.get     # GET /api/memories/{MEMORY_ID}
curl.memories.refresh # POST /api/memories/{MEMORY_ID}/refresh
curl.memories.delete  # DELETE /api/memories/{MEMORY_ID}?cleanup_aws=true
curl.memories.purge   # DELETE /api/memories/{MEMORY_ID}/purge
```
