# Loom: Agent Builder Playground — Specifications

## 1. Overview

Loom is an agent builder playground that simplifies the lifecycle of building, testing, integrating, deploying, and operating AI agents built on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. The platform consists of:

- A **FastAPI backend** that encapsulates all AWS interactions and business logic.
- A **React/TypeScript frontend** (Vite, shadcn, Tailwind CSS) that interacts exclusively through the backend API.
- A **local SQLite database** (via SQLAlchemy) for persisting agent metadata, session history, security configurations, and credential management.

The platform tracks session liveness using a local idle timeout heuristic, providing cold-start indicators so users know whether their next invocation will incur agent startup latency.

### Persona-Based Workflows

The frontend is organized around four persona-based workflows, accessible via a sidebar:

- **Catalog** (default) — Browse, invoke, and manage registered/deployed agents.
- **Builder** — Register agents by ARN or deploy new agents to AgentCore Runtime.
- **Security Admin** — Manage IAM roles, authorizer configurations, credentials, and permission requests.
- **Data Integration** — Manage data integrations (placeholder for future work).

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
│   │   │   ├── agent.py
│   │   │   ├── config_entry.py
│   │   │   ├── session.py
│   │   │   ├── invocation.py
│   │   │   ├── managed_role.py
│   │   │   ├── authorizer_config.py
│   │   │   ├── authorizer_credential.py
│   │   │   └── permission_request.py
│   │   ├── dependencies/
│   │   │   └── auth.py
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── agents.py
│   │   │   ├── invocations.py
│   │   │   ├── logs.py
│   │   │   ├── security.py
│   │   │   └── utils.py
│   │   └── services/
│   │       ├── agentcore.py
│   │       ├── secrets.py
│   │       ├── cognito.py
│   │       ├── credential.py
│   │       ├── deployment.py
│   │       ├── iam.py
│   │       ├── jwt_validator.py
│   │       └── latency.py
│   ├── scripts/
│   ├── tests/
│   ├── makefile
│   ├── SPECIFICATIONS.md
│   └── README.md
├── frontend/                   # Frontend UI (see frontend/SPECIFICATIONS.md)
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── lib/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── SPECIFICATIONS.md
├── security/                   # Security IaC templates
│   └── iac/
│       ├── role.yaml           # SAM template for IAM roles
│       └── cognito.yaml        # SAM template for Cognito pools
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

- **Backend:** [`backend/SPECIFICATIONS.md`](backend/SPECIFICATIONS.md) — API endpoints, database schema, service modules, streaming architecture, latency measurement flow, security management.
- **Frontend:** [`frontend/SPECIFICATIONS.md`](frontend/SPECIFICATIONS.md) — Technology stack, persona-based navigation, Catalog/Builder/Security Admin workflows, streaming behavior.

---

## 4. Security Considerations

- No credentials, tokens, or secrets are committed to git.
- `etc/environment.sh` and `.env` files are listed in `.gitignore`.
- The backend uses the standard boto3 credential chain (environment variables, AWS profile, instance metadata) — no hardcoded credentials.
- All AWS API calls follow least-privilege IAM.
- CORS is configured to allow `localhost:{FRONTEND_PORT}` only in development.
- Cognito client secrets are stored in AWS Secrets Manager, never in the local database.
- The backend retrieves secrets at invocation time with in-memory caching (5-minute TTL).
- Secrets are cleaned up from Secrets Manager when authorizer credentials or agents are deleted.
- Security administration (roles, authorizers, credentials, permissions) is managed through a dedicated persona workflow.

### User Authentication

- Users authenticate via a pre-existing AWS Cognito User Pool using the `USER_PASSWORD_AUTH` flow.
- The frontend stores tokens (id, access, refresh) in React state only — never in localStorage or cookies.
- The backend validates user JWTs against the Cognito JWKS endpoint (keys cached for 1 hour).
- The `GET /api/auth/config` endpoint exposes only the pool ID, user client ID, and region — never client secrets.
- When a user is authenticated, their access token is forwarded to AgentCore for agent invocations, replacing the M2M client credentials flow.
- Unauthenticated requests are allowed to pass through with a warning (no breaking change to existing flows).
- The `NEW_PASSWORD_REQUIRED` Cognito challenge is handled on first login for admin-created users.
- Access tokens are automatically refreshed before expiry using the refresh token.
- Token persistence across browser refreshes is out of scope — users must re-login after page reload.

---

## 5. Supported Foundation Models

Models are organized into two groups and use cross-region inference profiles (`us.` prefix):

**Anthropic:**
- Claude Opus 4.6 (`us.anthropic.claude-opus-4-6-v1`)
- Claude Sonnet 4.6 (`us.anthropic.claude-sonnet-4-6`)
- Claude Opus 4.5 (`us.anthropic.claude-opus-4-5-20251101-v1:0`)
- Claude Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`)
- Claude Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`)

**Amazon:**
- Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`)
- Nova Premier (`us.amazon.nova-premier-v1:0`)
- Nova Pro (`us.amazon.nova-pro-v1:0`)
- Nova Lite (`us.amazon.nova-lite-v1:0`)
- Nova Micro (`us.amazon.nova-micro-v1:0`)

Model selectors in the UI are searchable by both display name and model ID, with grouped sections (Anthropic / Amazon). No default is pre-selected — the user must explicitly choose a model.

---

## 6. Implementation Phases

### Phase 1 — MVP (Initial Implementation) *(Complete)*
- Backend: Agent registration, metadata retrieval, SSE invocation with real-time streaming, CloudWatch log retrieval (stream browsing + session-filtered), integrated cold-start latency calculation, SQLite persistence with session/invocation separation, session liveness tracking via idle timeout heuristic, active session count per agent.
- CLI: Streaming invocation client (`scripts/stream.py`) and comprehensive `makefile` targets for manual testing.
- Frontend: Build tab (ARN registration), Test tab (invocation + streaming + latency display), Operate tab (basic dashboard), active session count display on agent cards, session live status indicators.
- Refactored `tmp/latency/` into reusable service modules.

### Phase 2 — Agent Deployment *(Complete)*
- Agent deployment to AgentCore Runtime from the Strands Agent blueprint.
- Auto-build artifact pipeline (pip cross-compile for ARM64, S3 upload, zip packaging).
- Configurable deploy form: model selection (grouped, searchable), protocol (HTTP; MCP/A2A coming soon), network mode (PUBLIC; VPC coming soon), IAM role (searchable select or auto-create), authorizer (Cognito JWT with auto-populated discovery URL, or custom OIDC provider), lifecycle timeouts, integrations (coming soon).
- Cognito OAuth2 token retrieval for authenticated agent invocations (client credentials grant).
- Secret management via AWS Secrets Manager for Cognito client secrets.
- Agent deletion with optional AgentCore cleanup (runtime + endpoint removal).
- Account ID extraction from runtime ARN on deploy and refresh.

### Phase 3 — Persona-Based Workflows *(Complete)*
- Persona-based frontend navigation: Catalog, Builder, Security Admin, Data Integration.
- Catalog page with agent cards: eraser icon for deletion, overlay confirmation with "Also delete in AgentCore" checkbox, no refresh button on cards.
- Builder page with register and deploy tabs, collapsible role permissions, grouped searchable model selectors.
- Security Admin page for managing IAM roles, authorizer configs, authorizer credentials, and permission requests.
- Model selector on both register and deploy forms with no default selection.
- Model ID tracked on agent responses for display on invoke page.
- Credential-based invocation: select a credential from an authorizer config to generate an OAuth token at invoke time.
- Token indicator on invoke responses (`has_token`, `token_source` in SSE session_start).
- Configurable session defaults via `LOOM_SESSION_IDLE_TIMEOUT_SECONDS` and `LOOM_SESSION_MAX_LIFETIME_SECONDS` environment variables, exposed via `/api/agents/defaults`.

### Phase 4 — User Authentication *(Complete)*
- Cognito-based user authentication with `USER_PASSWORD_AUTH` flow.
- Login page with `NEW_PASSWORD_REQUIRED` challenge handling for admin-created users.
- `AuthContext` provider with login, logout, and automatic token refresh.
- User indicator and logout button in the sidebar.
- JWT validation middleware on the backend (JWKS caching, token claim extraction).
- User access token forwarded to AgentCore for authenticated invocations (priority over M2M flow).
- Graceful fallback to existing M2M client credentials flow when no user token is present.
- `GET /api/auth/config` endpoint for frontend to discover Cognito configuration.
- Tokens stored in memory only (not localStorage); authentication does not persist across page reloads.

### Phase 5 — Advanced Operations
- Real-time metrics auto-refresh.
- Multi-agent comparison views.
- Alert configuration.
- Role-based access control within Loom.

---

## 7. Open Questions / Future Decisions

| # | Question | Notes |
|---|----------|-------|
| 1 | What Strands Agents templates will be supported beyond the initial blueprint? | To be defined as new agent patterns emerge. |
| 2 | Should the Operate tab aggregate metrics via a separate analytics store or compute on-the-fly from SQLite? | SQLite is sufficient for MVP; revisit at scale. |
| 3 | What is the CloudWatch log format for agents that do NOT emit the "Start time:" structured log? | **Resolved.** `parse_agent_start_time` first looks for the "Agent invoked - Start time:" pattern; if not found, it falls back to the earliest CloudWatch event timestamp as an approximation. |
| 4 | Will multi-region support be needed? | Region is extracted per-agent from the ARN. The backend can manage agents across multiple regions simultaneously. |
| 5 | Should the Agent PK be changed from integer to a natural key? | **Decision: keep integer PK.** Integer PKs provide the best ergonomics for CLI usage and fastest SQLite joins. |
| 6 | Can we query AWS for live session status? | **No.** The Bedrock AgentCore SDK does not expose session listing/querying APIs. Session liveness is computed locally using an idle timeout heuristic (`LOOM_SESSION_IDLE_TIMEOUT_SECONDS`, default 300). |
| 7 | How should Cognito client secrets be stored? | **Resolved.** AWS Secrets Manager with in-memory caching (5-minute TTL). Never stored in the local database. |
| 8 | Should agent deletion also clean up AWS resources? | **Resolved.** Optional checkbox "Also delete in AgentCore" shown when agent has a runtime_id. IAM roles are preserved. |
