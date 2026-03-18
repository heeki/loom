# Loom: Agent Builder Playground — Specifications

## 1. Overview

Loom is an agent builder playground that simplifies the lifecycle of building, testing, integrating, deploying, and operating AI agents built on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. The platform consists of:

- A **FastAPI backend** that encapsulates all AWS interactions and business logic.
- A **React/TypeScript frontend** (Vite, shadcn, Tailwind CSS) that interacts exclusively through the backend API.
- A **local SQLite database** (via SQLAlchemy) for persisting agent metadata, session history, security configurations, and credential management.

The platform tracks session liveness using a local idle timeout heuristic, providing cold-start indicators so users know whether their next invocation will incur agent startup latency.

### Persona-Based Workflows

The frontend is organized around persona-based workflows, accessible via a sidebar:

- **Platform Catalog** (default) — Browse and manage agents, memory resources, and other platform resources. Includes sections for MCP Servers and A2A Agents.
- **Agents** — Deploy new agents or import existing ones. Includes agent listing with card/table view toggle.
- **Security Admin** — Manage IAM roles, authorizer configurations, credentials, and permission requests.
- **Memory** — Create new AgentCore Memory resources with configurable strategies or import existing ones.
- **Tagging** — Manage tag policies (platform + custom) and tag profiles. Accessible to all scopes; write operations require `*:write`.
- **Settings** — Manage display preferences (theme, timezone). Accessible to all scopes.
- **MCP Servers** — Register and manage MCP servers, view available tools, and control persona access.
- **A2A Agents** — Register and manage A2A (Agent-to-Agent) protocol integrations, view Agent Cards, and control persona access to skills.

---

## 2. Directory Structure

```
loom/
├── agents/                     # Agent blueprint source code
│   └── strands_agent/          # Strands Agent blueprint
│       ├── handler.py          # Agent handler / entry point (trace_invocation wrapped)
│       ├── config.py           # Agent configuration
│       ├── integrations/       # Tool and service integrations
│       │   ├── mcp_client.py   # MCP tool client vending
│       │   ├── a2a_client.py   # A2A agent client vending
│       │   └── memory.py       # AgentCore Memory hooks (MemoryHook)
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
│   │   │   ├── mcp.py
│   │   │   ├── a2a.py
│   │   │   └── tag_profile.py
│   │   ├── dependencies/
│   │   │   └── auth.py
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── agents.py
│   │   │   ├── a2a.py
│   │   │   ├── costs.py
│   │   │   ├── invocations.py
│   │   │   ├── logs.py
│   │   │   ├── memories.py
│   │   │   ├── mcp.py
│   │   │   ├── security.py
│   │   │   ├── settings.py
│   │   │   └── utils.py
│   │   └── services/
│   │       ├── agentcore.py
│   │       ├── a2a.py
│   │       ├── cloudwatch.py    # CloudWatch log retrieval with pagination, session-filtered queries, and usage log parsing
│   │       ├── mcp.py
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
- When a user is authenticated, their access token is forwarded to OAuth-protected AgentCore agents. The backend auto-includes the user app client ID in the agent's `allowedClients` on deploy. M2M credentials remain available for service-to-service integrations.
- Unauthenticated requests are allowed to pass through with a warning (no breaking change to existing flows).
- The `NEW_PASSWORD_REQUIRED` Cognito challenge is handled on first login for admin-created users.
- Access tokens are automatically refreshed before expiry using the refresh token.
- On 401 responses, the frontend automatically refreshes the access token and retries the failed request.
- Token persistence across browser refreshes is out of scope — users must re-login after page reload.

### Cognito User Pool Configuration

The Cognito User Pool is managed via CloudFormation (`security/iac/cognito.yaml`) and includes:

- **Password policy:** Minimum 12 characters, uppercase, lowercase, numbers required; symbols not required.
- **Resource server scopes:** `invoke`, `catalog:read`, `catalog:write`, `agent:read`, `agent:write`, `memory:read`, `memory:write`, `security:read`, `security:write`, `settings:read`, `settings:write`, `mcp:read`, `mcp:write`, `a2a:read`, `a2a:write`.
- **Groups:** `super-admins`, `demo-admins`, `security-admins`, `memory-admins`, `mcp-admins`, `a2a-admins`, `users`. Group scopes: super-admins (all 15 scopes including invoke), demo-admins (all read/write scopes plus invoke), security-admins (security:read/write), memory-admins (memory:read/write), mcp-admins (mcp:read/write), a2a-admins (a2a:read/write), users (invoke only).
- **Users:** `admin` (super-admins), `demo-admin-1`/`demo-admin-2` (demo-admins), `security-admin` (security-admins), `integration-admin` (memory-admins + mcp-admins + a2a-admins), `demo-user-1`/`demo-user-2` (users) — each assigned via `UserPoolUserToGroupAttachment`.
- **Clients:**
  - **M2MClient** — `client_credentials` flow with secret, scoped to `invoke`.
  - **UserClient** — `USER_PASSWORD_AUTH` + `REFRESH_TOKEN_AUTH` flows without secret, scoped to all custom scopes plus `openid`, `email`, `profile`.
- User passwords are set via `make cognito.set-passwords` in the `security/` directory.

### Scope-Based Frontend Authorization

The frontend enforces scope-based access control derived from Cognito group membership:

| Group | Scopes | Sidebar Access | Write Access |
|-------|--------|----------------|--------------|
| `super-admins` | All 15 scopes including `invoke` | All pages | All actions |
| `demo-admins` | All read/write scopes plus `invoke` | All admin pages | All admin actions (tag-scoped data) |
| `security-admins` | security:read, security:write | Security | Security actions |
| `memory-admins` | memory:read, memory:write | Memory | Memory actions |
| `mcp-admins` | mcp:read, mcp:write | MCP Servers | MCP actions |
| `a2a-admins` | a2a:read, a2a:write | A2A Agents | A2A actions |
| `users` | invoke | Agent invocation only | Invoke only (tag-filtered resources) |

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
- Backend: Agent registration, metadata retrieval, SSE invocation with real-time streaming, CloudWatch log retrieval (stream browsing + session-filtered with pagination), integrated cold-start latency calculation, SQLite persistence with session/invocation separation, session liveness tracking via idle timeout heuristic, active session count per agent.
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
- Persona-based frontend navigation: Platform Catalog, Agents, Security Admin, Memory, MCP Servers, A2A Agents.
- Platform Catalog page with sections for agents, memory resources, MCP servers, and A2A agents. Card/table view toggle with cards as default.
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
- **AgentCore Memory Integration:** `MemoryHook` is a Strands `HookProvider` that registers `BeforeInvocationEvent` and `AfterInvocationEvent` callbacks for automatic memory operations. Before invocation: retrieves memory records via `retrieve_memory_records` using the last user message as search query. After invocation: creates events in memory for each message in the conversation via `create_event`. Emits `LOOM_MEMORY_TELEMETRY: retrievals=N, events_sent=M` structured log line for cost tracking (always emitted, even when counters are 0). All operations logged at INFO level for visibility. Graceful degradation: AccessDeniedException and other errors are caught and logged without interrupting the agent invocation.

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
- Cognito User Pool IaC: resource server with custom scopes (15 scopes: `invoke`, `catalog:read/write`, `agent:read/write`, `memory:read/write`, `security:read/write`, `settings:read/write`, `mcp:read/write`, `a2a:read/write`), user groups (7 groups: `super-admins`, `demo-admins`, `security-admins`, `memory-admins`, `mcp-admins`, `a2a-admins`, `users`), users with group assignments, password policy (12+ chars, no symbols required).
- Security makefile with `cognito.set-passwords` target for setting permanent user passwords.
- Scope-based frontend authorization: `AuthContext` extracts `cognito:groups` from the ID token, maps groups to scopes, and exposes `hasScope()`. Sidebar items are conditionally rendered based on user scopes. Write operations (add, edit, delete buttons) are disabled or hidden via a `readOnly` prop when the user lacks `*:write` scopes. When auth is not configured, all scopes are granted.

### Phase 7 — Resource Tagging *(Complete)*
- Configurable tag policy system: `TagPolicy` model with key, default_value, required, and show_on_card fields. Two-tier designation: `platform:required` (keys starting with `loom:`) and `custom:optional` (all others). Designation is computed from the key, not stored.
- Tag policy CRUD API under `/api/settings/tags` with default seed data (loom:application, loom:group, loom:owner).
- Tag profile system: `TagProfile` model for named sets of tag values. CRUD API under `/api/settings/tag-profiles`. Profiles satisfy required tag policies and are applied to all deployed resources.
- `ResourceTagFields` shared component: fetches tag policies and profiles, renders a profile dropdown with `sessionStorage` persistence (`loom:selectedTagProfileId`), resolves tags from the selected profile + policy defaults, and passes resolved tags to the parent form via `onChange`. Used by both the agent deploy form and memory create form.
- Unified tag resolution: for each policy, use user-supplied value → fall back to `default_value` → error if required and missing. Required tag validation before deployment — missing tags return HTTP 400.
- All AWS resources that support tags (AgentCore runtimes, runtime endpoints, IAM execution roles, managed roles, memory resources) receive the resolved tags.
- Memory resources: `tags` column added to the `memories` table. Tags are resolved from tag policies + selected profile on creation, passed to AWS `create_memory`, and stored locally. Imported memories fetch existing tags from AWS via `list_tags_for_resource` and enforce tag policies (missing required tags default to "missing").
- Registered agents fetch existing tags from AWS via `list_tags_for_resource` and enforce tag policies (missing required tags default to "missing").
- Resolved tags stored on Agent and Memory records as JSON columns, included in API responses.
- Agent and memory cards display tag badges (`variant="secondary"`) for tags with `show_on_card=true`.
- All listing pages (Platform Catalog, Agents, Memory) provide tag-based filtering with multi-select dropdowns (checkbox-based), AND logic, clear button, and item count display.
- Settings persona: new sidebar entry accessible to all scopes. `SettingsPage` provides tag profile CRUD. `*:write` scopes can create, edit, and delete profiles; `*:read` scopes can only view. Tag value inputs enforce a 128-character maximum length.
- 29 backend tests covering tag policy CRUD, tag designation, tag resolution, validation, and agent tag storage.

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

### Phase 9 — Tagging Page and Custom Tags *(Complete)*
- Dedicated Tagging page: tag profile management extracted from Settings into a new `TaggingPage` component with its own sidebar entry (Tags icon, visible to all scopes). Drag-to-reorder via `SortableCardGrid` for both tag policies and tag profiles.
- Custom tag policy management: `platform:required` tags shown as read-only cards with lock icon (top-right) and designation badge; `custom:optional` tags are editable (pencil icon) and deletable (Trash2 icon, top-right) with designation badge. "Add Custom Tag" form with key, default value, and show-on-card toggle. Custom tags are always `required=false`.
- Tag profile form with two sections: **Platform (Required)** with mandatory input fields for all `platform:required` tags, and **Custom (Optional)** with checkbox-to-enable pattern per custom tag (checking reveals a value input, unchecking removes from profile).
- Simplified tag model: removed `source` (build-time/deploy-time) distinction. Tag resolution: for each policy, use user-supplied value → fall back to `default_value` (only for required policies) → error if required and missing. Custom/optional tags only appear when the profile explicitly sets them.
- Progressive disclosure tag filtering: on Catalog, Agents, and Memory pages, required tag filters are always shown; custom tag filters are hidden until added via a custom `AddFilterDropdown` component. Filter bar layout: required filters → eyeball toggle → activated custom filters → "custom filters" Add dropdown → Clear filters → count. All label rows use fixed `h-4` height for visual alignment. Filter state (`tagFilters` and `activeCustomFilterKeys`) persisted to `localStorage` per page and survives navigation.
- Custom tag show/hide toggle: Eye/EyeOff button on filter bars (positioned left of custom filter dropdown) toggles visibility of custom tags on agent and memory cards. Preference persisted to `localStorage` (`loom:showCustomTags`).
- Card layout consistency: Trash2 icon for delete across all cards (agents, memory, roles, authorizers, tags). Edit/delete icons positioned top-right as lightweight `<button>` elements. Delete confirmation right-aligned at card bottom.
- Table consistency: all tables use `table-fixed` with matching percentage-based column widths (30%/12%/14%/14%/14%/16%). Action columns removed from all tables — delete/refresh operations are card-view only.
- Security card consistency: RoleManagementPanel and AuthorizerManagementPanel cards use the same top-right icon pattern (pencil + trash for authorizers, trash for roles). Tags aligned with content via `ml-6` offset.
- Backend: `tags` column added to `managed_roles` and `authorizer_configs` tables. IAM role import fetches tags via `list_role_tags`. `environment.sh.example` files added for backend and security directories.
- Pydantic error handling: `apiFetch` handles array-style `detail` responses (Pydantic validation errors) by joining `msg` fields.
- Settings page simplified to display preferences only (theme + timezone).

### Phase 10 — Fine-Grained Permissions Scoping *(Complete)*
- Expanded scope model from 7 scopes to 15: `invoke`, `catalog:read/write`, `agent:read/write`, `memory:read/write`, `security:read/write`, `settings:read/write`, `mcp:read/write`, `a2a:read/write`.
- Restructured Cognito groups from 5 to 7: `super-admins`, `demo-admins`, `security-admins`, `memory-admins`, `mcp-admins`, `a2a-admins`, `users`.
- Updated user-to-group assignments: `admin` → super-admins, `demo-admin-1`/`demo-admin-2` → demo-admins, `security-admin` → security-admins, `integration-admin` → memory-admins + mcp-admins + a2a-admins, `demo-user-1`/`demo-user-2` → users.
- Backend OAuth2 enforcement: every router endpoint guarded by `require_scopes()` dependency with OpenAPI scope annotations via `Security()`. `get_current_user` validates JWT, extracts `cognito:groups`, and derives scopes via `GROUP_SCOPES` mapping. Returns 401 for missing/invalid tokens, 403 for insufficient scopes.
- Group-based invoke restriction: `super-admins` can invoke any agent; `demo-admins` and `users` can only invoke agents whose `loom:group` tag matches their own group.
- Token forwarding for agent invocation: user's login token is forwarded to OAuth-protected agents (shared Cognito pool). Token priority: manual bearer token > M2M credential > user login token > agent config M2M > SigV4 (no token).
- Auto-include user app client ID (`LOOM_COGNITO_USER_CLIENT_ID`) in agent authorizer `allowedClients` on deploy, so user login tokens are accepted by the agent runtime.
- Credential dropdown shows context-aware options: OAuth agents show user's token (default), M2M credentials, and manual token; non-OAuth agents show "No credentials (SigV4)" only.
- Auto-select newly created session in the session dropdown after an invocation.
- Automatic 401 token refresh: `apiFetch` intercepts 401 responses, refreshes the Cognito access token, and retries the request transparently.
- Re-fetch agent list after authentication to prevent empty state on hard refresh.
- Frontend `AuthContext` and `App.tsx` updated with matching `GROUP_SCOPES` mapping. View As selector changed from group-based to user-based (admin, demo-admin-1, demo-admin-2, etc.) for more realistic role simulation.
- Group restriction on `ResourceTagFields` and `MemoryManagementPanel`: demo-admins only see tag profiles matching their group, and `loom:group` tag is forced to their group value.
- Sidebar overflow fix: sidebar and main content use proper scroll containment.
- Bypass mode preserved: when `LOOM_COGNITO_USER_POOL_ID` is not set, all scopes are granted (local development).
- 16 new scope enforcement tests + 2 pre-existing test fixes.

### Phase 11 — JSON Import/Export and Agent Deletion Polling *(Complete)*
- Shared `JsonConfigSection` component for collapsible JSON import/export on forms. Encapsulates toggle, textarea, and Apply/Export/Cancel buttons.
- Agent deploy form (`AgentRegistrationForm`): refactored to use `JsonConfigSection`. Export serializes form state to JSON with human-readable names (model ID, role name, authorizer name, tag profile name). Import maps `name`, `description`, `persona`, `instructions`, `behavior`, `model`, `role`, `network_mode`, `authorizer`, `tags`.
- Memory create form (`MemoryManagementPanel`): added `JsonConfigSection` with import/export. Import maps `name`, `description`, `event_expiry_duration` (validated 3-364), `tags` (tag profile name lookup), `strategies` (array with strategy_type validation against semantic/summary/user_preference/episodic/custom). Export serializes current form state; empty/default fields omitted. Memory namespace changed from array with TagInput to singular string textbox for simpler UX and import compatibility.
- Round-trip capable: exported JSON is valid input for import, reproducing the same form state.
- Consistent visual behavior across both forms: same collapse/expand toggle, textarea styling, and button layout.
- Agent async deletion polling: agent DELETE endpoint returns `AgentResponse` with DELETING status (instead of 204) when `cleanup_aws=true` and agent has a runtime. Frontend `useAgents` hook polls DELETING agents at 5-second intervals; on 404, calls the new purge endpoint (`DELETE /api/agents/{id}/purge`) to clean up locally. Agent cards show spinner and elapsed timer during deletion, matching the memory deletion pattern. New `deleteStartTimes` state tracks deletion initiation timestamps for accurate timer display.

### Phase 12 — Card Sorting and Sort Controls *(Complete)*
- Default alphabetical sorting (case-insensitive, A-Z) for all card grids on initial load when no persisted custom order exists.
- Standalone `SortButton` component (A-Z / Z-A toggle) placed inline with section headers, next to "Add" buttons. Sort preference persisted to localStorage per grid (`loom-sort-${storageKey}`).
- After drag-to-reorder, custom order takes precedence and sort direction is cleared.
- New items not in persisted order are sorted alphabetically among themselves and appended after persisted items.
- `SortableCardGrid` uses controlled `sortDirection` prop with `onSortDirectionChange` callback. Exported helpers: `loadSortDirection()`, `saveSortDirection()`, `toggleSortDirection()`, `SortButton`, `SortDirection`.
- `SortableTableHead` component for clickable sortable table column headers with arrow indicators (ArrowUp/ArrowDown). `sortRows()` helper for generic multi-column sorting (string and numeric).
- Table view column sorting: pages with table views (CatalogPage, AgentListPage, MemoryManagementPanel) support click-to-sort on any column header.
- Security admin panels (RoleManagementPanel, AuthorizerManagementPanel, PermissionRequestsPanel) converted from stacked `<div className="space-y-2">` layouts to `SortableCardGrid` with drag-to-reorder and alphabetical sort controls. AuthorizerManagementPanel and PermissionRequestsPanel use responsive grid (`md:grid-cols-2 lg:grid-cols-3`); RoleManagementPanel uses full-width single-column layout since role cards contain long ARNs and expandable policy documents.
- All existing card grid consumers updated: CatalogPage (agents, memories), AgentListPage (agents), MemoryManagementPanel (memories), TaggingPage (policies, profiles).

### Phase 13 — MCP Server Integration *(Complete)*
- Backend: `McpServer`, `McpTool`, `McpServerAccess` ORM models with full CRUD API under `/api/mcp/servers`. MCP server registration with name, endpoint URL, and transport type (SSE or Streamable HTTP). OAuth2 authentication configuration with well-known URL, client ID, client secret (write-only), and scopes. Conditional validation: OAuth2 fields required when auth_type is `oauth2`. Client secrets never returned in GET responses (`has_oauth2_secret` flag instead).
- Tool discovery: `GET /api/mcp/servers/{id}/tools` returns cached tools, `POST /api/mcp/servers/{id}/tools/refresh` fetches from server (stub implementation). Each tool stores name, description, and input schema (JSON).
- Access control: `GET/PUT /api/mcp/servers/{id}/access` manages per-persona access rules. Access levels: `all_tools` (any tool including future ones) or `selected_tools` (specific tool names). Deny by default — no rule means no access.
- Connection test: `POST /api/mcp/servers/{id}/test-connection` validates OAuth2 configuration (stub for actual MCP connectivity).
- Frontend: `McpServersPage` with card/table view toggle, sortable columns, server detail view with Tools/Access tabs. `McpServerForm` with progressive OAuth2 field disclosure. `McpToolList` with refresh, collapsible input schema display. `McpAccessControl` with per-agent toggle, all_tools/selected_tools radio, individual tool checkboxes.
- MCP Servers sidebar item activated (no longer disabled/coming soon). Scope-gated by `mcp:read`/`mcp:write`.
- Agent deployment with MCP server selection: multi-select dropdown on deploy form allows selecting MCP servers from catalog. Selected servers attached to agent during deployment.
- OAuth2 credential provider creation: for OAuth2-enabled MCP servers, backend calls AgentCore `create_oauth2_credential_provider` API using `CustomOauth2` vendor with `discoveryUrl` from server configuration. Credential providers auto-named `{agent_name}-mcp-{server_name}`. Credential provider creation uses exponential backoff retry (4 retries, delays 2s/4s/8s/16s). Deployment fails with credential_creation_failed status if all retries are exhausted.
- Background deployment with progressive status updates: deploy endpoint returns immediately with `creating_credentials` status. Background task progresses through `creating_role`, `building_artifact`, `deploying` phases with DB updates. Frontend polls at 2-second intervals.
- Frontend progressive deployment status display: agent cards show human-readable status messages (Creating credential provider, Creating IAM role, Building artifact, Deploying runtime, Completing deployment, Finalizing endpoint) with spinner and elapsed timer.
- Smart polling optimization: frontend skips AWS API calls during `creating_credentials`, `creating_role`, and `building_artifact` phases (local operations only), reducing unnecessary backend load.
- Credential provider cascade delete: when agents are deleted, associated OAuth2 credential providers are automatically cleaned up via AgentCore API.
- Agent runtime deferred MCP client initialization: OAuth2 MCP clients are initialized at invocation time (not handler startup) since workload tokens are only available during active requests.
- Agent runtime `_OAuth2Auth` httpx handler: exchanges ephemeral workload token for downstream OAuth2 access token via AgentCore Identity service M2M flow. Workload token retrieved from `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` environment variable.
- Agent deletion with background polling: delete endpoint returns `DELETING` status. Background task polls AgentCore until runtime deletion completes, then purges local DB record. Endpoint status badge hidden during deletion.
- 25 backend tests covering all CRUD operations, validation, secret exclusion, OAuth2 conditional fields, tools, access rules, and cascade delete.

### Phase 14 — A2A Agent Integration *(Complete)*
- Backend: `A2aAgent`, `A2aAgentSkill`, `A2aAgentAccess` ORM models with full CRUD API under `/api/a2a/agents`. A2A agent registration by base URL with automatic Agent Card fetching from `<base_url>/.well-known/agent.json`. Agent Card data cached locally: name, description, version, provider, capabilities, authentication schemes, input/output modes, and raw JSON. Skills parsed and stored in a separate table for queryability.
- OAuth2 authentication configuration: well-known URL, client ID, client secret (write-only), and scopes. Conditional validation: OAuth2 fields required when auth_type is `oauth2`. Client secrets never returned in GET responses (`has_oauth2_secret` flag instead).
- Agent Card endpoints: `GET /api/a2a/agents/{id}/card` returns cached raw Agent Card JSON. `POST /api/a2a/agents/{id}/card/refresh` re-fetches from remote agent, updates all cached fields and syncs skills. Failed refresh preserves existing cached data.
- Skills endpoint: `GET /api/a2a/agents/{id}/skills` returns skills parsed from the Agent Card. Skills synced on registration and on card refresh (add new, remove stale).
- Access control: `GET/PUT /api/a2a/agents/{id}/access` manages per-persona access rules. Access levels: `all_skills` (any skill including future ones) or `selected_skills` (specific skill IDs). Deny by default.
- Connection test: `POST /api/a2a/agents/{id}/test-connection` acquires OAuth2 token if configured and fetches the Agent Card.
- Agent deployment with A2A integration: multi-select dropdown on deploy form allows selecting A2A agents from catalog. Selected agents attached to agent during deployment. OAuth2-enabled A2A agents get credential providers created with exponential backoff retry. Credential provider names follow pattern `loom-{agent_name}-a2a-{a2a_name}`. Deployment fails with `credential_creation_failed` status if credential provider creation exhausts retries.
- Agent deployment with memory integration: multi-select dropdown on deploy form allows selecting memory resources from catalog. Selected memory IDs and names passed in `AGENT_CONFIG_JSON` under `integrations.memory.resources`.
- A2A runtime client (`agents/strands_agent/src/integrations/a2a_client.py`): `_AuthenticatedA2AAgent` subclass of the Strands SDK `A2AAgent` for OAuth2-protected A2A endpoints. Injects OAuth2 Bearer tokens via AgentCore Identity service into both agent card fetches and message sending. Handles both SSE (`text/event-stream`) and plain JSON responses. Falls back from `message/stream` to `message/send` on "Method not found". Buffers `Message` events and yields them after `Task` events so `stream_async` picks the content-bearing `Message` as `last_complete_event`. Each enabled A2A agent in the configuration is wrapped as a `@tool` function that the orchestrating agent can invoke during conversation.
- Agent deletion cascade: credential providers for both MCP and A2A integrations are cleaned up. Explicit session/invocation deletion in all delete paths (immediate, background, purge) as safety net alongside ORM cascades.
- Frontend: `A2aAgentsPage` with card/table view toggle, sortable columns, agent detail view with Agent Card/Access tabs. `A2aAgentForm` with base URL input and progressive OAuth2 field disclosure. `A2aAgentCardView` with structured display of capabilities (enabled/disabled badges), authentication schemes, input/output modes, and skills list. `A2aSkillList` with expandable skill cards showing tags, examples, and mode overrides. `A2aAccessControl` with per-persona toggle, all_skills/selected_skills radio, individual skill checkboxes with descriptions.
- A2A Agents sidebar item activated (no longer disabled/coming soon). Scope-gated by `a2a:read`/`a2a:write`.
- Frontend state management: clearing stale session/invocation state on agent selection and deletion. `useSessions` hook clears sessions immediately when agent changes before fetching new data.
- Frontend status display: `credential_creation_failed` deployment status mapped to destructive badge variant.
- JSON import/export: agent deploy form supports `a2a_agents` and `memories` arrays (names) in JSON configuration alongside `mcp_servers`.
- 26 backend tests covering CRUD operations, Agent Card fetching, skill sync, card refresh, secret exclusion, OAuth2 validation, access rules, and cascade delete.

### Phase 15 — Token Usage Tracking and Cost Dashboard *(Complete)*
- Backend schema: `input_tokens`, `output_tokens`, `estimated_cost`, `compute_cost`, `compute_cpu_cost`, `compute_memory_cost`, `idle_timeout_cost`, `idle_cpu_cost`, `idle_memory_cost`, `memory_retrievals`, `memory_events_sent`, `memory_estimated_cost`, `stm_cost`, `ltm_cost`, `cost_source` columns on the `invocations` table via SQLAlchemy migration (`_migrate_add_columns`).
- Token estimation: 4 characters per token heuristic used since AgentCore doesn't expose token counts directly. Applied to both prompt and response text.
- Cost calculation: `(input_tokens / 1000 * input_price_per_1k_tokens) + (output_tokens / 1000 * output_price_per_1k_tokens)` using per-model pricing data.
- Model pricing metadata: `SUPPORTED_MODELS` extended with `input_price_per_1k_tokens`, `output_price_per_1k_tokens`, and `pricing_as_of` fields for all models (Anthropic and Amazon).
- AgentCore Runtime pricing constant: `AGENTCORE_RUNTIME_PRICING` tracks CPU ($0.0895/vCPU-hour), Memory ($0.00945/GB-hour), default vCPU (1), default memory (0.5 GB), and default idle timeout (900 seconds).
- View-time cost recomputation: Runtime CPU and memory costs are recomputed from `client_duration_ms` at view time using current pricing defaults (1 vCPU, 0.5 GB), so changing defaults retroactively affects all historical data. `_apply_view_time_costs()` applies the I/O wait discount to CPU costs. `_backfill_idle_costs()` always recomputes idle costs from session gaps to correct stale values.
- CPU I/O Wait Discount: Single configurable site setting (`cpu_io_wait_discount`, default 75%) applied universally to runtime CPU costs across both estimates and actuals. Configurable on the Settings page. Stored as integer percentage (0-99).
- Cost estimation formulas: `Runtime CPU = hours × 1 vCPU × $0.0895 × (1 − I/O wait%)`, `Runtime Mem = hours × 0.5 GB × $0.00945`, `Idle Mem = idle_seconds × 0.5 GB × $0.00945 / 3600`.
- New endpoints: `GET /api/agents/models/pricing` returns models with pricing metadata; `GET /api/dashboard/costs` provides estimated cost aggregation with group filtering, time-range filtering (7d/30d/90d/all), and per-agent breakdown; `POST /api/dashboard/costs/actuals` pulls actual runtime costs from CloudWatch usage logs.
- CloudWatch log retrieval strategies: (1) stream-name matching for session-specific streams (fetches all events), (2) filterPattern fallback for shared streams. Both use nextToken pagination for complete data retrieval.
- Cost dashboard sections: **Estimated Costs** table with per-agent breakdown (Model Tokens, AgentCore Runtime CPU+Mem, AgentCore Memory STM+LTM, Per Invoke, Total) using two-row pattern (summary + detail sub-row). **Actual Costs for Runtime** table with per-session breakdown (Agent, Session, Events, Runtime CPU, Runtime Memory, Total) pulled from CloudWatch usage logs. Actuals are cached in module-level state to persist across page navigation.
- Actuals session filtering: Only sessions tracked in Loom's `invocation_sessions` table are shown in the actuals table, filtering out external invocations against the same runtime.
- Actuals aggregation: CloudWatch usage log events (1-second granularity) are aggregated by `(agent_name, session_id)` tuple from `attributes.agent.name` and `attributes.session.id`. Timestamps normalized from epoch milliseconds or ISO strings to UTC ISO 8601.
- Cost summary in responses: `AgentResponse` includes `cost_summary` field with `total_input_tokens`, `total_output_tokens`, `total_model_cost`, `total_runtime_cost`, `total_memory_cost`, `total_cost`, and `total_invocations`.
- SSE streaming: `session_end` event includes token counts and estimated cost for immediate display after invocation completes.
- Settings page: CPU I/O Wait Discount input with description and save-on-blur behavior.
- Database integrity: `PRAGMA foreign_keys=ON` added to all test engines for proper SQLite FK enforcement. Explicit cascade delete for invocations before sessions to prevent FK constraint violations.
- Frontend invocation metrics: InvocationTable expanded to 7 columns — Client Invoke, Agent Start, Cold Start, Duration, Input Tokens, Output Tokens, Est. Cost — all displayed in a single row.
- Frontend agent cards: cost badge displayed when `total_estimated_cost > 0`. READY status badge hidden to reduce clutter. Memory cards hide ACTIVE status badge.
- Frontend cost dashboard: new `CostDashboardPage` with time-range selector (7d/30d/90d/All), summary cards (Total Cost, Model Tokens, Runtime, Memory), estimated costs table with sortable columns and methodology formulas, actual costs section with Pull Actuals button (loading timer) and per-agent session-level breakdown.
- Costs sidebar item: new navigation entry (above Settings) visible to users with `catalog:read` scope.

### Phase 16 — Advanced Operations
- Real-time metrics auto-refresh.
- Multi-agent comparison views.
- Alert configuration.

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
