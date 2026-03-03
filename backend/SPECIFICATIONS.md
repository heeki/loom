# Loom Backend — Specifications

## 1. Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | FastAPI |
| Server | Uvicorn (local dev) |
| ORM | SQLAlchemy (with SQLite) |
| AWS SDK | boto3 |
| Python version | 3.11+ |
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
│   │   ├── session.py       # InvocationSession ORM model
│   │   └── invocation.py    # Invocation ORM model
│   ├── routers/
│   │   ├── agents.py        # Agent CRUD + ARN parsing + log group derivation
│   │   ├── invocations.py   # SSE streaming invoke + session/invocation queries
│   │   └── logs.py          # CloudWatch log browsing + session log retrieval
│   └── services/
│       ├── agentcore.py     # Bedrock AgentCore API wrapper
│       ├── cloudwatch.py    # CloudWatch log retrieval and parsing
│       └── latency.py       # Latency calculation helpers
├── scripts/
│   └── stream.py            # SSE streaming client for CLI invocations (httpx)
├── tests/
│   ├── test_agentcore.py    # AgentCore service tests
│   ├── test_agents.py       # Agent router tests
│   ├── test_cloudwatch.py   # CloudWatch service tests
│   ├── test_invocations.py  # Invocation router tests
│   ├── test_latency.py      # Latency computation tests
│   └── test_logs.py         # Logs router tests
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
| `registered_at` | DATETIME | Timestamp of local registration |
| `last_refreshed_at` | DATETIME | Last time metadata was fetched from AWS |

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

**Design decisions:**
- Prompt and response text are not stored. The focus is on timing/latency measurement, not conversation history.
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

### Agent Registration

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents` | Register an agent by ARN. Calls AgentCore describe API, stores metadata in SQLite. |
| `GET` | `/api/agents` | List all registered agents. |
| `GET` | `/api/agents/{agent_id}` | Get metadata for a specific registered agent. |
| `DELETE` | `/api/agents/{agent_id}` | Remove an agent from the local registry. |
| `POST` | `/api/agents/{agent_id}/refresh` | Re-fetch metadata from AgentCore and update the local record. |

**`POST /api/agents` request body:**
```json
{ "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/myagent-abc123" }
```

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
    "registered_at": "2026-02-18T10:00:00Z"
  }
]
```

### Agent Invocation (SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/{agent_id}/invoke` | Invoke the agent and stream the response via SSE. |
| `GET` | `/api/agents/{agent_id}/sessions` | List all invocation sessions with their invocations. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}` | Get a specific session with its invocations. |
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
- `invoke_agent(arn: str, qualifier: str, session_id: str, prompt: str, region: str) -> Generator` — calls `invoke_agent_runtime`, yields decoded text chunks from the SSE-formatted streaming response.

### `services/cloudwatch.py`

Wraps `boto3.client('logs')`:

- `list_log_streams(log_group: str, region: str) -> list[dict]` — lists streams ordered by last event time, filters out AWS validation streams.
- `get_stream_log_events(log_group: str, stream_name: str, region: str, ...) -> list[dict]` — retrieves events from a single log stream without retry logic; suitable for general log browsing.
- `get_log_events(log_group: str, session_id: str, region: str, start_time_ms: int | None, limit: int, max_retries: int, retry_interval: float) -> list[dict]` — retrieves events matching the session_id filter pattern across all streams, with configurable retry logic for CloudWatch ingestion delays.
- `parse_agent_start_time(log_events: list[dict]) -> float | None` — searches events for the "Agent invoked - Start time:" pattern and returns the parsed Unix timestamp.

### `services/latency.py`

Pure computation helpers (no AWS dependencies):

- `compute_cold_start(client_invoke_time: float, agent_start_time: float) -> float` — returns millisecond delta.
- `compute_client_duration(client_invoke_time: float, client_done_time: float) -> float` — returns millisecond delta.

---

## 8. Latency Measurement Flow

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
- `agent_start_time` is the Unix timestamp parsed from the CloudWatch log message pattern:
  `Agent invoked - Start time: {ISO_TIMESTAMP}, ...`
- CloudWatch log retrieval is done with `session_id` as the filter pattern.
- During invoke, the system retries CloudWatch polling up to 6 times (5-second intervals, 30-second max) waiting for logs to appear.
- If CloudWatch retrieval fails or no logs are found, the invocation completes successfully without latency data — `cold_start_latency_ms` and `agent_start_time` will be absent from the `session_end` event.

---

## 9. Makefile Targets

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
