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
├── backend/                    # Backend API (see backend/SPECIFICATIONS.md)
│   ├── app/
│   │   ├── main.py
│   │   ├── db.py
│   │   ├── models/
│   │   ├── routers/
│   │   └── services/
│   ├── scripts/
│   ├── tests/
│   ├── makefile
│   ├── SPECIFICATIONS.md       # Backend-specific specification
│   └── README.md
├── frontend/                   # Frontend UI (see frontend/SPECIFICATIONS.md)
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── SPECIFICATIONS.md       # Frontend-specific specification
├── etc/
│   └── environment.sh          # Source-of-truth for injectable parameters
├── tmp/
│   └── latency/                # Reference implementation (read-only)
├── makefile
├── CLAUDE.md
├── README.md
└── SPECIFICATIONS.md           # This file (project-level specification)
```

---

## 3. Component Specifications

Detailed specifications for each component are maintained in their respective directories:

- **Backend:** [`backend/SPECIFICATIONS.md`](backend/SPECIFICATIONS.md) — API endpoints, database schema, service modules, streaming architecture, latency measurement flow.
- **Frontend:** [`frontend/SPECIFICATIONS.md`](frontend/SPECIFICATIONS.md) — Technology stack, application shell, Build/Test/Operate tab specifications, streaming behavior.

---

## 4. Security Considerations

- No credentials, tokens, or secrets are committed to git.
- `etc/environment.sh` and `.env` files are listed in `.gitignore`.
- The backend uses the standard boto3 credential chain (environment variables, AWS profile, instance metadata) — no hardcoded credentials.
- All AWS API calls follow least-privilege IAM: read-only access to `bedrock-agentcore:GetAgentRuntime`, `bedrock-agentcore:InvokeAgentRuntime`, `logs:DescribeLogStreams`, `logs:FilterLogEvents`.
- CORS is configured to allow `localhost:{FRONTEND_PORT}` only in development.

---

## 5. Implementation Phases

### Phase 1 — MVP (Initial Implementation) *(Backend Complete)*
- Backend: Agent registration, metadata retrieval, SSE invocation with real-time streaming, CloudWatch log retrieval (stream browsing + session-filtered), integrated cold-start latency calculation, SQLite persistence with session/invocation separation.
- CLI: Streaming invocation client (`scripts/stream.py`) and comprehensive `makefile` targets for manual testing.
- Frontend: Build tab (ARN registration), Test tab (invocation + streaming + latency display), Operate tab (basic dashboard).
- Refactored `tmp/latency/` into reusable service modules.

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

## 6. Open Questions / Future Decisions

| # | Question | Notes |
|---|----------|-------|
| 1 | What Strands Agents templates will be supported in Phase 2? | To be defined when Phase 2 begins. |
| 2 | Should the Operate tab aggregate metrics via a separate analytics store or compute on-the-fly from SQLite? | SQLite is sufficient for MVP; revisit at scale. |
| 3 | What is the CloudWatch log format for agents that do NOT emit the "Start time:" structured log? | `cold_start_latency_ms` and `agent_start_time` are omitted from the `session_end` SSE event when logs are not found. |
| 4 | Will multi-region support be needed in Phase 1? | Region is extracted per-agent from the ARN. The backend can manage agents across multiple regions simultaneously. |
| 5 | Should the Agent PK be changed from integer to a natural key (ARN, UUID, or runtime_id)? | **Decision: keep integer PK.** The `session_id` string PK is justified as a natural key (UUID used in AWS API calls). Agent integer PK provides the best ergonomics for CLI usage and fastest SQLite joins. `arn` and `runtime_id` are already stored and indexed for AWS lookups. |
