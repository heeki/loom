# Loom Backend

FastAPI backend for the Loom Agent Builder Playground. Provides endpoints for agent registration, deployment, SSE streaming invocation, CloudWatch log retrieval, cold-start latency measurement, session liveness tracking, memory resource management, and security administration.

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

AWS credentials use the standard boto3 credential chain (environment variables, AWS profile, instance metadata).

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
│   │   └── memory.py        # Memory ORM model (AgentCore Memory resources)
│   ├── routers/
│   │   ├── agents.py        # Agent CRUD + ARN parsing + log group derivation
│   │   ├── invocations.py   # SSE streaming invoke + session/invocation queries
│   │   ├── logs.py          # CloudWatch log browsing + session log retrieval
│   │   ├── memories.py      # Memory resource CRUD + strategy mapping
│   │   ├── security.py      # Security admin: roles, authorizers, credentials, permissions
│   │   └── utils.py         # Shared router utilities
│   └── services/
│       ├── agentcore.py     # boto3 wrapper: describe, list endpoints, invoke
│       ├── cloudwatch.py    # boto3 wrapper: log streams, log events, start time parsing
│       ├── cognito.py       # Cognito OAuth2 token retrieval
│       ├── credential.py    # AgentCore credential provider management
│       ├── deployment.py    # Agent artifact build + runtime CRUD
│       ├── iam.py           # IAM role management + Cognito pool listing
│       ├── latency.py       # Pure computation: cold_start_latency_ms, client_duration_ms
│       ├── memory.py        # boto3 wrapper: AgentCore Memory CRUD
│       └── secrets.py       # Secrets Manager wrapper with caching
├── scripts/
│   └── stream.py            # CLI streaming client (httpx-based)
├── tests/                   # Unit tests
├── makefile                 # Build, test, and manual testing targets
├── pyproject.toml
└── requirements.txt
```

## Database Schema

### `agents`

Stores registered and deployed AgentCore Runtime agents. Uses an auto-incrementing integer PK for internal references; `arn` and `runtime_id` are stored as indexed columns for AWS lookups. Includes columns for: `source`, `deployment_status`, `execution_role_arn`, `endpoint_name`, `endpoint_arn`, `endpoint_status`, `protocol`, `network_mode`, `authorizer_config`, and `deployed_at`.

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

### `memories`

Stores AgentCore Memory resource metadata. Columns include `name`, `arn`, `memory_id`, `region`, `account_id`, `status` (CREATING/ACTIVE/FAILED/DELETING), `event_expiry_duration`, `memory_execution_role_arn`, `encryption_key_arn`, `strategies_config` (JSON), `strategies_response` (JSON), and `failure_reason`.

### `invocation_sessions`

Groups related invocations. Uses `session_id` (UUID string) as the primary key — this is the natural key passed to AWS as `runtimeSessionId`.

### `invocations`

Stores per-invocation timing measurements and status. Fields include `client_invoke_time`, `client_done_time`, `agent_start_time`, `cold_start_latency_ms`, `client_duration_ms`, and `status`. Prompt text, thinking text, and response text are stored per invocation.

## API Endpoints

### Agent Registration and Deployment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents` | Register an agent by ARN or deploy a new agent |
| `GET` | `/api/agents` | List all registered agents (includes `model_id` and `active_session_count`) |
| `GET` | `/api/agents/{agent_id}` | Get agent metadata |
| `DELETE` | `/api/agents/{agent_id}?cleanup_aws=true` | Remove agent; optionally clean up AWS resources |
| `POST` | `/api/agents/{agent_id}/refresh` | Re-fetch metadata from AWS |
| `POST` | `/api/agents/{agent_id}/redeploy` | Redeploy with current config |
| `GET` | `/api/agents/roles` | List IAM roles for AgentCore |
| `GET` | `/api/agents/cognito-pools` | List Cognito user pools |
| `GET` | `/api/agents/models` | List supported models (with display name and group) |
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

### Agent Invocation (SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/{agent_id}/invoke` | Invoke agent, stream response via SSE |
| `GET` | `/api/agents/{agent_id}/sessions` | List sessions with invocations |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}` | Get a specific session |

The invoke endpoint accepts an optional `credential_id` to authenticate via an authorizer credential. The `session_start` SSE event includes `has_token` and `token_source` fields when a token is used.

Agent list responses include a computed `active_session_count` field based on `LOOM_SESSION_IDLE_TIMEOUT_SECONDS`. Session responses include computed `live_status` (`"pending"`, `"streaming"`, `"active"`, or `"expired"`).

### CloudWatch Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/{agent_id}/logs/streams` | List available log streams |
| `GET` | `/api/agents/{agent_id}/logs` | Get logs from latest (or specified) stream |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/logs` | Get logs filtered to a session |

## Streaming Architecture

The boto3 `invoke_agent_runtime` call returns a synchronous `StreamingBody`. To prevent blocking the uvicorn async event loop:

1. Each `next()` call on the chunk generator runs via `asyncio.to_thread()`.
2. SSE events are flushed to the client in real-time as chunks arrive.
3. After streaming completes, CloudWatch log retrieval also runs via `asyncio.to_thread()`.

## Latency Measurement

Cold-start latency is computed automatically during the invoke flow:

1. `client_invoke_time` is recorded before the AWS API call.
2. After streaming completes, `client_done_time` is recorded and `client_duration_ms` is computed.
3. CloudWatch logs are queried for the "Agent invoked - Start time:" pattern.
4. `agent_start_time` is parsed and `cold_start_latency_ms` is computed. Falls back to the earliest CloudWatch event timestamp when the pattern is not found.
5. All metrics are persisted to SQLite and included in the `session_end` SSE event.

## Agent Deployment

Deploy creates a Strands Agent runtime on AgentCore. The build step cross-compiles an ARM64 artifact (pip install into a target directory, zips the result, and uploads to S3). Model and IAM role are required fields. The deployment supports configurable protocol (HTTP), network mode (PUBLIC), authorizer, and lifecycle settings. Cognito client secrets are stored in Secrets Manager and never persisted in the local database. Deletion optionally cleans up the AgentCore runtime and associated Secrets Manager entries. The deployment automatically sets `OTEL_SERVICE_NAME` to the agent name for AgentCore Observability integration.

## Authenticated Invocation

Invocations can be authenticated using credentials from authorizer configs. The invoke request accepts an optional `credential_id`. The backend resolves the credential, fetches the client secret from Secrets Manager (5-minute cache), exchanges credentials for an OAuth token via Cognito client credentials grant, and sends the Bearer token with the runtime invocation.

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
