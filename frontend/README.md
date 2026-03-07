# Loom Frontend

Single-page React application for managing, deploying, and invoking Bedrock AgentCore agents with real-time streaming, latency measurement, session liveness tracking, memory resource management, and security administration.

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
| Theme | Catppuccin (Mocha dark / Latte light) |
| Streaming | `fetch` + `ReadableStream` (POST-based SSE) |
| Notifications | Sonner |

## Architecture

### Theme

The app uses the [Catppuccin](https://catppuccin.com/) color palette:

- **Mocha** (dark) is the default theme
- **Latte** (light) is available via the theme toggle in the sidebar
- Colors are mapped to shadcn CSS variables in `src/index.css`

### Persona-Based Navigation

The sidebar provides access to persona-based workflows:

| Persona | Icon | Description |
|---------|------|-------------|
| **Platform Catalog** | BookOpen | Browse agents, memory resources, MCP servers, A2A agents (default) |
| **Agents** | Bot | Deploy new agents or import existing ones |
| **Memory** | Brain | Create and manage AgentCore Memory resources |
| **Security Admin** | Shield | Manage IAM roles, authorizer configs, credentials, permission requests |
| **MCP Servers** | Network | Coming soon (disabled) |
| **A2A Agents** | Users | Coming soon (disabled) |

The sidebar also includes a user indicator (when authenticated), theme toggle, timezone selector, live clock, and version badge. Each listing page has a card/table view toggle; the selection persists per-page across persona switches.

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
│   └── types.ts       # TypeScript interfaces mirroring backend models
├── contexts/     # React contexts (auth, timezone preference)
├── hooks/        # Custom React hooks for data fetching
├── components/   # Application components + shadcn ui/ primitives
│   ├── AgentCard.tsx              # Agent card with refresh + eraser icon deletion + overlay confirmation
│   ├── AgentRegistrationForm.tsx  # Import (ARN + model) and Deploy (full form) tabs
│   ├── AuthorizerManagementPanel.tsx # Authorizer config and credential management
│   ├── MemoryCard.tsx             # Memory resource card with status, refresh, delete
│   ├── MemoryManagementPanel.tsx  # Memory resource create form + card/table list
│   ├── InvokePanel.tsx            # Qualifier, credential selector, model badge, prompt
│   ├── DeploymentPanel.tsx        # Deployment details for deployed agents
│   └── ui/
│       └── searchable-select.tsx  # Searchable dropdown with group headers
├── pages/        # Page-level view components
│   ├── CatalogPage.tsx         # Platform Catalog: agents, memory, MCP, A2A sections
│   ├── AgentListPage.tsx       # Agents: Deploy/Import form + agent grid
│   ├── AgentDetailPage.tsx     # Sessions, invoke, latency, response
│   ├── SecurityAdminPage.tsx   # Roles, authorizers, credentials, permissions
│   ├── MemoryManagementPage.tsx # Memory resource management
│   └── SessionDetailPage.tsx   # Session metadata, invocations, logs
├── lib/          # Shared utilities (cn(), format helpers, status mapping)
├── App.tsx       # Root: auth gate + persona sidebar + navigation
└── main.tsx      # Entry point
```

### Authentication

When the backend has Cognito configured (`LOOM_COGNITO_USER_POOL_ID` and `LOOM_COGNITO_USER_CLIENT_ID`), users must sign in before accessing the app. The login page handles the `USER_PASSWORD_AUTH` flow and `NEW_PASSWORD_REQUIRED` challenge. Tokens are stored in memory only (not persisted across page reloads). The access token is automatically attached to all API requests.

### API Layer

- `api/client.ts` — `apiFetch<T>()` wrapper with `ApiError` class and automatic auth token injection
- `api/auth.ts` — Cognito auth API: `fetchAuthConfig`, `initiateAuth`, `respondToNewPasswordChallenge`, `refreshTokens`
- `api/agents.ts` — Agent operations: list, get, register (with optional model_id), deploy, delete (with optional AWS cleanup), refresh, redeploy, fetchRoles, fetchCognitoPools, fetchModels, fetchDefaults
- `api/invocations.ts` — Session queries + `invokeAgentStream()` SSE consumer (supports `credential_id`, includes auth header)
- `api/logs.ts` — CloudWatch log queries
- `api/memories.ts` — Memory resource operations: create, import, list, get, refresh, delete, purge
- `api/security.ts` — Security admin operations: managed roles, authorizer configs, authorizer credentials, permission requests
- `api/types.ts` — TypeScript interfaces including AgentResponse (with `model_id`), SSESessionStart (with `has_token`, `token_source`), AuthorizerCredential, ManagedRole, PermissionRequestResponse, MemoryResponse, MemoryCreateRequest, MemoryStrategyRequest

### Hooks

- `useAgents()` — Agent list with auto-fetch, CRUD actions, register (with optional modelId)
- `useSessions(agentId)` — Session list that re-fetches on agent change
- `useInvoke()` — Streaming state management with `AbortController`, supports credential_id
- `useLogs()` — On-demand session log fetching
- `useDeployment()` — Agent config, credential providers, and integrations

### Key Components

- **SearchableSelect** — Combobox with search, filter, optional group headers (Anthropic/Amazon), and click-outside detection. Searches both label and value fields.
- **AgentCard** — Compact card with inline badges, refresh button, eraser icon for deletion, overlay confirmation with "Also delete in AgentCore" checkbox.
- **MemoryCard** — Memory resource card with name, status badge, spinner+timer for transitional states, region/account/expiry metadata, refresh and delete buttons with overlay confirmation.
- **InvokePanel** — Qualifier selector, credential dropdown, model ID badge, prompt textarea, invoke/cancel buttons. Token indicator shown when invocation uses OAuth.
- **AuthorizerManagementPanel** — Lists authorizer configs with expandable credential management (add/list/delete credentials per config).
- **MemoryManagementPanel** — Create/import form with strategy configuration (type, name, description, namespaces), memory card/table list with status badges (CREATING/ACTIVE/FAILED/DELETING), refresh and delete actions with inline confirmation overlay.

### Views

| View | Persona | Description |
|------|---------|-------------|
| LoginPage | — | Cognito login + set new password |
| CatalogPage | Platform Catalog | Agents, memory resources, MCP servers, A2A agents sections |
| AgentDetailPage | Platform Catalog | Sessions, invoke, latency, streaming response, deployment details |
| SessionDetailPage | Platform Catalog | Session metadata, invocation timing, CloudWatch logs |
| AgentListPage | Agents | Deploy/Import form + agent card/table grid |
| SecurityAdminPage | Security | Roles, authorizers, credentials, permissions |
| MemoryManagementPage | Memory | Memory resource create/import form, card/table list, refresh, delete |

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
