# Loom: Agent Builder Playground — Specifications

## 1. Overview

Loom is an agent builder playground that simplifies the lifecycle of building, testing, integrating, deploying, and operating AI agents built on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. The platform consists of:

- A **FastAPI backend** that encapsulates all AWS interactions and business logic.
- A **React/TypeScript frontend** (Vite, shadcn, Tailwind CSS) that interacts exclusively through the backend API.
- A **local SQLite database** (via SQLAlchemy) for persisting agent metadata and session history.

The platform tracks session liveness using a local idle timeout heuristic, providing cold-start indicators so users know whether their next invocation will incur agent startup latency.

### Initial MVP Scope

The initial implementation focuses on the **latency measurement test use case** for agents that are already deployed to AgentCore Runtime. **Phase 2 (agent deployment) is now implemented.** Agents can be deployed directly from the UI using the Strands Agent blueprint with configurable model, protocol, network mode, authorizer (Cognito JWT), and lifecycle settings.

---

## 2. Directory Structure

```
loom/
├── agents/                     # Agent blueprint source code
│   └── strands_agent/          # Strands Agent blueprint
│       ├── handler.py          # Agent handler / entry point
│       ├── config.py           # Agent configuration
│       ├── integrations.py     # Tool and service integrations
│       └── telemetry.py        # Observability and telemetry
├── backend/                    # Backend API (see backend/SPECIFICATIONS.md)
│   ├── app/
│   │   ├── main.py
│   │   ├── db.py
│   │   ├── models/
│   │   │   └── config_entry.py # Configuration entry model
│   │   ├── routers/
│   │   └── services/
│   │       ├── secrets.py      # AWS Secrets Manager integration
│   │       ├── cognito.py      # Cognito OAuth2 token retrieval
│   │       ├── credential.py   # Credential management
│   │       └── deployment.py   # Agent deployment orchestration
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
- Cognito client secrets are stored in AWS Secrets Manager, never in the local database.
- The backend retrieves secrets at invocation time with in-memory caching (5-minute TTL).
- Secrets are cleaned up from Secrets Manager when agents are deleted.

---

## 5. Implementation Phases

### Phase 1 — MVP (Initial Implementation) *(Complete)*
- Backend: Agent registration, metadata retrieval, SSE invocation with real-time streaming, CloudWatch log retrieval (stream browsing + session-filtered), integrated cold-start latency calculation, SQLite persistence with session/invocation separation, session liveness tracking via idle timeout heuristic, active session count per agent.
- CLI: Streaming invocation client (`scripts/stream.py`) and comprehensive `makefile` targets for manual testing.
- Frontend: Build tab (ARN registration), Test tab (invocation + streaming + latency display), Operate tab (basic dashboard), active session count display on agent cards, session live status indicators.
- Refactored `tmp/latency/` into reusable service modules.

### Phase 2 — Agent Deployment *(Complete)*
- Agent deployment to AgentCore Runtime from the Strands Agent blueprint.
- Auto-build artifact pipeline (pip cross-compile for ARM64, S3 upload, zip packaging).
- Configurable deploy form: model selection, protocol (HTTP; MCP/A2A coming soon), network mode (PUBLIC; VPC coming soon), IAM role (searchable select or auto-create), authorizer (Cognito JWT with auto-populated discovery URL, or custom OIDC provider), lifecycle timeouts, integrations (coming soon).
- Cognito OAuth2 token retrieval for authenticated agent invocations (client credentials grant).
- Secret management via AWS Secrets Manager for Cognito client secrets.
- Agent deletion with optional AgentCore cleanup (runtime + endpoint removal).
- Account ID extraction from runtime ARN on deploy and refresh.

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
| 3 | What is the CloudWatch log format for agents that do NOT emit the "Start time:" structured log? | **Resolved.** `parse_agent_start_time` first looks for the "Agent invoked - Start time:" pattern; if not found, it falls back to the earliest CloudWatch event timestamp as an approximation. This handles agents with non-standard log formats. If no logs are found at all, the invocation succeeds without latency data. |
| 4 | Will multi-region support be needed in Phase 1? | Region is extracted per-agent from the ARN. The backend can manage agents across multiple regions simultaneously. |
| 5 | Should the Agent PK be changed from integer to a natural key (ARN, UUID, or runtime_id)? | **Decision: keep integer PK.** The `session_id` string PK is justified as a natural key (UUID used in AWS API calls). Agent integer PK provides the best ergonomics for CLI usage and fastest SQLite joins. `arn` and `runtime_id` are already stored and indexed for AWS lookups. |
| 6 | Can we query AWS for live session status (e.g., `list_runtime_sessions`)? | **No.** The Bedrock AgentCore SDK does not expose `list_runtime_sessions` or `get_runtime_session` APIs. Session liveness is instead computed locally using an idle timeout heuristic (`SESSION_IDLE_TIMEOUT_MINUTES`). This approach inherently avoids AWS API throttling. |
| 7 | How should Cognito client secrets be stored? | **Resolved.** AWS Secrets Manager with in-memory caching (5-minute TTL). Never stored in the local database. |
| 8 | Should agent deletion also clean up AWS resources? | **Resolved.** Optional checkbox "Remove in AgentCore" shown when agent has a runtime_id. IAM roles are preserved. |
