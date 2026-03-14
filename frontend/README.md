# Loom Frontend

Single-page React application for managing, deploying, and invoking Bedrock AgentCore agents with real-time streaming, latency measurement, session liveness tracking, memory resource management, security administration, resource tag management, and tag profile management.

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
| **Settings** | Settings | Manage tag profiles and configuration |
| **MCP Servers** | Network | Coming soon (disabled) |
| **A2A Agents** | Users | Coming soon (disabled) |

The sidebar also includes a user indicator (when authenticated), admin view-as dropdown (for testing other roles), live clock, and version badge. Theme and timezone are configured on the Settings page. Each listing page has a card/table view toggle; the selection persists per-page across persona switches.

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
│   ├── memories.ts    # Memory resource CRUD + refresh
│   ├── security.ts    # Roles, authorizers, credentials, permissions
│   ├── settings.ts    # Tag policy CRUD operations
│   └── types.ts       # TypeScript interfaces mirroring backend models
├── contexts/     # React contexts (auth, timezone preference)
│   ├── ThemeContext.tsx   # Theme provider with 10 themes and localStorage persistence
├── hooks/        # Custom React hooks for data fetching
├── components/   # Application components + shadcn ui/ primitives
│   ├── AgentCard.tsx              # Agent card with refresh + eraser icon deletion + overlay confirmation
│   ├── SortableCardGrid.tsx       # Drag-to-reorder card grid with @dnd-kit
│   ├── AgentRegistrationForm.tsx  # Import (ARN + model) and Deploy (full form) tabs
│   ├── AuthorizerManagementPanel.tsx # Authorizer config and credential management
│   ├── MemoryCard.tsx             # Memory resource card with status, tags, refresh, delete
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
│   ├── SettingsPage.tsx        # Tag profile management
│   └── SessionDetailPage.tsx   # Session metadata, invocations, logs
├── lib/          # Shared utilities (cn(), format helpers, status mapping, error mapping)
├── App.tsx       # Root: auth gate + persona sidebar + navigation
└── main.tsx      # Entry point
```

### Authentication

When Cognito is configured, users must sign in before accessing the app. Configuration requires:
- **Backend:** `LOOM_COGNITO_USER_POOL_ID` in `backend/etc/environment.sh`
- **Frontend:** `VITE_COGNITO_USER_CLIENT_ID` in `frontend/.env`

The login page handles the `USER_PASSWORD_AUTH` flow and `NEW_PASSWORD_REQUIRED` challenge. Tokens are stored in memory only (not persisted across page reloads). The access token is automatically attached to all API requests. The `.env` file is the standard Vite mechanism for environment variables — any variable prefixed with `VITE_` is exposed via `import.meta.env`.

The `AuthContext` also provides scope-based authorization. User groups are extracted from the `cognito:groups` claim in the ID token and mapped to scopes (`agent:read/write`, `security:read/write`, `data:read/write`). Sidebar items are conditionally rendered based on scopes, and write operations are disabled via a `readOnly` prop for users without the corresponding `*:write` scope. When auth is not configured, all scopes are granted.

### API Layer

- `api/client.ts` — `apiFetch<T>()` wrapper with `ApiError` class and automatic auth token injection
- `api/auth.ts` — Cognito auth API: `fetchAuthConfig`, `initiateAuth`, `respondToNewPasswordChallenge`, `refreshTokens`
- `api/agents.ts` — Agent operations: list, get, register (with optional model_id), deploy, delete (with optional AWS cleanup), refresh, redeploy, fetchRoles, fetchCognitoPools, fetchModels, fetchDefaults
- `api/invocations.ts` — Session queries + `invokeAgentStream()` SSE consumer (supports `credential_id`, includes auth header)
- `api/logs.ts` — CloudWatch log queries
- `api/memories.ts` — Memory resource operations: create, import, list, get, refresh, delete, purge
- `api/security.ts` — Security admin operations: managed roles, authorizer configs, authorizer credentials, permission requests
- `api/settings.ts` — Tag policy and tag profile operations: list, create, update, delete
- `api/types.ts` — TypeScript interfaces including AgentResponse (with `model_id`, `tags`), SSESessionStart (with `has_token`, `token_source`), AuthorizerCredential, ManagedRole, PermissionRequestResponse, MemoryResponse (with `tags`), MemoryCreateRequest (with `tags`), MemoryStrategyRequest, TagPolicy, TagPolicyCreateRequest, TagPolicyUpdateRequest, TagProfile, TagProfileCreateRequest

### Hooks

- `useAgents()` — Agent list with auto-fetch, CRUD actions, register (with optional modelId)
- `useSessions(agentId)` — Session list that re-fetches on agent change
- `useInvoke(authorizerName?)` — Streaming state management with `AbortController`, supports credential_id and bearer_token, provides friendly error messages with authorizer-specific hints
- `useLogs()` — On-demand session log fetching
- `useDeployment()` — Agent config, credential providers, and integrations

### Key Components

- **SearchableSelect** — Combobox with search, filter, optional group headers (Anthropic/Amazon), and click-outside detection. Searches both label and value fields.
- **AgentCard** — Compact card with two-row header layout, inline badges (including authorizer display), refresh button, eraser icon for deletion, overlay confirmation with "Also delete in AgentCore" checkbox. Supports two-phase creation status (deploying → completing deployment → finalizing endpoint) with timer format (spinner + elapsed + message). Displays tag badges for tags marked `show_on_card` in the tag policy.
- **MemoryCard** — Memory resource card with name, status badge, spinner+timer for transitional states (using per-resource timestamps for accurate elapsed time), region/account/expiry metadata, tag badges, refresh and delete buttons with overlay confirmation.
- **ResourceTagFields** — Shared component for tag profile selection and tag resolution. Fetches tag policies and profiles, renders a profile dropdown (persisted in `sessionStorage`), resolves tags from the selected profile + policy defaults. Used by both agent deploy and memory create forms.
- **MultiSelect** — Checkbox-based multi-select dropdown with auto-expanding width. Used for tag filtering on all listing pages.
- **InvokePanel** — Qualifier selector, credential dropdown (with "Manual token" option for bearer tokens), model ID badge, prompt textarea, invoke/cancel buttons. Token indicator shown when invocation uses OAuth.
- **AuthorizerManagementPanel** — Lists authorizer configs with expandable credential management (add/list/delete credentials per config).
- **MemoryManagementPanel** — Create/import form with strategy configuration (type, name, description, namespaces), memory card/table list with status badges (CREATING/ACTIVE/FAILED/DELETING), refresh and delete actions with inline confirmation overlay.

### Views

| View | Persona | Description |
|------|---------|-------------|
| LoginPage | — | Cognito login + set new password |
| CatalogPage | Platform Catalog | Agents (with multi-select tag filter bar), memory resources (with tag badges), MCP servers, A2A agents sections |
| AgentDetailPage | Platform Catalog | Sessions, invoke, latency, streaming response, deployment details |
| SessionDetailPage | Platform Catalog | Session metadata, invocation timing, CloudWatch logs |
| AgentListPage | Agents | Deploy/Import form (with tag profile selector) + agent card/table grid with multi-select tag filters |
| SecurityAdminPage | Security | Roles, authorizers, credentials, permissions |
| MemoryManagementPage | Memory | Memory resource create/import form (with tag profile selector), card/table list with tag badges and multi-select tag filters |
| SettingsPage | Settings | Tag profile CRUD (create, edit, delete named tag presets) |

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
