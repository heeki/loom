# Loom: Agent Builder Playground — Specifications

## 1. Overview

Loom is an agent builder playground that simplifies the lifecycle of building, testing, integrating, deploying, and operating AI agents built on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. The platform consists of:

- A **FastAPI backend** that encapsulates all AWS interactions and business logic.
- A **React/TypeScript frontend** (Vite, shadcn, Tailwind CSS) that interacts exclusively through the backend API.
- A **local SQLite database** (via SQLAlchemy) for persisting agent metadata, session history, security configurations, and credential management.

The platform tracks session liveness using a local idle timeout heuristic, providing cold-start indicators so users know whether their next invocation will incur agent startup latency.

### Persona-Based Workflows

The frontend is organized around persona-based workflows, accessible via a sidebar:

- **Platform Catalog** (default) — Browse and manage agents, memory resources, and other platform resources. Includes sections for MCP Servers and A2A Agents (coming soon).
- **Agents** — Deploy new agents or import existing ones. Includes agent listing with card/table view toggle.
- **Security Admin** — Manage IAM roles, authorizer configurations, credentials, and permission requests.
- **Memory** — Create new AgentCore Memory resources with configurable strategies or import existing ones.
- **Settings** — Manage tag profiles and other configuration. Accessible to all scopes; write operations require `*:write`.
- **MCP Servers** (coming soon) — Disabled sidebar entry for future MCP server management.
- **A2A Agents** (coming soon) — Disabled sidebar entry for future A2A agent management.

---

## 2. Directory Structure

```
loom/
├── agents/                     # Agent blueprint source code
│   └── strands_agent/          # Strands Agent blueprint
│       ├── handler.py          # Agent handler / entry point (trace_invocation wrapped)
│       ├── config.py           # Agent configuration
│       ├── integrations.py     # Tool and service integrations
│       └── telemetry.py        # OTEL setup, ADOT auto-instrumentation, TelemetryHook
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
│   │   │   ├── permission_request.py
│   │   │   ├── memory.py
│   │   │   └── tag_profile.py
│   │   ├── dependencies/
│   │   │   └── auth.py
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── agents.py
│   │   │   ├── invocations.py
│   │   │   ├── logs.py
│   │   │   ├── memories.py
│   │   │   ├── security.py
│   │   │   ├── settings.py
│   │   │   └── utils.py
│   │   └── services/
│   │       ├── agentcore.py
│   │       ├── memory.py
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
├── security/                   # Security IaC templates + user management
│   ├── iac/
│   │   ├── role.yaml           # SAM template for IAM roles
│   │   └── cognito.yaml        # SAM template for Cognito pools, groups, users, scopes
│   ├── etc/
│   │   └── environment.sh      # Security configuration (Cognito pool, passwords)
│   └── makefile                # Cognito stack deploy, user password management
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

- **Backend:** [`backend/SPECIFICATIONS.md`](backend/SPECIFICATIONS.md) — API endpoints, database schema, service modules, streaming architecture, latency measurement flow, security management, memory resource management, tag policies and profiles.
- **Frontend:** [`frontend/SPECIFICATIONS.md`](frontend/SPECIFICATIONS.md) — Technology stack, persona-based navigation, Platform Catalog/Agents/Security Admin/Memory/Settings workflows, streaming behavior.

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

- Users authenticate via an AWS Cognito User Pool using the `USER_PASSWORD_AUTH` flow.
- The frontend stores tokens (id, access, refresh) in React state only — never in localStorage or cookies.
- The backend validates user JWTs against the Cognito JWKS endpoint (keys cached for 1 hour).
- The `GET /api/auth/config` endpoint exposes only the pool ID and region — never client IDs or secrets.
- The user client ID is configured on the frontend via the `VITE_COGNITO_USER_CLIENT_ID` environment variable (Vite `.env` file). The user client has `GenerateSecret: false` since browser-based apps cannot safely store client secrets.
- When a user is authenticated, their access token is forwarded to AgentCore for agent invocations, replacing the M2M client credentials flow.
- Unauthenticated requests are allowed to pass through with a warning (no breaking change to existing flows).
- The `NEW_PASSWORD_REQUIRED` Cognito challenge is handled on first login for admin-created users.
- Access tokens are automatically refreshed before expiry using the refresh token.
- Token persistence across browser refreshes is out of scope — users must re-login after page reload.

### Cognito User Pool Configuration

The Cognito User Pool is managed via CloudFormation (`security/iac/cognito.yaml`) and includes:

- **Password policy:** Minimum 12 characters, uppercase, lowercase, numbers required; symbols not required.
- **Resource server scopes:** `invoke`, `agent:read`, `agent:write`, `security:read`, `security:write`, `data:read`, `data:write`.
- **Groups:** `admins`, `security-admins`, `data-stewards`, `builders`, `operators`.
- **Users:** `admin`, `secadmin`, `datasteward`, `builder`, `operator` — each assigned to their respective group via `UserPoolUserToGroupAttachment`.
- **Clients:**
  - **M2MClient** — `client_credentials` flow with secret, scoped to `invoke`.
  - **UserClient** — `USER_PASSWORD_AUTH` + `REFRESH_TOKEN_AUTH` flows without secret, scoped to all custom scopes plus `openid`, `email`, `profile`.
- User passwords are set via `make cognito.set-passwords` in the `security/` directory.

### Scope-Based Frontend Authorization

The frontend enforces scope-based access control derived from Cognito group membership:

| Group | Scopes | Sidebar Access | Write Access |
|-------|--------|----------------|--------------|
| `admins` | agent:read/write, security:read/write, data:read/write | All pages | All actions |
| `security-admins` | security:read, security:write | Security | Security actions |
| `data-stewards` | data:read, data:write | Memory, MCP Servers, A2A Agents | Memory actions |
| `builders` | agent:read, agent:write | Agents | Agent actions |
| `operators` | agent:read, security:read, data:read | Agents, Security | Read-only |

- **Sidebar visibility:** Each sidebar item is shown only when the user has the corresponding `*:read` or `*:write` scope. The Platform Catalog is always visible.
- **Write protection:** Components receive a `readOnly` prop that disables or hides add, edit, and delete buttons when the user lacks `*:write` scopes.
- **Bypass mode:** When authentication is not configured (no Cognito pool ID or client ID), all scopes are granted and all features are accessible.

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
- Persona-based frontend navigation: Platform Catalog, Agents, Security Admin, Memory, MCP Servers (coming soon), A2A Agents (coming soon).
- Platform Catalog page with sections for agents, memory resources, MCP servers (coming soon), and A2A agents (coming soon). Card/table view toggle with cards as default.
- Agents page (formerly Builder) with agent listing (card/table view toggle), Add Agent button with Deploy/Import tabs.
- Security Admin page for managing IAM roles, authorizer configs, authorizer credentials, and permission requests.
- Model selector on both register and deploy forms with no default selection.
- Model ID tracked on agent responses for display on invoke page.
- Credential-based invocation: select a credential from an authorizer config to generate an OAuth token at invoke time.
- Token indicator on invoke responses (`has_token`, `token_source` in SSE session_start).
- Configurable session defaults via `LOOM_SESSION_IDLE_TIMEOUT_SECONDS` and `LOOM_SESSION_MAX_LIFETIME_SECONDS` environment variables, exposed via `/api/agents/defaults`.

### Phase 4 — AgentCore Memory Resources *(Complete)*
- Backend API for creating, managing, and deleting AgentCore Memory resources.
- Memory strategies: semantic, summary, user_preference, episodic, and custom — mapped to AWS tagged union format.
- Local SQLite persistence for memory resource metadata with status tracking.
- Refresh endpoint to poll AWS for latest memory status.
- AWS error mapping: ValidationException→400, ConflictException→409, ResourceNotFoundException→404, AccessDeniedException→403, ThrottledException/ServiceQuotaExceededException→429.
- Makefile curl targets for manual testing of all memory endpoints.
- Frontend Memory persona: memory card and table views with card/table toggle (cards default), create form with strategy configuration, status badges, refresh and delete actions, toast notifications for all operations.
- Memory import endpoint (POST /api/memories/import) for importing existing AgentCore Memory resources.
- Async deletion flow: backend returns DELETING status, frontend polls for updates, detects 404 when resource is fully deleted, then purges locally.
- "Also delete in AgentCore" checkbox on memory deletion for optional upstream cleanup.
- Timer persistence across navigation using server timestamps.
- Purge endpoint (DELETE /api/memories/{id}/purge) for local database cleanup after confirmed deletion.
- View mode (card/table) state lifted to App.tsx and persisted per-page across persona switches.

### Phase 5 — AgentCore Observability *(Complete)*
- Deployment entry point wrapped with `opentelemetry-instrument` CLI for ADOT auto-instrumentation of boto3, HTTP clients, and other libraries at process startup.
- `TelemetryHook` on the Strands Agent that creates OTEL spans for tool calls and model invocations as children of the invocation span.
- `trace_invocation()` wraps each handler invocation with a root span carrying `agent.session_id` and `agent.invocation_id` attributes.
- Noop mode when running locally without the `opentelemetry-instrument` wrapper — no errors, no performance overhead.
- `OTEL_SERVICE_NAME` is automatically set to the agent name at deploy time.
- `AGENT_OBSERVABILITY_ENABLED` is set to `true` at deploy time, which activates the `aws-opentelemetry-distro` export pipeline (X-Ray traces, CloudWatch logs/metrics).
- Console script shebang fix: the build pipeline rewrites `opentelemetry-instrument` (and `opentelemetry-bootstrap`) scripts with a portable `#!/usr/bin/env python3` shebang so they execute correctly on the Linux-based AgentCore Runtime container.
- Unit tests for telemetry setup idempotency, span creation, hook lifecycle, shebang fix, and noop operation.

### Phase 6 — User Authentication *(Complete)*
- Cognito-based user authentication with `USER_PASSWORD_AUTH` flow.
- Login page with `NEW_PASSWORD_REQUIRED` challenge handling for admin-created users.
- `AuthContext` provider with login, logout, and automatic token refresh.
- User indicator (username) and logout button in the sidebar.
- JWT validation middleware on the backend (JWKS caching, token claim extraction).
- User access token forwarded to AgentCore for authenticated invocations (priority over M2M flow).
- Graceful fallback to existing M2M client credentials flow when no user token is present.
- `GET /api/auth/config` endpoint returns pool ID and region; user client ID is configured on the frontend via `VITE_COGNITO_USER_CLIENT_ID`.
- Tokens stored in memory only (not localStorage); authentication does not persist across page reloads.
- Cognito User Pool IaC: resource server with custom scopes (`agent:read/write`, `security:read/write`, `data:read/write`, `invoke`), user groups (`admins`, `security-admins`, `data-stewards`, `builders`, `operators`), users with group assignments, password policy (12+ chars, no symbols required).
- Security makefile with `cognito.set-passwords` target for setting permanent user passwords.
- Scope-based frontend authorization: `AuthContext` extracts `cognito:groups` from the ID token, maps groups to scopes, and exposes `hasScope()`. Sidebar items are conditionally rendered based on user scopes. Write operations (add, edit, delete buttons) are disabled or hidden via a `readOnly` prop when the user lacks `*:write` scopes. When auth is not configured, all scopes are granted.

### Phase 7 — Resource Tagging *(Complete)*
- Configurable tag policy system: `TagPolicy` model with key, default_value, source (deploy-time/build-time), required, and show_on_card fields.
- Tag policy CRUD API under `/api/settings/tags` with default seed data (loom:deployed-by, loom:application, loom:group, loom:owner).
- Tag profile system: `TagProfile` model for named sets of tag values. CRUD API under `/api/settings/tag-profiles`. Profiles satisfy build-time tag policies and are applied to all deployed resources.
- `ResourceTagFields` shared component: fetches tag policies and profiles, renders a profile dropdown with `sessionStorage` persistence (`loom:selectedTagProfileId`), resolves tags from the selected profile + policy defaults, and passes resolved tags to the parent form via `onChange`. Used by both the agent deploy form and memory create form.
- Deploy-time tags are automatically applied from policy defaults; build-time tags are resolved from the selected tag profile.
- Required build-time tag validation before deployment — missing tags return HTTP 400.
- All AWS resources that support tags (AgentCore runtimes, runtime endpoints, IAM execution roles, managed roles, memory resources) receive the resolved tags.
- Memory resources: `tags` column added to the `memories` table. Tags are resolved from tag policies + selected profile on creation, passed to AWS `create_memory`, and stored locally. Imported memories fetch existing tags from AWS via `list_tags_for_resource` and enforce tag policies (missing required tags default to "missing").
- Registered agents fetch existing tags from AWS via `list_tags_for_resource` and enforce tag policies (missing required tags default to "missing").
- Resolved tags stored on Agent and Memory records as JSON columns, included in API responses.
- Agent and memory cards display tag badges (`variant="secondary"`) for tags with `show_on_card=true`.
- All listing pages (Platform Catalog, Agents, Memory) provide tag-based filtering with multi-select dropdowns (checkbox-based), AND logic, clear button, and item count display.
- Settings persona: new sidebar entry accessible to all scopes. `SettingsPage` provides tag profile CRUD. `*:write` scopes can create, edit, and delete profiles; `*:read` scopes can only view. Tag value inputs enforce a 128-character maximum length.
- 27 new backend tests covering tag policy CRUD, tag resolution, validation, and agent tag storage.

### Phase 8 — Frontend Visual Polish *(Complete)*
- Theme system: `ThemeContext` with 10 themes — 5 light (Ayu Light, Catppuccin Latte, Everforest Light, Rosé Pine Dawn, Solarized Light) and 5 dark (Catppuccin Mocha, Dracula, Gruvbox, Nord, Tokyo Night). Theme selector on Settings page with Light/Dark grouping. CSS variables per theme in `index.css`. Latte is the default (no class); other themes use class selectors. `localStorage` persistence.
- Theme accessibility: darkened `foreground`/`muted-foreground`/`border` for all light themes for better readability. Brightened `foreground`/`muted-foreground`/`border` for all dark themes. Badge `border-border` added to default and secondary badge variants for visibility.
- Settings page: moved theme and timezone selectors from sidebar to Settings preferences section. Description updated to "Manage settings and tag profiles."
- Drag-to-reorder cards: `@dnd-kit` for card reordering in grid sections (`SortableCardGrid` component), order persisted to `localStorage`.
- Admin role view switching: sidebar dropdown (Eye icon) to test other role experiences while retaining admin access. `effectiveHasScope` overrides `hasScope` for UI rendering.
- Deploy flow: fire-and-forget pattern — form collapses immediately, shows agent card with creating status. Background API call with error toast on failure. No 45-second blocking.
- Agent card two-phase creation: shows deploying → completing deployment → finalizing endpoint status with spinner and timer. Timer format: spinner (Ns) message. Timer uses `registered_at` to avoid reset on phase transition. Two-row header layout.
- Memory card: matching two-row header layout with spinner/timer for creating/deleting states.
- Polling stability: `initialLoadDone` ref prevents skeleton flash on refetches. `watchIds`-based polling effect dependency to prevent interval teardown on state updates. Removed redundant polling from `AgentListPage`.
- JSON paste: handles `model`, `role`, `authorizer`, and `network_mode` fields in addition to `name`/`description`/`persona`/`instructions`/`behavior`.
- Credential suggestion on errors: `friendlyInvokeError` accepts optional `authorizerName`, suggests correct authorizer on 401/403 errors.
- Catalog page: removed unnecessary refresh button from Memory Resources section.
- Documentation: `frontend/.env.example` template, README title updated.

### Phase 9 — Advanced Operations
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
