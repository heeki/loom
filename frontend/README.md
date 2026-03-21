# Loom Frontend

Single-page React application for managing, deploying, and invoking Bedrock AgentCore agents with real-time streaming, latency measurement, session liveness tracking, memory resource management, MCP server management, A2A agent management, security administration, resource tag management, tag profile management, cost estimation dashboard, actual runtime cost analysis, an admin dashboard with platform usage analytics, and an end-user chat interface.

## Prerequisites

- Node.js 18+
- npm
- Backend API running on `http://localhost:8000`

## Quick Start

```bash
# Install dependencies
make install

# Start development server (localhost:5173)
make dev

# Type-check without emitting
make typecheck

# Production build
make build

# Preview production build
make preview
```

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite 6 |
| UI | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS v4 |
| Theme | 10 themes (5 light + 5 dark) — see Settings |
| Streaming | `fetch` + `ReadableStream` (POST-based SSE) |
| Notifications | Sonner |

## Architecture

### Theme

The app supports 10 color themes, managed by `ThemeContext` with localStorage persistence:

- **Light:** Ayu Light, Catppuccin Latte (default), Everforest Light, Rosé Pine Dawn, Solarized Light
- **Dark:** Catppuccin Mocha, Dracula, Gruvbox, Nord, Tokyo Night

Theme and timezone preferences are configured on the Settings page. Colors are mapped to shadcn CSS variables in `src/index.css` using CSS class selectors per theme.

### Persona-Based Navigation

The sidebar provides access to persona-based workflows:

| Persona | Icon | Description |
|---------|------|-------------|
| **Platform Catalog** | BookOpen | Browse agents, memory resources, MCP servers, A2A agents (default) |
| **Agents** | Bot | Deploy new agents or import existing ones |
| **Memory** | Brain | Create and manage AgentCore Memory resources |
| **Security Admin** | Shield | Manage IAM roles, authorizer configs, credentials, permission requests |
| **MCP Servers** | Network | Register and manage MCP servers with OAuth2 auth, tool discovery, and access control |
| **A2A Agents** | Users | Register and manage A2A agents with OAuth2 auth, Agent Card display, and access control |
| **Costs** | DollarSign | Cost dashboard with estimated costs, actual runtime costs from CloudWatch, and cost settings |
| **Settings** | Settings | Manage display preferences (theme, timezone) and cost estimation settings (CPU I/O wait discount) |
| **Admin Dashboard** | BarChart3 | Platform usage analytics: login tracking, action tracking, page navigation, per-session drill-down (super-admins only) |

**End-user chat layout:** Users in the `t-user` Cognito group (without `t-admin`) see a dedicated `ChatPage` instead of the admin sidebar. The chat layout provides a focused chat interface with agent selection, conversation history with immediate tab creation on `session_start`, streaming responses scoped to the active conversation, markdown rendering with collapsible JSON blocks, and a memory panel — with no admin navigation items exposed.

The admin sidebar includes a View As dropdown (Eye icon) to preview specific user experiences including end-users (`demo-user-*`, `test-user`). Selecting an end-user persona switches to the `ChatPage` layout so admins can verify the end-user experience. A banner indicates the preview mode. Theme and timezone are configured on the Settings page. Each listing page has a card/table view toggle; the selection persists per-page across persona switches.

### Drill-Down Navigation

Within the Catalog persona, state-driven drill-down:

```
Catalog → Agent Detail → Session Detail
```

No router library — view selection is based on `selectedAgentId` and `selectedSessionId` state in `App.tsx`.

### Source Layout

```
src/
├── api/          # Typed API client and endpoint functions
│   ├── agents.ts      # Agent CRUD, models, roles, cognito pools, defaults
│   ├── invocations.ts # Session queries + SSE stream consumer
│   ├── logs.ts        # CloudWatch log queries
│   ├── a2a.ts         # A2A agent CRUD, card refresh, access control
│   ├── mcp.ts         # MCP server CRUD, tool discovery, access control
│   ├── memories.ts    # Memory resource CRUD + refresh
│   ├── security.ts    # Roles, authorizers, credentials, permissions
│   ├── settings.ts    # Tag policy CRUD operations
│   ├── audit.ts       # Admin audit API: login/action/pageview recording, session/summary queries, trackAction utility
│   └── types.ts       # TypeScript interfaces mirroring backend models
├── contexts/     # React contexts (auth, timezone preference)
│   ├── ThemeContext.tsx   # Theme provider with 10 themes and localStorage persistence
├── hooks/        # Custom React hooks for data fetching
│   ├── useA2aAgents.ts   # A2A agent list with auto-fetch, CRUD
├── components/   # Application components + shadcn ui/ primitives
│   ├── AgentCard.tsx              # Agent card with refresh + eraser icon deletion + overlay confirmation
│   ├── SortableCardGrid.tsx       # Drag-to-reorder card grid with @dnd-kit, alphabetical sort, SortButton
│   ├── SortableTableHead.tsx      # Clickable sortable table column headers
│   ├── AgentRegistrationForm.tsx  # Import (ARN + model) and Deploy (full form) tabs
│   ├── JsonConfigSection.tsx     # Shared collapsible JSON import/export section
│   ├── AuthorizerManagementPanel.tsx # Authorizer config and credential management
│   ├── MemoryCard.tsx             # Memory resource card with status, tags, refresh, delete
│   ├── McpServerForm.tsx           # MCP server create/edit form with OAuth2 disclosure
│   ├── McpToolList.tsx             # MCP tool list with refresh and JSON schema display
│   ├── McpAccessControl.tsx        # Per-persona access toggle with tool selection
│   ├── A2aAgentForm.tsx          # A2A agent create/edit form with OAuth2 disclosure
│   ├── A2aAgentCardView.tsx      # Agent Card display with capabilities and skills
│   ├── A2aSkillList.tsx          # Expandable skill cards
│   ├── A2aAccessControl.tsx      # Per-persona access to A2A agent skills
│   ├── MemoryManagementPanel.tsx  # Memory resource create form + card/table list + tag filters
│   ├── ResourceTagFields.tsx      # Shared tag profile selector + tag resolution
│   ├── InvokePanel.tsx            # Qualifier, credential selector, model badge, prompt
│   ├── DeploymentPanel.tsx        # Deployment details for deployed agents
│   └── ui/
│       ├── searchable-select.tsx  # Searchable dropdown with group headers
│       └── multi-select.tsx       # Checkbox-based multi-select dropdown
├── pages/        # Page-level view components
│   ├── CatalogPage.tsx         # Platform Catalog: agents, memory, MCP, A2A sections
│   ├── AgentListPage.tsx       # Agents: Deploy/Import form + agent grid
│   ├── AgentDetailPage.tsx     # Sessions, invoke, latency, response
│   ├── SecurityAdminPage.tsx   # Roles, authorizers, credentials, permissions
│   ├── MemoryManagementPage.tsx # Memory resource management
│   ├── McpServersPage.tsx      # MCP server management with tool/access tabs
│   ├── A2aAgentsPage.tsx      # A2A agent management with card/access tabs
│   ├── SettingsPage.tsx        # Display preferences + cost estimation settings
│   ├── SessionDetailPage.tsx   # Session metadata, invocations, logs
│   └── AdminDashboardPage.tsx  # Admin-only: global user filter, summary cards, charts, Sessions/Actions/Page Views tabs
├── lib/          # Shared utilities (cn(), format helpers, status mapping, error mapping)
├── App.tsx       # Root: auth gate + persona sidebar + navigation
└── main.tsx      # Entry point
```

### Authentication

When Cognito is configured, users must sign in before accessing the app. Configuration requires:
- **Backend:** `LOOM_COGNITO_USER_POOL_ID` in `backend/etc/environment.sh`
- **Frontend:** `VITE_COGNITO_USER_CLIENT_ID` in `frontend/.env`

The login page handles the `USER_PASSWORD_AUTH` flow and `NEW_PASSWORD_REQUIRED` challenge. Tokens are stored in memory only (not persisted across page reloads). The access token is automatically attached to all API requests. The `.env` file is the standard Vite mechanism for environment variables — any variable prefixed with `VITE_` is exposed via `import.meta.env`.

The `AuthContext` also generates a `browserSessionId` (UUID via `crypto.randomUUID()`) on login, stored in React state only (resets on page refresh). This is used for audit tracking — all login, action, and page view events include this session ID so that multiple users sharing the same Cognito account can be distinguished by session. A `recordLogin` event is fired automatically on successful authentication.

The `AuthContext` also provides scope-based authorization using a two-dimensional group architecture. User groups are extracted from the `cognito:groups` claim in the ID token and mapped to 19 scopes via `GROUP_SCOPES` (matching the backend mapping exactly). Type groups (`t-admin`, `t-user`) determine UI layout; resource groups (`g-admins-*`, `g-users-*`) determine access. Key groups: `g-admins-super` (all scopes), `g-admins-demo` (read-only to all pages + write to demo resources), `g-admins-security`, `g-admins-memory`, `g-admins-mcp`, `g-admins-a2a`, `g-users-demo/test/strategics` (invoke + group-filtered read). Sidebar items are conditionally rendered based on scopes, and write operations are disabled via a `readOnly` prop for users without the corresponding `*:write` scope. When auth is not configured, all scopes are granted.

### API Layer

- `api/client.ts` — `apiFetch<T>()` wrapper with `ApiError` class, automatic auth token injection, and 401 auto-refresh (transparent token refresh and request retry)
- `api/auth.ts` — Cognito auth API: `fetchAuthConfig`, `initiateAuth`, `respondToNewPasswordChallenge`, `refreshTokens`
- `api/agents.ts` — Agent operations: list, get, register (with optional model_id), deploy, delete (with optional AWS cleanup), refresh, redeploy, fetchRoles, fetchCognitoPools, fetchModels, fetchDefaults
- `api/invocations.ts` — Session queries + `invokeAgentStream()` SSE consumer (supports `credential_id`, includes auth header)
- `api/logs.ts` — CloudWatch log queries with cache-busting refresh support
- `api/memories.ts` — Memory resource operations: create, import, list, get, refresh, delete, purge
- `api/security.ts` — Security admin operations: managed roles, authorizer configs, authorizer credentials, permission requests
- `api/a2a.ts` — A2A agent operations: CRUD, test connection, card retrieval/refresh, skills, access rules
- `api/mcp.ts` — MCP server operations: CRUD, test connection, tool discovery/refresh, access rule management
- `api/settings.ts` — Tag policy and tag profile operations: list, create, update, delete
- `api/costs.ts` — Cost dashboard API: `fetchCostDashboard` (estimated costs), `fetchCostActuals` (actual runtime + memory costs from CloudWatch logs), `fetchModelPricing`
- `api/traces.ts` — Trace API: `getSessionTraces` (list traces for a session), `getTraceDetail` (full trace with spans)
- `api/types.ts` — TypeScript interfaces including AgentResponse (with `model_id`, `tags`), SSESessionStart (with `has_token`, `token_source`), AuthorizerCredential, ManagedRole, PermissionRequestResponse, MemoryResponse (with `tags`), MemoryCreateRequest (with `tags`), MemoryStrategyRequest, McpServer, McpTool, McpServerAccess, TagPolicy, TagPolicyCreateRequest, TagPolicyUpdateRequest, TagProfile, TagProfileCreateRequest

### Hooks

- `useAgents()` — Agent list with auto-fetch, CRUD actions, register (with optional modelId), async deletion polling (DELETING → 404 → purge)
- `useSessions(agentId)` — Session list that re-fetches on agent change
- `useInvoke(authorizerName?)` — Streaming state management with module-level store (survives component unmount/remount), `AbortController` for cancellation, supports credential_id and bearer_token, provides friendly error messages with authorizer-specific hints. `clearInvokeState()` preserves the subscriber set so the component stays subscribed across "New Conversation" resets.
- `useLogs()` — On-demand session log fetching with `noCache` support for cache-busting refresh, vended log source management, stream log retrieval
- `useTraces()` — Trace list and detail state management with lazy loading
- `useA2aAgents()` — A2A agent list with auto-fetch, CRUD callbacks, toast notifications
- `useMcpServers()` — MCP server list with auto-fetch, CRUD callbacks, toast notifications
- `useDeployment()` — Agent config, credential providers, and integrations

### Key Components

- **SearchableSelect** — Combobox with search, filter, optional group headers (Anthropic/Amazon), and click-outside detection. Searches both label and value fields.
- **AgentCard** — Compact card with two-row header layout, inline badges (including authorizer display), refresh button, Trash2 icon for deletion, overlay confirmation with "Also delete in AgentCore" checkbox. Supports transitional status display (deploying → completing deployment → finalizing endpoint → deleting) with spinner and elapsed timer. Deletion with AWS cleanup shows DELETING state with timer using `deleteStartTime` prop. Displays tag badges for tags marked `show_on_card` in the tag policy.
- **MemoryCard** — Memory resource card with name, status badge, spinner+timer for transitional states (using per-resource timestamps for accurate elapsed time), region/account/expiry metadata, tag badges, refresh and delete buttons with overlay confirmation.
- **JsonConfigSection** — Shared collapsible JSON import/export section used by both agent deploy and memory create forms. Encapsulates toggle, monospace textarea, and Apply/Export/Cancel buttons. Export produces human-readable JSON that is round-trip compatible with import.
- **ResourceTagFields** — Shared component for tag profile selection and tag resolution. Fetches tag policies and profiles, renders a profile dropdown (persisted in `sessionStorage`), resolves tags from the selected profile + policy defaults. Used by both agent deploy and memory create forms.
- **MultiSelect** — Checkbox-based multi-select dropdown with auto-expanding width. Used for tag filtering on all listing pages.
- **InvokePanel** — Qualifier selector, context-aware credential dropdown (OAuth agents: user token / M2M / manual token; non-OAuth: SigV4 only), model ID badge, prompt textarea, invoke/cancel buttons. Auto-selects newly created session. Token indicator shown when invocation uses OAuth.
- **AuthorizerManagementPanel** — Lists authorizer configs with expandable credential management (add/list/delete credentials per config).
- **McpServerForm** — Create/edit form for MCP servers with transport selector (SSE, Streamable HTTP), progressive OAuth2 disclosure (auth_type toggle reveals client ID, secret, token URL, scopes, well-known URL fields), and test connection button in edit mode.
- **McpToolList** — Displays discovered tools for a server with refresh button, collapsible JSON schema display per tool, and empty state guidance.
- **McpAccessControl** — Per-persona access toggle with all_tools/selected_tools radio and individual tool checkboxes. Deny-by-default — personas have no access until explicitly granted.
- **A2aAgentForm** — Create/edit form for A2A agents with base URL input, progressive OAuth2 disclosure, and test connection button.
- **A2aAgentCardView** — Structured Agent Card display: capabilities, authentication schemes, input/output modes, and skills.
- **A2aAccessControl** — Per-persona access control for A2A agent skills with all_skills/selected_skills modes.
- **MemoryManagementPanel** — Create/import form with JSON import/export and strategy configuration (type, name, description, namespace), memory card/table list with status badges (CREATING/ACTIVE/FAILED/DELETING), refresh and delete actions with inline confirmation overlay.
- **LogViewer** — Paginated CloudWatch log display (200 lines/page) with toggleable line numbers and timestamps, log stream selector with timezone-aware timestamps, vended log source selector (runtime APPLICATION_LOGS, runtime USAGE_LOGS, memory APPLICATION_LOGS), and cache-busting refresh support.
- **TraceList** — Trace summary table with columns: Trace ID, Start Time, End Time, Duration, Spans, Events. Clickable rows to select a trace for detailed view.
- **TraceGraph** — Interactive CSS waterfall timeline showing span durations relative to trace start. 8-color palette for span differentiation. Persistent hover detail panel (Span ID, Scope, Duration, Events, Start/End). Left panel: span list with divide styling. Right panel: per-span events with expand/collapse all toggle. Event detail lines: timestamp, span ID link, scope/source.

### Views

| View | Persona | Description |
|------|---------|-------------|
| LoginPage | — | Cognito login + set new password |
| CatalogPage | Platform Catalog | Agents (with multi-select tag filter bar), memory resources (with tag badges), MCP servers, A2A agents sections |
| AgentDetailPage | Platform Catalog | Sessions, invoke, latency, streaming response, deployment details |
| SessionDetailPage | Platform Catalog | Session metadata, invocation timing, tabbed Logs/Traces view with paginated CloudWatch logs, stream selector, vended log sources, and interactive OTEL trace visualization (waterfall timeline) |
| InvocationDetailPage | Platform Catalog | Invocation details, cost breakdown, prompt/response, Traces tab with invocation-scoped trace graph |
| AgentListPage | Agents | Deploy/Import form (with tag profile selector) + agent card/table grid with multi-select tag filters |
| SecurityAdminPage | Security | Roles, authorizers, credentials, permissions |
| MemoryManagementPage | Memory | Memory resource create/import form (with tag profile selector), card/table list with tag badges and multi-select tag filters |
| McpServersPage | MCP Servers | MCP server CRUD, server detail with Tools and Access tabs, card/table views |
| A2aAgentsPage | A2A Agents | A2A agent CRUD, Agent Card detail, Access control tabs |
| CostDashboardPage | Costs | Estimated costs table (per-agent breakdown with methodology formulas), actual costs with Runtime (collapsible agent groups, per-session detail) and Memory (consolidated per-resource) sub-sections, summary cards, time-range selector, sortable columns |
| SettingsPage | Settings | Display preferences (theme, timezone), cost estimation settings (CPU I/O wait discount) |
| AdminDashboardPage | Admin | Global multi-select user filter; summary cards (total logins, page views, actions, duration, most active page); recharts bar charts (logins over time, actions over time, page views by page); tabbed tables: Sessions (with timeline drill-down), Actions (category/type filters), Page Views (page filter); all data filtered by selected users when filter is active |
| ChatPage | End-user | Chat interface for `t-user` group: agent picker (multi-agent) or auto-selected (single agent), conversation history sidebar with immediate tab creation on `session_start` and auto-selection, streaming bubbles scoped to the active conversation (`isCurrentlyStreaming`), markdown rendering with collapsible JSON blocks, session management, conversation removal with audit tracking, memory panel with strategy-based labels |

### Session Liveness

Session liveness is computed server-side using `LOOM_SESSION_IDLE_TIMEOUT_SECONDS` (default 300). The frontend displays:
- **Active session count** on each agent card — cold-start indicator (0 = next invoke is cold)
- **Live status badges** on sessions — color-coded: active (green), expired (muted), streaming/pending (yellow), error (red)

## Configuration

The frontend connects to the backend at `http://localhost:8000`. The backend CORS configuration allows requests from `http://localhost:5173`.

To change the dev server port:

```bash
make dev FRONTEND_PORT=3000
```

## Build

```bash
make build
```

Output is written to `dist/`. Serve with `make preview` or any static file server.
