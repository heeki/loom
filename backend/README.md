# Loom Backend

FastAPI backend for the Loom Agent Builder Playground. Provides endpoints for agent registration, deployment, SSE streaming invocation, CloudWatch log retrieval, cold-start latency measurement, and session liveness tracking.

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
| `SESSION_IDLE_TIMEOUT_MINUTES` | Session idle timeout for liveness detection | `15` |
| `AWS_REGION` | AWS region for deployments | `us-east-1` |
| `LOOM_ARTIFACT_BUCKET` | S3 bucket for agent deployment artifacts | — |

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
│   │   └── invocation.py    # Invocation ORM model (timing + latency data)
│   ├── routers/
│   │   ├── agents.py        # Agent CRUD + ARN parsing + log group derivation
│   │   ├── invocations.py   # SSE streaming invoke + session/invocation queries
│   │   └── logs.py          # CloudWatch log browsing + session log retrieval
│   └── services/
│       ├── agentcore.py     # boto3 wrapper: describe, list endpoints, invoke
│       ├── cloudwatch.py    # boto3 wrapper: log streams, log events, start time parsing
│       ├── cognito.py       # Cognito OAuth2 token retrieval
│       ├── credential.py    # AgentCore credential provider management
│       ├── deployment.py    # Agent artifact build + runtime CRUD
│       ├── iam.py           # IAM role management + Cognito pool listing
│       ├── latency.py       # Pure computation: cold_start_latency_ms, client_duration_ms
│       └── secrets.py       # Secrets Manager wrapper with caching
├── scripts/
│   └── stream.py            # CLI streaming client (httpx-based)
├── tests/                   # Unit tests (63 tests)
├── makefile                 # Build, test, and manual testing targets
├── pyproject.toml
└── requirements.txt
```

## Database Schema

### `agents`

Stores registered and deployed AgentCore Runtime agents. Uses an auto-incrementing integer PK for internal references; `arn` and `runtime_id` are stored as indexed columns for AWS lookups. Includes columns for: `source`, `deployment_status`, `execution_role_arn`, `endpoint_name`, `endpoint_arn`, `endpoint_status`, `protocol`, `network_mode`, `authorizer_config`, and `deployed_at`.

### `agent_config_entries`

Stores key-value configuration per agent. Used for environment variables and secret ARN references injected at deploy time.

### `invocation_sessions`

Groups related invocations. Uses `session_id` (UUID string) as the primary key — this is the natural key passed to AWS as `runtimeSessionId`.

### `invocations`

Stores per-invocation timing measurements and status. Each invocation belongs to a session. Fields include `client_invoke_time`, `client_done_time`, `agent_start_time`, `cold_start_latency_ms`, `client_duration_ms`, and `status`.

Prompt text, thinking text, and response text are stored per invocation (`prompt_text`, `thinking_text`, `response_text`).

## API Endpoints

### Agent Registration

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents` | Register an agent by ARN |
| `GET` | `/api/agents` | List all registered agents |
| `GET` | `/api/agents/{agent_id}` | Get agent metadata |
| `DELETE` | `/api/agents/{agent_id}` | Remove an agent |
| `POST` | `/api/agents/{agent_id}/refresh` | Re-fetch metadata from AWS |

### Agent Deployment

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents` | Create agent (register or deploy) |
| `DELETE` | `/api/agents/{agent_id}?cleanup_aws=true` | Remove agent; optionally clean up AWS |
| `POST` | `/api/agents/{agent_id}/redeploy` | Redeploy with current config |
| `GET` | `/api/agents/roles` | List IAM roles for AgentCore |
| `GET` | `/api/agents/cognito-pools` | List Cognito user pools |
| `GET` | `/api/agents/models` | List supported models |
| `POST` | `/api/agents/{agent_id}/token` | Get Cognito access token |

### Agent Invocation (SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/{agent_id}/invoke` | Invoke agent, stream response via SSE |
| `GET` | `/api/agents/{agent_id}/sessions` | List sessions with invocations |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}` | Get a specific session |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/invocations/{invocation_id}` | Get a specific invocation |

The invoke endpoint returns `text/event-stream` with events: `session_start`, `chunk`, `session_end`, `error`. Cold-start latency is computed automatically after the stream completes and included in the `session_end` event.

Agent list responses include a computed `active_session_count` field — the number of sessions likely still warm in AWS. Session list responses include a computed `live_status` field (`"pending"`, `"streaming"`, `"active"`, or `"expired"`) based on a local idle timeout heuristic (`SESSION_IDLE_TIMEOUT_MINUTES`). No AWS API calls are made for session liveness — the Bedrock AgentCore SDK does not expose session querying APIs.

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
3. After streaming completes, CloudWatch log retrieval also runs via `asyncio.to_thread()` (retries up to 6 times at 5-second intervals).

## Latency Measurement

Cold-start latency is computed automatically during the invoke flow:

1. `client_invoke_time` is recorded before the AWS API call.
2. After streaming completes, `client_done_time` is recorded and `client_duration_ms` is computed.
3. CloudWatch logs are queried for the "Agent invoked - Start time:" pattern.
4. `agent_start_time` is parsed from the log and `cold_start_latency_ms` is computed. If the "Start time:" pattern is not found (agents with non-standard log formats), the earliest CloudWatch event timestamp is used as a fallback.
5. All metrics are persisted to SQLite and included in the `session_end` SSE event.

If CloudWatch logs are unavailable, the invocation succeeds without latency data.

## Agent Deployment

Deploy creates a Strands Agent runtime on AgentCore. The build step cross-compiles an ARM64 artifact (pip install into a target directory, zips the result, and uploads to S3). The deployment supports configurable model, protocol (HTTP/WSS), network mode (PUBLIC/VPC), authorizer, and lifecycle settings. Cognito client secrets are stored in Secrets Manager and never persisted in the local database. Deletion optionally cleans up the AgentCore runtime and associated Secrets Manager entries.

## Authenticated Invocation

Agents configured with a Cognito authorizer auto-fetch an access token at invoke time. The token is retrieved via the OAuth2 client credentials grant; the client secret is fetched from Secrets Manager with a 5-minute in-memory cache. The Bearer token is sent alongside an UNSIGNED SigV4 request (OAuth mode).

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
```

## Tests

81 unit tests covering all routers, services, and models:

```bash
make test
```

Tests use in-memory SQLite and mock all AWS API calls via `unittest.mock.patch`.
