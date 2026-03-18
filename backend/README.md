# Loom Backend

FastAPI backend for the Loom Agent Builder Playground. Provides endpoints for agent registration, deployment, SSE streaming invocation, paginated CloudWatch log retrieval, cold-start latency measurement, session liveness tracking, memory resource management, MCP server management, A2A agent management, security administration, tag policy management, tag profile management, cost estimation dashboard, and actual runtime cost retrieval from CloudWatch usage logs.

## Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | FastAPI |
| Server | Uvicorn |
| ORM | SQLAlchemy (SQLite) |
| AWS SDK | boto3 |
| Python | 3.11+ |
| Dependency manager | uv |
| Streaming | SSE via `StreamingResponse` |

## Setup

```bash
# Create and activate virtual environment
uv venv .venv
source .venv/bin/activate

# Install dependencies
make install

# Run tests
make test

# Start the development server
make run
```

## Configuration

Runtime configuration is sourced from `etc/environment.sh`:

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_PORT` | Port for uvicorn | `8000` |
| `FRONTEND_PORT` | Port for Vite dev server (CORS) | `5173` |
| `DATABASE_URL` | SQLite file path | `sqlite:///./loom.db` |
| `LOG_LEVEL` | Backend log level | `info` |
| `LOOM_SESSION_IDLE_TIMEOUT_SECONDS` | Session idle timeout for liveness detection | `300` |
| `LOOM_SESSION_MAX_LIFETIME_SECONDS` | Maximum session lifetime | `3600` |
| `AWS_REGION` | AWS region for deployments | `us-east-1` |
| `LOOM_ARTIFACT_BUCKET` | S3 bucket for agent deployment artifacts | — |
| `MEMORY_NAME` | Default memory resource name | `loom_memory` |
| `MEMORY_EVENT_EXPIRY_DURATION` | Default memory event expiry in days | `30` |
| `LOOM_COGNITO_USER_POOL_ID` | Cognito User Pool ID for user authentication | — |
| `LOOM_COGNITO_REGION` | Region of the Cognito pool | `AWS_REGION` |
| `LOOM_COGNITO_USER_CLIENT_ID` | Cognito user app client ID (auto-included in agent `allowedClients` on deploy) | — |

AWS credentials use the standard boto3 credential chain (environment variables, AWS profile, instance metadata).

When `LOOM_COGNITO_USER_POOL_ID` is set, the backend validates user JWTs, derives scopes from `cognito:groups` via the `GROUP_SCOPES` mapping, and enforces per-endpoint scope requirements using `require_scopes()`. Returns 401 for missing/invalid tokens, 403 for insufficient scopes. When not set (bypass mode), all scopes are granted for local development. The user client ID is configured on the frontend side (via `VITE_COGNITO_USER_CLIENT_ID` in the frontend `.env` file), not the backend.

## Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI application entry point
│   ├── db.py                # SQLAlchemy engine, session factory, init_db
│   ├── models/
│   │   ├── agent.py         # Agent ORM model
│   │   ├── config_entry.py  # AgentConfigEntry ORM model (per-agent key-value config)
│   │   ├── session.py       # InvocationSession ORM model (session_id string PK)
│   │   ├── invocation.py    # Invocation ORM model (timing + latency data)
│   │   ├── managed_role.py  # ManagedRole ORM model (IAM roles)
│   │   ├── authorizer_config.py    # AuthorizerConfig ORM model
│   │   ├── authorizer_credential.py # AuthorizerCredential ORM model
│   │   ├── permission_request.py   # PermissionRequest ORM model
│   │   ├── memory.py        # Memory ORM model (AgentCore Memory resources)
│   │   ├── mcp.py           # McpServer, McpTool, McpServerAccess ORM models
│   │   ├── a2a.py           # A2aAgent, A2aAgentSkill, A2aAgentAccess
│   │   ├── tag_policy.py    # TagPolicy ORM model (configurable tag policies)
│   │   ├── tag_profile.py   # TagProfile ORM model (named tag presets)
│   │   ├── site_setting.py    # SiteSetting ORM model (site-wide settings)
│   ├── dependencies/
│   │   └── auth.py          # Auth dependencies (get_current_user, require_scopes, UserInfo)
│   ├── routers/
│   │   ├── auth.py          # Auth config endpoint (GET /api/auth/config)
│   │   ├── agents.py        # Agent CRUD + ARN parsing + log group derivation
│   │   ├── invocations.py   # SSE streaming invoke + session/invocation queries
│   │   ├── logs.py          # CloudWatch log browsing with pagination + session log retrieval via stream-name matching
│   │   ├── memories.py      # Memory resource CRUD + strategy mapping
│   │   ├── a2a.py           # A2A agent CRUD, Agent Card, skills, access control
│   │   ├── mcp.py           # MCP server CRUD, tool discovery, access control
│   │   ├── security.py      # Security admin: roles, authorizers, credentials, permissions
│   │   ├── settings.py      # Tag policy + tag profile CRUD (/api/settings/tags, /api/settings/tag-profiles)
│   │   ├── costs.py          # Cost dashboard: estimates + actuals from CloudWatch usage logs
│   │   └── utils.py         # Shared router utilities
│   └── services/
│       ├── agentcore.py     # boto3 wrapper: describe, list endpoints, invoke
│       ├── cloudwatch.py    # CloudWatch log retrieval with pagination, session filtering, and usage log parsing
│       ├── cognito.py       # Cognito OAuth2 token retrieval
│       ├── credential.py    # AgentCore credential provider management
│       ├── deployment.py    # Agent artifact build + runtime CRUD
│       ├── iam.py           # IAM role management + Cognito pool listing
│       ├── jwt_validator.py # JWT validation against Cognito JWKS
│       ├── latency.py       # Pure computation: cold_start_latency_ms, client_duration_ms
│       ├── a2a.py           # A2A Agent Card fetching, parsing, connection test
│       ├── mcp.py           # MCP connection test + tool fetch stubs
│       ├── memory.py        # boto3 wrapper: AgentCore Memory CRUD
│       └── secrets.py       # Secrets Manager wrapper with caching
├── scripts/
│   └── stream.py            # CLI streaming client (httpx-based)
├── tests/
│   ├── test_agents_deploy.py
│   ├── test_a2a.py          # A2A agent CRUD, Agent Card, skills, access
├── makefile                 # Build, test, and manual testing targets
├── pyproject.toml
└── requirements.txt
```

## Database Schema

### `agents`

Stores registered and deployed AgentCore Runtime agents. Uses an auto-incrementing integer PK for internal references; `arn` and `runtime_id` are stored as indexed columns for AWS lookups. Includes columns for: `source`, `deployment_status`, `execution_role_arn`, `endpoint_name`, `endpoint_arn`, `endpoint_status`, `protocol`, `network_mode`, `authorizer_config`, `credential_providers`, `deployed_at`, and `tags` (JSON dict of resolved tag key-value pairs).

### `agent_config_entries`

Stores key-value configuration per agent. Used for environment variables, secret ARN references, and agent metadata (e.g., `AGENT_CONFIG_JSON` for model_id).

### `managed_roles`

Stores IAM roles managed through the Security Admin workflow. Includes role name, ARN, description, and policy document.

### `authorizer_configs`

Stores authorizer configurations (e.g., Cognito pools) with pool ID, discovery URL, allowed clients, and allowed scopes.

### `authorizer_credentials`

Stores OAuth credentials per authorizer config. Each credential has a label, client_id, and a reference to the client_secret stored in AWS Secrets Manager (`client_secret_arn`). Client secrets are never stored in the local database.

### `permission_requests`

Stores permission escalation requests against managed roles. Includes requested actions, resources, justification, and review status (pending/approved/denied).

### `tag_policies`

Stores configurable tag policies for AWS resource tagging. Each policy defines a tag key, optional default value, source (`deploy-time` for auto-applied tags, `build-time` for user-supplied tags), whether the tag is required, and whether it should display on cards (`show_on_card`). Seeded with default policies (`loom:deployed-by`, `loom:application`, `loom:group`, `loom:owner`) on database initialization.

### `tag_profiles`

Stores named presets of tag key-value pairs. Each profile has a unique name and a JSON dict of tags. When a profile is selected during deployment, its tag values are merged with deploy-time policy defaults and applied to all created AWS resources. Tag values are limited to 128 characters.

### `mcp_servers`

Stores registered MCP servers. Columns include `name`, `url`, `transport` (sse or streamable_http), `description`, `auth_type` (none or oauth2), OAuth2 fields (`oauth2_client_id`, `oauth2_client_secret`, `oauth2_token_url`, `oauth2_scopes`, `oauth2_well_known_url`), `status` (active/inactive), and timestamps. The `oauth2_client_secret` is write-only — it is never returned in GET responses; a boolean `has_oauth2_secret` is returned instead.

### `mcp_tools`

Stores discovered tools for each MCP server. Columns include `server_id` (FK to mcp_servers), `name`, `description`, and `input_schema` (JSON). Tools are refreshed via the tool discovery endpoint. Cascade-deletes when the parent server is removed.

### `mcp_server_access`

Stores per-persona access rules for MCP server tools. Columns include `server_id` (FK to mcp_servers), `persona` (unique per server), `allowed` (boolean), `access_mode` (all_tools or selected_tools), and `allowed_tool_names` (JSON list). Defaults to deny (no access) until explicitly granted. Cascade-deletes when the parent server is removed.

### `a2a_agents`

Stores registered A2A (Agent-to-Agent) protocol agents. Columns include `base_url`, `name`, `description`, `agent_version`, `documentation_url`, `provider_organization`, `provider_url`, `capabilities` (JSON), `authentication_schemes` (JSON), `default_input_modes` (JSON), `default_output_modes` (JSON), `agent_card_raw` (JSON), `status` (active/inactive/error), `auth_type` (none or oauth2), OAuth2 fields (`oauth2_client_id`, `oauth2_client_secret`, `oauth2_well_known_url`, `oauth2_scopes`), `last_fetched_at`, and timestamps. The `oauth2_client_secret` is write-only — it is never returned in GET responses.

### `a2a_agent_skills`

Stores skills parsed from A2A Agent Cards. Columns include `agent_id` (FK to a2a_agents), `skill_id`, `name`, `description`, `tags` (JSON), `examples` (JSON), `input_modes` (JSON), `output_modes` (JSON), and `last_refreshed_at`. Skills are synced on registration and on card refresh. Cascade-deletes when the parent agent is removed.

### `a2a_agent_access`

Stores per-persona access rules for A2A agent skills. Columns include `agent_id` (FK to a2a_agents), `persona_id`, `access_level` (all_skills or selected_skills), and `allowed_skill_ids` (JSON list). Defaults to deny (no access) until explicitly granted. Cascade-deletes when the parent agent is removed.

### `memories`

Stores AgentCore Memory resource metadata. Columns include `name`, `arn`, `memory_id`, `region`, `account_id`, `status` (CREATING/ACTIVE/FAILED/DELETING), `event_expiry_duration`, `memory_execution_role_arn`, `encryption_key_arn`, `strategies_config` (JSON), `strategies_response` (JSON), `tags` (JSON dict of resolved tags), and `failure_reason`.

### `invocation_sessions`

Groups related invocations. Uses `session_id` (UUID string) as the primary key — this is the natural key passed to AWS as `runtimeSessionId`.

### `invocations`

Stores per-invocation timing measurements, token usage, cost breakdowns, and status. Fields include `client_invoke_time`, `client_done_time`, `agent_start_time`, `cold_start_latency_ms`, `client_duration_ms`, `input_tokens`, `output_tokens`, `estimated_cost`, `compute_cpu_cost`, `compute_memory_cost`, `idle_cpu_cost`, `idle_memory_cost`, `stm_cost`, `ltm_cost`, `cost_source`, and `status`. Runtime costs are recomputed from `client_duration_ms` at view time using current pricing defaults. Token counts use a 4-character-per-token heuristic; model cost is computed from per-model pricing data.

### `site_settings`

Stores configurable site-wide settings. Currently includes `cpu_io_wait_discount` (default 75%) which is applied universally to runtime CPU cost calculations.

## API Endpoints

### Agent Registration and Deployment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents` | Register an agent by ARN or deploy a new agent |
| `GET` | `/api/agents` | List all registered agents (includes `model_id` and `active_session_count`) |
| `GET` | `/api/agents/{agent_id}` | Get agent metadata |
| `GET` | `/api/agents/{agent_id}/status` | Poll AWS for runtime/endpoint status during deployment |
| `DELETE` | `/api/agents/{agent_id}?cleanup_aws=true` | Remove agent; optionally initiate async AWS deletion (returns DELETING status) |
| `DELETE` | `/api/agents/{agent_id}/purge` | Remove agent from local DB only (after AWS deletion confirmed) |
| `POST` | `/api/agents/{agent_id}/refresh` | Re-fetch metadata from AWS |
| `POST` | `/api/agents/{agent_id}/redeploy` | Redeploy with current config |
| `GET` | `/api/agents/roles` | List IAM roles for AgentCore |
| `GET` | `/api/agents/cognito-pools` | List Cognito user pools |
| `GET` | `/api/agents/models` | List supported models (with display name and group) |
| `GET` | `/api/agents/models/pricing` | List models with pricing metadata |
| `GET` | `/api/agents/defaults` | Get configurable defaults (idle timeout, max lifetime) |

### Security Administration

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/security/roles` | Create a managed role |
| `GET` | `/api/security/roles` | List managed roles |
| `GET` | `/api/security/roles/{role_id}` | Get a managed role |
| `PUT` | `/api/security/roles/{role_id}` | Update a managed role |
| `DELETE` | `/api/security/roles/{role_id}` | Delete a managed role |
| `GET` | `/api/security/cognito-pools` | List Cognito pools with discovery URLs |
| `POST` | `/api/security/authorizers` | Create an authorizer config |
| `GET` | `/api/security/authorizers` | List authorizer configs |
| `DELETE` | `/api/security/authorizers/{auth_id}` | Delete an authorizer config |
| `POST` | `/api/security/authorizers/{auth_id}/credentials` | Add a credential |
| `GET` | `/api/security/authorizers/{auth_id}/credentials` | List credentials |
| `DELETE` | `/api/security/authorizers/{auth_id}/credentials/{cred_id}` | Delete a credential |
| `POST` | `/api/security/authorizers/{auth_id}/credentials/{cred_id}/token` | Generate OAuth token |
| `POST` | `/api/security/permission-requests` | Create a permission request |
| `GET` | `/api/security/permission-requests` | List permission requests |
| `PUT` | `/api/security/permission-requests/{req_id}/review` | Review a permission request |

### Tag Policy Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings/tags` | List all tag policies |
| `POST` | `/api/settings/tags` | Create a tag policy (409 if key exists) |
| `PUT` | `/api/settings/tags/{tag_id}` | Update a tag policy |
| `DELETE` | `/api/settings/tags/{tag_id}` | Delete a tag policy |

### Tag Profile Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings/tag-profiles` | List all tag profiles |
| `POST` | `/api/settings/tag-profiles` | Create a tag profile |
| `PUT` | `/api/settings/tag-profiles/{profile_id}` | Update a tag profile |
| `DELETE` | `/api/settings/tag-profiles/{profile_id}` | Delete a tag profile |

### Cost Dashboard

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard/costs` | Aggregate estimated costs (group filter, time-range filter, per-agent breakdown) |
| `POST` | `/api/dashboard/costs/actuals` | Pull actual runtime costs from CloudWatch usage logs (per-session breakdown) |

Runtime costs are recomputed from `client_duration_ms` at view time using current pricing defaults (1 vCPU, 0.5 GB memory, $0.0895/vCPU-hour, $0.00945/GB-hour). The CPU I/O Wait Discount (configurable in Settings, default 75%) is applied universally to CPU costs across both estimates and actuals. Actuals are filtered to only include sessions tracked in Loom.

### Site Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings/site` | List all site settings (includes defaults for unset keys) |
| `PUT` | `/api/settings/site/{key}` | Create or update a site setting |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/config` | Return Cognito config (pool ID, region) for frontend |

### Memory Resources

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/memories` | Create a memory resource |
| `POST` | `/api/memories/import` | Import an existing memory by AWS memory ID |
| `GET` | `/api/memories` | List all memory resources |
| `GET` | `/api/memories/{memory_id}` | Get a specific memory resource |
| `POST` | `/api/memories/{memory_id}/refresh` | Refresh memory status from AWS |
| `DELETE` | `/api/memories/{memory_id}?cleanup_aws=true` | Delete a memory resource; optionally delete from AWS |
| `DELETE` | `/api/memories/{memory_id}/purge` | Remove from local DB only (no AWS call) |

Supports five memory strategy types: semantic, summary, user_preference, episodic, and custom. Strategies are mapped to AWS tagged union format on creation. The delete endpoint supports async deletion: when `cleanup_aws=true`, it initiates deletion in AWS and marks the resource as DELETING. The frontend polls via refresh and uses purge to clean up locally after AWS confirms deletion (404).

### MCP Server Management

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/mcp/servers` | Register an MCP server |
| `GET` | `/api/mcp/servers` | List all MCP servers |
| `GET` | `/api/mcp/servers/{server_id}` | Get a specific MCP server |
| `PUT` | `/api/mcp/servers/{server_id}` | Update an MCP server |
| `DELETE` | `/api/mcp/servers/{server_id}` | Delete an MCP server (cascades to tools and access) |
| `POST` | `/api/mcp/servers/{server_id}/test-connection` | Test connectivity to an MCP server |
| `GET` | `/api/mcp/servers/{server_id}/tools` | List discovered tools for a server |
| `POST` | `/api/mcp/servers/{server_id}/tools/refresh` | Refresh tools via discovery |
| `GET` | `/api/mcp/servers/{server_id}/access` | Get access rules for a server |
| `PUT` | `/api/mcp/servers/{server_id}/access` | Update access rules for a server |

OAuth2 authentication supports well-known URL discovery for auto-populating token URLs and scopes. The `oauth2_client_secret` field is write-only — never included in GET responses; a `has_oauth2_secret` boolean is returned instead. Conditional validation ensures all required OAuth2 fields are present when `auth_type` is `oauth2`. Scope enforcement: `mcp:read` for GET, `mcp:write` for POST/PUT/DELETE.

### A2A Agent Management

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/a2a/agents` | Register an A2A agent (fetches Agent Card from base URL) |
| `GET` | `/api/a2a/agents` | List all A2A agents |
| `GET` | `/api/a2a/agents/{agent_id}` | Get a specific A2A agent |
| `PUT` | `/api/a2a/agents/{agent_id}` | Update an A2A agent |
| `DELETE` | `/api/a2a/agents/{agent_id}` | Delete an A2A agent (cascades to skills and access) |
| `POST` | `/api/a2a/agents/{agent_id}/test-connection` | Test connectivity (OAuth2 token + Agent Card fetch) |
| `GET` | `/api/a2a/agents/{agent_id}/card` | Get cached raw Agent Card JSON |
| `POST` | `/api/a2a/agents/{agent_id}/card/refresh` | Re-fetch Agent Card and sync skills |
| `GET` | `/api/a2a/agents/{agent_id}/skills` | List cached skills for an agent |
| `GET` | `/api/a2a/agents/{agent_id}/access` | Get access rules for an agent |
| `PUT` | `/api/a2a/agents/{agent_id}/access` | Update access rules for an agent |

A2A agents are registered by base URL. On registration, the backend fetches `<base_url>/.well-known/agent.json` and populates all agent metadata from the Agent Card. Skills are parsed and stored in a separate table for queryability and fine-grained access control. OAuth2 authentication follows the same pattern as MCP servers — `oauth2_client_secret` is write-only with `has_oauth2_secret` flag. Scope enforcement: `a2a:read` for GET, `a2a:write` for POST/PUT/DELETE.

### Agent Invocation (SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/{agent_id}/invoke` | Invoke agent, stream response via SSE |
| `GET` | `/api/agents/{agent_id}/sessions` | List sessions with invocations |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}` | Get a specific session |

The invoke endpoint uses a priority-based token selection: (0) `bearer_token` from request body, (1) `credential_id` for M2M token, (2) user access token (forwarded when agent has authorizer), (3) agent config M2M flow, (4) SigV4. The `session_start` SSE event includes `has_token` and `token_source` fields when a token is used.

Agent list responses include a computed `active_session_count` field based on `LOOM_SESSION_IDLE_TIMEOUT_SECONDS`, and an `authorizer_config` field extracted from the AgentCore runtime's `customJWTAuthorizer` configuration. Session responses include computed `live_status` (`"pending"`, `"streaming"`, `"active"`, or `"expired"`).

### CloudWatch Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/{agent_id}/logs/streams` | List available log streams |
| `GET` | `/api/agents/{agent_id}/logs` | Get logs from latest (or specified) stream with pagination |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/logs` | Get all logs for a session (stream-name matching + filterPattern fallback, paginated) |

## Streaming Architecture

The boto3 `invoke_agent_runtime` call returns a synchronous `StreamingBody`. To prevent blocking the uvicorn async event loop:

1. Each `next()` call on the chunk generator runs via `asyncio.to_thread()`.
2. SSE events are flushed to the client in real-time as chunks arrive.
3. After streaming completes, CloudWatch log retrieval also runs via `asyncio.to_thread()`. Log retrieval now paginates via nextToken.

## Latency Measurement

Cold-start latency is computed automatically during the invoke flow:

1. `client_invoke_time` is recorded before the AWS API call.
2. After streaming completes, `client_done_time` is recorded and `client_duration_ms` is computed.
3. CloudWatch logs are queried for the "Agent invoked - Start time:" pattern.
4. `agent_start_time` is parsed and `cold_start_latency_ms` is computed. Falls back to the earliest CloudWatch event timestamp when the pattern is not found.
5. All metrics are persisted to SQLite and included in the `session_end` SSE event.

## Agent Deployment

Deploy creates a Strands Agent runtime on AgentCore with background deployment and progressive status updates. The deployment flow includes:

1. **OAuth2 credential provider creation** — MCP server and A2A agent integrations with OAuth2 are provisioned as AgentCore credential providers with exponential backoff retry (4 retries, delays 2s/4s/8s/16s). Deployment fails with `credential_creation_failed` status if all retries are exhausted.
2. **IAM role creation** — Execution role provisioning (if creating new role)
3. **Artifact build** — Cross-compiles ARM64 artifact (pip install into target directory, zips, uploads to S3)
4. **Runtime deployment** — Creates AgentCore runtime and endpoint

The `deployment_status` field tracks progression through phases: `creating_credentials`, `creating_iam_role`, `building_artifact`, `deploying_runtime`, `completing_deployment`, `finalizing_endpoint`, `deployed`, `failed`, `deleting`.

Smart status polling: during local build phases (credential provider, IAM role, artifact build), the frontend polls the local database only. Once the runtime deployment begins, the `/api/agents/{agent_id}/status` endpoint queries AWS for runtime and endpoint status.

Model and IAM role are required fields. The deployment supports configurable protocol (HTTP), network mode (PUBLIC), authorizer, and lifecycle settings. Cognito client secrets are stored in Secrets Manager and never persisted in the local database. The deployment automatically sets `OTEL_SERVICE_NAME` to the agent name for AgentCore Observability integration.

Tags are resolved from the tag policy system at deploy time. Deploy-time tags are auto-applied from their default values; build-time tags are resolved from the selected tag profile. Required tags that are missing cause deployment to fail with a 400 error. Resolved tags are applied to all created AWS resources (AgentCore runtimes, endpoints, IAM execution roles, memory resources) and stored locally on Agent and Memory records. For registered agents and imported memories, tags are fetched from AWS via `list_tags_for_resource`; missing required tags are filled with `"missing"`.

Deletion with `cleanup_aws=true` initiates background async AWS deletion (endpoint + runtime + MCP and A2A credential providers + Secrets Manager cleanup), explicitly deletes sessions/invocations,, marks the agent as DELETING, and returns the updated agent. The frontend polls the status endpoint until AWS confirms deletion (404), then calls the purge endpoint to remove the local record. Credential providers cascade delete when the agent is deleted.

## Authenticated Invocation

Invocations support multiple token sources with priority ordering:

1. **Manual bearer token**: If the invoke request includes a `bearer_token` field, it is used directly.
2. **Credential-based token**: If the invoke request includes a `credential_id`, the backend resolves the credential, fetches the client secret from Secrets Manager (5-minute cache), and exchanges it for an M2M OAuth token.
3. **User login token**: If the agent has an authorizer configured, the user's access token from the `Authorization` header is forwarded directly to AgentCore. This works because the frontend and agent share the same Cognito user pool.
4. **Agent config token**: Falls back to the agent's stored authorizer config for M2M token retrieval.
5. **SigV4 (no token)**: If no token is resolved, the request uses IAM SigV4 authentication.

Group-based invoke restriction: `super-admins` can invoke any agent. `demo-admins` and `users` can only invoke agents within their `loom:group` tag. The backend automatically includes `LOOM_COGNITO_USER_CLIENT_ID` in agent authorizer `allowedClients` on deploy so user tokens are accepted.

## Makefile Targets

```bash
# Development
make install              # Install dependencies
make test                 # Run test suite
make run                  # Start dev server

# Manual testing (requires etc/environment.sh)
make curl.health
make curl.agents.register ARN=arn:aws:bedrock-agentcore:REGION:ACCOUNT:runtime/ID
make curl.agents.list
make curl.agents.get AGENT_ID=1
make curl.agents.refresh AGENT_ID=1
make curl.agents.delete AGENT_ID=1
make curl.invoke AGENT_ID=1 PROMPT="Hello" QUALIFIER=DEFAULT
make curl.sessions.list AGENT_ID=1
make curl.sessions.get AGENT_ID=1 SESSION_ID=uuid
make curl.logs AGENT_ID=1 QUALIFIER=DEFAULT LIMIT=20
make curl.logs.streams AGENT_ID=1
make curl.logs.session AGENT_ID=1 SESSION_ID=uuid

# Memory resources
make curl.memories.create MEMORY_NAME=loom_memory MEMORY_EVENT_EXPIRY_DURATION=30
make curl.memories.import MEMORY_AWS_ID=my_memory-zYcvlyGXsK
make curl.memories.list
make curl.memories.get MEMORY_ID=1
make curl.memories.refresh MEMORY_ID=1
make curl.memories.delete MEMORY_ID=1
make curl.memories.purge MEMORY_ID=1
```

## Tests

Unit tests covering all routers, services, and models:

```bash
make test
```

Tests use in-memory SQLite and mock all AWS API calls via `unittest.mock.patch`.
