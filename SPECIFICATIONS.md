# Loom: Agent Builder Playground — Specifications

## 1. Overview

Loom is an agent builder playground that simplifies the lifecycle of building, testing, integrating, deploying, and operating AI agents built on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. The platform consists of:

- A **FastAPI backend** that encapsulates all AWS interactions and business logic.
- A **React/TypeScript frontend** (Vite, shadcn, Tailwind CSS) that interacts exclusively through the backend API.
- A **local SQLite database** (via SQLAlchemy) for persisting agent metadata and session history.

### Initial MVP Scope

The initial implementation focuses on the **latency measurement test use case** for agents that are already deployed to AgentCore Runtime. Future phases will add agent creation/containerization/deployment workflows.

---

## 2. Directory Structure

```
loom/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI application entry point
│   │   ├── db.py                # SQLAlchemy engine and session setup
│   │   ├── models/
│   │   │   ├── agent.py         # Agent ORM model
│   │   │   └── session.py       # InvocationSession ORM model
│   │   ├── routers/
│   │   │   ├── agents.py        # /api/agents endpoints
│   │   │   ├── invocations.py   # /api/agents/{id}/invoke endpoints
│   │   │   ├── logs.py          # /api/agents/{id}/logs endpoints
│   │   │   └── latency.py       # /api/agents/{id}/sessions/{sid}/latency
│   │   └── services/
│   │       ├── agentcore.py     # Bedrock AgentCore API wrapper
│   │       ├── cloudwatch.py    # CloudWatch log retrieval and parsing
│   │       └── latency.py       # Latency calculation logic
│   ├── tests/
│   │   ├── test_agentcore.py
│   │   ├── test_cloudwatch.py
│   │   └── test_latency.py
│   ├── pyproject.toml
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.ts        # Typed API client (fetch wrappers)
│   │   ├── components/
│   │   │   ├── ui/              # shadcn primitives
│   │   │   ├── AgentCard.tsx
│   │   │   ├── InvokePanel.tsx
│   │   │   ├── LatencyChart.tsx
│   │   │   ├── LogViewer.tsx
│   │   │   └── MetricsDashboard.tsx
│   │   ├── pages/
│   │   │   ├── BuildPage.tsx
│   │   │   ├── TestPage.tsx
│   │   │   └── OperatePage.tsx
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── etc/
│   └── environment.sh           # Source-of-truth for injectable parameters
├── tmp/
│   └── latency/                 # Reference implementation (read-only)
├── makefile
├── CLAUDE.md
├── README.md
└── SPECIFICATIONS.md
```

---

## 3. Backend Specification

### 3.1 Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | FastAPI |
| Server | Uvicorn (local dev) |
| ORM | SQLAlchemy (with SQLite) |
| AWS SDK | boto3 |
| Python version | 3.11+ |
| Dependency manager | uv |
| Streaming | SSE (via `fastapi-sse` or manual `StreamingResponse`) |

### 3.2 Configuration

All runtime configuration is injected via environment variables sourced from `etc/environment.sh`:

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for all API calls | (required) |
| `AWS_PROFILE` | AWS CLI profile (optional) | AWS default chain |
| `DATABASE_URL` | SQLite file path | `sqlite:///./loom.db` |
| `BACKEND_PORT` | Port for uvicorn | `8000` |
| `FRONTEND_PORT` | Port for Vite dev server | `5173` |
| `LOG_LEVEL` | Backend log level | `info` |

### 3.3 Database Schema

#### `agents` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `arn` | TEXT UNIQUE NOT NULL | AgentCore Runtime ARN |
| `runtime_id` | TEXT NOT NULL | Extracted from ARN (e.g., `ea_banappeal-dE2x2P736K`) |
| `name` | TEXT | Human-readable name (from AgentCore describe response) |
| `status` | TEXT | Runtime status (e.g., `READY`, `CREATING`) |
| `region` | TEXT NOT NULL | Extracted from ARN |
| `account_id` | TEXT NOT NULL | Extracted from ARN |
| `log_group` | TEXT | Derived: `/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}` |
| `available_qualifiers` | TEXT | JSON array of endpoint names (e.g., `["DEFAULT"]`) |
| `raw_metadata` | TEXT | Full JSON from AgentCore describe API |
| `registered_at` | DATETIME | Timestamp of local registration |
| `last_refreshed_at` | DATETIME | Last time metadata was fetched from AWS |

#### `invocation_sessions` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Internal ID |
| `agent_id` | INTEGER FK → agents.id | Associated agent |
| `session_id` | TEXT NOT NULL | UUID used as `runtimeSessionId` in the invoke call |
| `qualifier` | TEXT NOT NULL | Endpoint qualifier used (e.g., `DEFAULT`) |
| `prompt` | TEXT | Input prompt sent to the agent |
| `response` | TEXT | Full agent response (accumulated from stream) |
| `client_invoke_time` | REAL | Unix timestamp (seconds) recorded immediately before boto3 call |
| `client_done_time` | REAL | Unix timestamp when stream completes |
| `agent_start_time` | REAL | Unix timestamp parsed from "Start time:" in CloudWatch logs |
| `cold_start_latency_ms` | REAL | `(agent_start_time - client_invoke_time) * 1000` |
| `client_duration_ms` | REAL | `(client_done_time - client_invoke_time) * 1000` |
| `status` | TEXT | `pending`, `streaming`, `complete`, `error` |
| `error_message` | TEXT | Error detail if status is `error` |
| `created_at` | DATETIME | Session creation timestamp |

### 3.4 ARN Parsing

Runtime ARN format: `arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}`

From the ARN, the backend automatically derives:
- `region` → extracted from ARN segment 3
- `account_id` → extracted from ARN segment 4
- `runtime_id` → extracted from ARN resource path

Log group format (per qualifier): `/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}`

Log stream name: `BedrockAgentCoreRuntime_ApplicationLogs`

### 3.5 API Endpoints

All endpoints are prefixed `/api`.

#### Agent Registration

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

#### Agent Invocation (SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/{agent_id}/invoke` | Invoke the agent and stream the response via SSE. |
| `GET` | `/api/agents/{agent_id}/sessions` | List all invocation sessions for an agent. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}` | Get a specific session (metadata + full response). |

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
data: {"session_id": "uuid-...", "client_invoke_time": 1708000000.123}

event: chunk
data: {"text": "Hello! I am "}

event: chunk
data: {"text": "your agent."}

event: session_end
data: {"session_id": "uuid-...", "client_done_time": 1708000002.456, "client_duration_ms": 2333}

event: error
data: {"message": "Invocation failed: ..."}
```

The backend stores the session record before streaming begins, updates it incrementally, and finalizes it when the stream completes.

#### Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/{agent_id}/logs` | Retrieve recent logs from CloudWatch for this agent. |
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/logs` | Retrieve logs filtered to a specific session. |

**Query parameters for log endpoints:**
- `qualifier` (string, default: `DEFAULT`) — which endpoint's log group to query
- `limit` (int, default: `100`) — max number of log events to return
- `start_time` (ISO 8601, optional) — filter events after this time
- `end_time` (ISO 8601, optional) — filter events before this time

**Log event response shape:**
```json
{
  "log_group": "/aws/bedrock-agentcore/runtimes/myagent-abc123-DEFAULT",
  "log_stream": "BedrockAgentCoreRuntime_ApplicationLogs",
  "events": [
    {
      "timestamp_ms": 1708000001000,
      "timestamp_iso": "2026-02-18T10:00:01.000Z",
      "message": "Agent invoked - Start time: 2026-02-18T10:00:01.123456, ...",
      "session_id": "uuid-..."
    }
  ]
}
```

#### Latency

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/{agent_id}/sessions/{session_id}/latency` | Retrieve (or compute on demand) the latency measurement for a session. |

**Response:**
```json
{
  "session_id": "uuid-...",
  "qualifier": "DEFAULT",
  "client_invoke_time_iso": "2026-02-18T10:00:00.000Z",
  "agent_start_time_iso": "2026-02-18T10:00:00.500Z",
  "cold_start_latency_ms": 500.0,
  "client_duration_ms": 2333.0,
  "status": "complete",
  "log_events_found": 12
}
```

The latency endpoint:
1. Looks up the session in SQLite.
2. If `agent_start_time` is already populated, returns the stored value.
3. Otherwise, polls CloudWatch logs filtered by `session_id`, parses the "Start time:" field from the "Agent invoked" log message, computes `cold_start_latency_ms`, and persists the result.

### 3.6 Service Modules

#### `services/agentcore.py`

Wraps `boto3.client('bedrock-agentcore')`:

- `describe_runtime(arn: str, region: str) -> dict` — calls `get_agent_runtime` and returns normalized metadata.
- `list_runtime_endpoints(runtime_id: str, region: str) -> list[str]` — returns available qualifier names; falls back to `["DEFAULT"]` on error.
- `invoke_agent(arn: str, qualifier: str, session_id: str, prompt: str, region: str) -> Generator` — calls `invoke_agent_runtime`, yields decoded chunks from the streaming response.

#### `services/cloudwatch.py`

Wraps `boto3.client('logs')`:

- `list_log_streams(log_group: str, region: str) -> list[dict]` — lists streams ordered by last event time, filters out validation streams.
- `get_log_events(log_group: str, session_id: str, region: str, start_time_ms: int | None, limit: int) -> list[dict]` — retrieves events matching the session_id filter pattern, handles pagination.
- `parse_agent_start_time(log_events: list[dict]) -> float | None` — searches events for the "Agent invoked - Start time:" pattern and returns the parsed Unix timestamp.

#### `services/latency.py`

Pure computation helpers:

- `compute_cold_start(client_invoke_time: float, agent_start_time: float) -> float` — returns millisecond delta.
- `compute_client_duration(client_invoke_time: float, client_done_time: float) -> float` — returns millisecond delta.

---

## 4. Frontend Specification

### 4.1 Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18 with TypeScript |
| Build tool | Vite |
| UI components | shadcn/ui |
| Styling | Tailwind CSS |
| HTTP client | Native `fetch` (typed wrappers in `src/api/client.ts`) |
| SSE streaming | `EventSource` API |
| Charts | Recharts (for latency visualization) |
| Module system | ESM |

### 4.2 Application Shell

The app has a top-level tab navigation with three tabs:

```
[ Build ]  [ Test ]  [ Operate ]
```

No authentication or authorization in the initial prototype.

### 4.3 Build Tab

**Purpose:** Register agents by ARN so the platform can track and test them.

**Initial MVP content:**
- A form with a single text input: `Agent Runtime ARN`.
- A "Register Agent" submit button.
- On submit:
  - `POST /api/agents` with the ARN.
  - On success: show a success toast and add the agent to the list below.
  - On error: show an error toast with the message from the backend.
- Below the form: a table/card list of all registered agents (`GET /api/agents`), showing:
  - Name / Runtime ID
  - Status badge (color-coded)
  - Region
  - Available qualifiers
  - Registered timestamp
  - A "Refresh" button (calls `POST /api/agents/{id}/refresh`)
  - A "Remove" button (calls `DELETE /api/agents/{id}`)

**Future Build capabilities (not in MVP):**
- Agent blueprint selection (Strands Agents templates)
- Container build and ECR push
- Deployment to AgentCore Runtime via agentcore-cli
- Data source integration configuration

### 4.4 Test Tab

**Purpose:** Invoke agents and measure latency; inspect sessions.

**Layout:**
- Left panel: Agent selector (dropdown of registered agents).
- Right panel: Invocation panel.

**Invocation panel:**
1. **Qualifier selector** — dropdown populated from the selected agent's `available_qualifiers`.
2. **Prompt input** — multi-line text area.
3. **Invoke button** — triggers invocation.
4. **Response area** — streams token chunks in real time via SSE as they arrive. Displays the session ID as a small badge once `session_start` is received.
5. **Latency panel** (appears after stream completes):
   - Client invoke time
   - Agent start time (from CloudWatch logs — may have a short delay)
   - Cold-start latency (ms)
   - Client-side duration (ms)
   - A "Fetch Latency" button that polls `GET /api/agents/{id}/sessions/{session_id}/latency` to trigger CloudWatch log retrieval.
6. **Recent Logs** — a log viewer showing the last N log events for the selected agent/qualifier (`GET /api/agents/{id}/logs`). Refreshes after each invocation.
7. **Session History** — a table of recent sessions for this agent (`GET /api/agents/{id}/sessions`), clickable to load session details.

**Streaming behavior:**
- The frontend opens an `EventSource` to `POST /api/agents/{id}/invoke` (note: since `EventSource` is GET-only, the backend exposes a two-step flow: `POST` to create the session and get a `session_id`, then `GET /api/agents/{id}/sessions/{session_id}/stream` for the SSE stream).
- Alternatively, the backend can accept a `POST` and return `text/event-stream` using a `StreamingResponse` (the fetch API with `ReadableStream` is used instead of `EventSource`).
- **Decision: Use `fetch` + `ReadableStream` on the frontend for POST-based SSE**, which avoids the `EventSource` GET-only limitation.

### 4.5 Operate Tab

**Purpose:** Aggregate operational view across all registered agents.

**Initial MVP content:**
- Summary cards at the top:
  - Total registered agents
  - Total invocations
  - Average cold-start latency across all sessions
  - Error rate
- Agent table with drill-down:
  - Clicking a row opens a detail panel showing:
    - Agent metadata
    - Session history table
    - Latency time-series chart (Recharts `LineChart`) for that agent
    - Recent CloudWatch logs viewer

**Future Operate capabilities (not in MVP):**
- Real-time auto-refresh of metrics
- Alert configuration
- Multi-region rollup

---

## 5. Latency Measurement Flow

The following describes the end-to-end latency measurement sequence for the MVP:

```
Frontend                Backend                 AWS
   │                       │                     │
   │── POST /invoke ──────►│                     │
   │                       │── record client_invoke_time
   │                       │── invoke_agent_runtime ───────────────►│
   │                       │◄── SSE stream chunks ──────────────────│
   │◄── SSE: session_start─│                     │
   │◄── SSE: chunk... ─────│                     │
   │◄── SSE: session_end ──│                     │
   │                       │── record client_done_time              │
   │                       │── persist session                      │
   │                       │                     │
   │── GET /latency ──────►│                     │
   │                       │── filter_log_events ──────────────────►│
   │                       │◄── log events ─────────────────────────│
   │                       │── parse "Start time:" field            │
   │                       │── compute cold_start_latency_ms        │
   │                       │── persist to SQLite                    │
   │◄── latency response ──│                     │
```

**Latency definition:**
- `cold_start_latency_ms = (agent_start_time - client_invoke_time) * 1000`
- `agent_start_time` is the Unix timestamp parsed from the log message pattern:
  `Agent invoked - Start time: {ISO_TIMESTAMP}, ...`
- CloudWatch log retrieval is done with `session_id` as the filter pattern.
- The system retries CloudWatch polling up to 12 times (5-second intervals, 60-second max) waiting for logs to appear.
- The retry logic is exposed as a background operation; the frontend polls `GET /latency` until the result is available.

---

## 6. Makefile Targets

The `makefile` will be extended with the following targets:

```makefile
backend-install    # uv pip install -r backend/requirements.txt
backend-run        # uvicorn backend.app.main:app --reload --port $BACKEND_PORT
backend-test       # python -m pytest backend/tests/

frontend-install   # npm install (in frontend/)
frontend-run       # npm run dev (in frontend/)
frontend-build     # npm run build (in frontend/)

dev                # Runs backend and frontend concurrently for local development
```

---

## 7. Security Considerations

- No credentials, tokens, or secrets are committed to git.
- `etc/environment.sh` and `.env` files are listed in `.gitignore`.
- The backend uses the standard boto3 credential chain (environment variables, AWS profile, instance metadata) — no hardcoded credentials.
- All AWS API calls follow least-privilege IAM: read-only access to `bedrock-agentcore:GetAgentRuntime`, `bedrock-agentcore:InvokeAgentRuntime`, `logs:DescribeLogStreams`, `logs:FilterLogEvents`.
- CORS is configured to allow `localhost:{FRONTEND_PORT}` only in development.

---

## 8. Implementation Phases

### Phase 1 — MVP (Initial Implementation)
- Backend: Agent registration, metadata retrieval, SSE invocation, CloudWatch log retrieval, latency calculation, SQLite persistence.
- Frontend: Build tab (ARN registration), Test tab (invocation + streaming + latency display), Operate tab (basic dashboard).
- Refactor `tmp/latency/` into reusable service modules.

### Phase 2 — Build Workflows
- Agent blueprint selection (Strands Agents templates).
- Container build pipeline (Docker + ECR push).
- Deployment via `agentcore-cli`.
- Data source integration.

### Phase 3 — Advanced Operations
- Real-time metrics auto-refresh.
- Multi-agent comparison views.
- Alert configuration.
- Authentication and authorization.

---

## 9. Open Questions / Future Decisions

| # | Question | Notes |
|---|----------|-------|
| 1 | What Strands Agents templates will be supported in Phase 2? | To be defined when Phase 2 begins. |
| 2 | Should the Operate tab aggregate metrics via a separate analytics store or compute on-the-fly from SQLite? | SQLite is sufficient for MVP; revisit at scale. |
| 3 | What is the CloudWatch log format for agents that do NOT emit the "Start time:" structured log? | The latency endpoint will return `null` for `agent_start_time` and surface a clear error message. |
| 4 | Will multi-region support be needed in Phase 1? | Region is read from environment; each backend instance serves one region. Multi-region is a Phase 3 concern. |
