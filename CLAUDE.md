# Loom — AI Assistant Guide

## Project Overview

Loom is a **greenfield agent builder playground** that simplifies the lifecycle of building, testing, integrating, deploying, and operating AI agents built on **Amazon Bedrock AgentCore Runtime** and **AWS Strands Agents**.

The MVP focuses on latency measurement for agents already deployed to AgentCore Runtime. See `SPECIFICATIONS.md` for the full design.

**Current repo state:** Documentation-only. No code has been written yet. The directories described below are planned but do not exist on disk.

---

## Directory Structure

```
loom/
├── backend/                    # FastAPI backend (Python)
│   ├── app/
│   │   ├── main.py             # FastAPI entry point, CORS config, router registration
│   │   ├── db.py               # SQLAlchemy engine and session setup (SQLite)
│   │   ├── models/
│   │   │   ├── agent.py        # Agent ORM model
│   │   │   └── session.py      # InvocationSession ORM model
│   │   ├── routers/
│   │   │   ├── agents.py       # /api/agents CRUD endpoints
│   │   │   ├── invocations.py  # /api/agents/{id}/invoke (SSE streaming)
│   │   │   ├── logs.py         # /api/agents/{id}/logs endpoints
│   │   │   └── latency.py      # /api/agents/{id}/sessions/{sid}/latency
│   │   └── services/
│   │       ├── agentcore.py    # boto3 Bedrock AgentCore wrapper
│   │       ├── cloudwatch.py   # CloudWatch log retrieval and parsing
│   │       └── latency.py      # Latency computation helpers (pure functions)
│   ├── tests/
│   │   ├── test_agentcore.py
│   │   ├── test_cloudwatch.py
│   │   └── test_latency.py
│   ├── pyproject.toml
│   └── requirements.txt
├── frontend/                   # React + TypeScript frontend (Vite)
│   ├── src/
│   │   ├── api/
│   │   │   └── client.ts       # Typed fetch wrappers for all backend endpoints
│   │   ├── components/
│   │   │   ├── ui/             # shadcn/ui primitives
│   │   │   ├── AgentCard.tsx
│   │   │   ├── InvokePanel.tsx
│   │   │   ├── LatencyChart.tsx
│   │   │   ├── LogViewer.tsx
│   │   │   └── MetricsDashboard.tsx
│   │   ├── pages/
│   │   │   ├── BuildPage.tsx   # Agent ARN registration UI
│   │   │   ├── TestPage.tsx    # Invocation + streaming + latency UI
│   │   │   └── OperatePage.tsx # Aggregate metrics dashboard
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── etc/
│   └── environment.sh          # Source-of-truth for all runtime parameters (gitignored)
├── iac/                        # AWS CloudFormation / SAM templates
├── agents/                     # Individual agent subdirectories (future phases)
├── tmp/                        # Temporary/reference files (gitignored)
├── makefile                    # Root orchestration — always check here first
├── CLAUDE.md                   # This file
├── README.md
└── SPECIFICATIONS.md           # Full design spec — read before implementing anything
```

---

## Build & Command Tooling

- **Always check `makefile` first** before writing custom scripts or commands.
- All commands must source `etc/environment.sh` for config injection.
- The makefile currently contains `include etc/environment.sh`; targets will be added as code is written.

### Planned Makefile Targets

| Target | Command |
|--------|---------|
| `backend-install` | `uv pip install -r backend/requirements.txt` |
| `backend-run` | `uvicorn backend.app.main:app --reload --port $BACKEND_PORT` |
| `backend-test` | `python -m pytest backend/tests/` |
| `frontend-install` | `npm install` (in `frontend/`) |
| `frontend-run` | `npm run dev` (in `frontend/`) |
| `frontend-build` | `npm run build` (in `frontend/`) |
| `dev` | Runs backend and frontend concurrently |

### Dependency Management

- **Python:** Use `uv`. Commands: `uv pip install`, `uv venv`.
  - The `backend/` directory gets its own `.venv` via `uv`.
  - Future agent subdirectories in `agents/` each get their own `.venv`.
- **TypeScript:** Use `npm`. Keep `node_modules` within `frontend/`.

---

## Configuration

All runtime config is in `etc/environment.sh` (gitignored). Never hardcode these values.

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for all API calls | (required) |
| `AWS_PROFILE` | AWS CLI profile | AWS default chain |
| `DATABASE_URL` | SQLite file path | `sqlite:///./loom.db` |
| `BACKEND_PORT` | Uvicorn port | `8000` |
| `FRONTEND_PORT` | Vite dev server port | `5173` |
| `LOG_LEVEL` | Backend log level | `info` |

---

## Technology Stack

### Backend

| Concern | Choice |
|---------|--------|
| Framework | FastAPI |
| Server | Uvicorn (local dev) |
| ORM | SQLAlchemy with SQLite |
| AWS SDK | boto3 |
| Python version | 3.11+ |
| Dependency manager | uv |
| Streaming | `StreamingResponse` (SSE via `fetch` + `ReadableStream`) |
| Testing | `unittest` / `pytest` |

### Frontend

| Concern | Choice |
|---------|--------|
| Framework | React 18 + TypeScript |
| Build tool | Vite |
| UI components | shadcn/ui |
| Styling | Tailwind CSS |
| HTTP client | Native `fetch` (typed wrappers in `src/api/client.ts`) |
| SSE streaming | `fetch` + `ReadableStream` (NOT `EventSource` — backend uses POST) |
| Charts | Recharts |
| Module system | ESM |

### AWS / IaC

- CloudFormation + SAM CLI for deployments.
- boto3 for all AWS SDK calls in Python.
- IAM follows least-privilege (see Security section).

---

## Coding Standards

### Python

- **Type hints required** on all function signatures.
- Follow **PEP 8** style guidelines.
- Use **SQLAlchemy ORM** — never write raw SQL strings.
- Use **`unittest`** (or `pytest`) for tests in `backend/tests/`.
- Tests must verify response shapes match expected outcomes.
- boto3 clients should be instantiated with the region from config, never hardcoded.

### TypeScript

- **ESM only** — no CommonJS (`require`).
- **Strict typing** — avoid `any`; use proper interface/type definitions.
- All API calls go through typed wrappers in `src/api/client.ts`.
- SSE streaming uses `fetch` + `ReadableStream` (POST-compatible), not `EventSource`.

### AWS / IaC

- Principle of least privilege in all IAM resources.
- Use environment-based naming: `resource-name-${STAGE}`.
- Deployments via `sam deploy`.

---

## Key Architectural Patterns

### SSE Streaming (Invocation)

The backend returns a `StreamingResponse` with `Content-Type: text/event-stream` for `POST /api/agents/{id}/invoke`. The frontend uses `fetch` + `ReadableStream` — **not** `EventSource` — because `EventSource` only supports GET.

SSE event sequence:
```
event: session_start   → {"session_id": "uuid", "client_invoke_time": 1708000000.123}
event: chunk           → {"text": "...token..."}
event: chunk           → {"text": "...token..."}
event: session_end     → {"session_id": "uuid", "client_done_time": ..., "client_duration_ms": ...}
event: error           → {"message": "..."}  (only on failure)
```

### Latency Measurement Flow

```
Frontend          Backend                 AWS
   │── POST /invoke ──►│── record client_invoke_time
   │                   │── invoke_agent_runtime ──────────────►│
   │◄── SSE chunks ────│◄── stream ─────────────────────────────│
   │                   │── record client_done_time
   │── GET /latency ──►│── FilterLogEvents (CloudWatch) ────────►│
   │                   │◄── log events ──────────────────────────│
   │                   │── parse "Agent invoked - Start time:" field
   │◄── latency resp ──│── persist cold_start_latency_ms to SQLite
```

- `cold_start_latency_ms = (agent_start_time − client_invoke_time) × 1000`
- `agent_start_time` is parsed from CloudWatch log pattern: `Agent invoked - Start time: {ISO_TIMESTAMP}`
- CloudWatch polling retries up to 12 times (5s intervals, 60s max).

### ARN Parsing

Runtime ARN format: `arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}`

Derived fields:
- `region` → segment index 3
- `account_id` → segment index 4
- `runtime_id` → resource path segment
- `log_group` → `/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}`
- `log_stream` → `BedrockAgentCoreRuntime_ApplicationLogs`

---

## Database Schema (SQLite via SQLAlchemy)

### `agents` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `arn` | TEXT UNIQUE | AgentCore Runtime ARN |
| `runtime_id` | TEXT | Extracted from ARN |
| `name` | TEXT | From AgentCore describe API |
| `status` | TEXT | `READY`, `CREATING`, etc. |
| `region` | TEXT | Extracted from ARN |
| `account_id` | TEXT | Extracted from ARN |
| `log_group` | TEXT | Derived from runtime_id + qualifier |
| `available_qualifiers` | TEXT | JSON array (e.g., `["DEFAULT"]`) |
| `raw_metadata` | TEXT | Full JSON from AgentCore |
| `registered_at` | DATETIME | Local registration timestamp |
| `last_refreshed_at` | DATETIME | Last AWS metadata fetch |

### `invocation_sessions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `agent_id` | INTEGER FK | → `agents.id` |
| `session_id` | TEXT | UUID used as `runtimeSessionId` |
| `qualifier` | TEXT | Endpoint qualifier (e.g., `DEFAULT`) |
| `prompt` | TEXT | Input prompt |
| `response` | TEXT | Accumulated stream response |
| `client_invoke_time` | REAL | Unix timestamp before boto3 call |
| `client_done_time` | REAL | Unix timestamp when stream completes |
| `agent_start_time` | REAL | Parsed from CloudWatch "Start time:" |
| `cold_start_latency_ms` | REAL | `(agent_start_time − client_invoke_time) × 1000` |
| `client_duration_ms` | REAL | `(client_done_time − client_invoke_time) × 1000` |
| `status` | TEXT | `pending`, `streaming`, `complete`, `error` |
| `error_message` | TEXT | Set when status is `error` |
| `created_at` | DATETIME | Session creation timestamp |

---

## API Reference Summary

All endpoints are prefixed `/api`. Full details in `SPECIFICATIONS.md` §3.5.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents` | Register agent by ARN |
| `GET` | `/api/agents` | List all registered agents |
| `GET` | `/api/agents/{id}` | Get agent metadata |
| `DELETE` | `/api/agents/{id}` | Remove agent from registry |
| `POST` | `/api/agents/{id}/refresh` | Re-fetch metadata from AWS |
| `POST` | `/api/agents/{id}/invoke` | Invoke agent (SSE stream) |
| `GET` | `/api/agents/{id}/sessions` | List invocation sessions |
| `GET` | `/api/agents/{id}/sessions/{sid}` | Get session details |
| `GET` | `/api/agents/{id}/logs` | Recent CloudWatch logs |
| `GET` | `/api/agents/{id}/sessions/{sid}/logs` | Session-filtered logs |
| `GET` | `/api/agents/{id}/sessions/{sid}/latency` | Latency measurement |

---

## Security

- **Never commit credentials, tokens, or secrets.** Verify with `git diff` before every push.
- Sensitive data lives only in:
  - `.env` files (gitignored)
  - `etc/environment.sh` (gitignored)
  - AWS Secrets Manager / Parameter Store for production
- Use `git-secrets` to scan before committing.
- boto3 uses the standard credential chain — no hardcoded keys.
- CORS: `localhost:{FRONTEND_PORT}` only in development.
- Required IAM permissions (read-only):
  - `bedrock-agentcore:GetAgentRuntime`
  - `bedrock-agentcore:InvokeAgentRuntime`
  - `logs:DescribeLogStreams`
  - `logs:FilterLogEvents`

---

## Implementation Phases

### Phase 1 — MVP (current focus)
- Backend: Agent registration, SSE invocation, CloudWatch log retrieval, latency calculation, SQLite persistence.
- Frontend: Build tab (ARN registration), Test tab (invocation + streaming + latency), Operate tab (dashboard).
- Refactor `tmp/latency/` reference implementation into reusable service modules.

### Phase 2 — Build Workflows
- Agent blueprint selection (Strands Agents templates).
- Container build pipeline (Docker + ECR push).
- Deployment via `agentcore-cli`.

### Phase 3 — Advanced Operations
- Real-time metrics auto-refresh, multi-agent comparison, alert configuration, authentication.

---

## Deployment Workflow

1. Update parameters in `etc/environment.sh`.
2. Run `make <target>` (always use the makefile, never ad-hoc commands).
3. IaC deployments use `sam deploy` from the `iac/` directory.
