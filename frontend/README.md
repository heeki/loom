# Loom Frontend

Single-page React application for managing, deploying, and invoking Bedrock AgentCore agents with real-time streaming, latency measurement, and session liveness tracking.

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

- **Mocha** (dark) is the default theme, matching the catppuccin/tmux convention
- **Latte** (light) is available via the `.dark` class toggle on `<html>`
- Colors are mapped to shadcn CSS variables in `src/index.css`

### Timezone Support

All timestamps are timezone-aware. A dropdown in the header lets the user switch between their local timezone and UTC. The preference applies globally and updates every timestamp in the UI immediately.

### Navigation

State-driven drill-down navigation managed in `App.tsx`:

```
Agents → Agent Detail → Session Detail
```

No router library — view selection is based on `selectedAgentId` and `selectedSessionId` state.

### Source Layout

```
src/
├── api/          # Typed API client and endpoint functions
├── contexts/     # React contexts (timezone preference)
├── hooks/        # Custom React hooks for data fetching
├── components/   # Application components + shadcn ui/ primitives
│   ├── AgentRegistrationForm.tsx   # Register (ARN) and Deploy (full form) tabs
│   ├── DeploymentPanel.tsx         # Deployment details for deployed agents
│   └── ui/
│       └── searchable-select.tsx   # Searchable dropdown (combobox)
├── pages/        # Page-level view components
├── lib/          # Shared utilities (cn(), format helpers)
├── App.tsx       # Root component with navigation + timezone provider
└── main.tsx      # Entry point
```

### API Layer

- `api/client.ts` — `apiFetch<T>()` wrapper with `ApiError` class
- `api/agents.ts` — Agent operations: listAgents, getAgent, registerAgent, deployAgent, deleteAgent (with optional AWS cleanup), refreshAgent, redeployAgent, fetchRoles, fetchCognitoPools, fetchModels
- `api/invocations.ts` — Session queries + `invokeAgentStream()` SSE consumer
- `api/logs.ts` — CloudWatch log queries (streams, agent logs, session logs)
- `api/types.ts` — TypeScript interfaces mirroring backend Pydantic models

### Hooks

- `useAgents()` — Agent list with auto-fetch, re-fetch on navigation back, and CRUD actions
- `useSessions(agentId)` — Session list that re-fetches on agent change
- `useInvoke()` — Streaming state management with `AbortController`
- `useLogs()` — On-demand session log fetching
- `useDeployment()` — Agent config, credential providers, and integrations for deployed agents

### Views

| View | Layout | Description |
|------|--------|-------------|
| Agent List | Card grid | Register and Deploy tabs. Deploy form includes model selection, protocol/network/IAM role, authorizer (Cognito/Other), lifecycle timeouts, and integrations. |
| Agent Detail | Stacked full-width | Sessions (top) → Invoke form → Latency summary → Response pane (raw streamed text) → Deployment panel for deployed agents (runtime status, protocol, network, execution role, deployed timestamp). |
| Agent Card | Card | Shows protocol badge, network mode, and active session count. Remove flow has Cancel/Confirm buttons with optional "Remove in AgentCore" checkbox. |
| Session Detail | Stacked sections | Metadata with live status badge, invocation timing table, dynamically expanding CloudWatch logs. |

### Custom Components

- **SearchableSelect** — Combobox with search and filter support, used for selecting IAM roles and Cognito pools in the deploy form.
- **TagInput** — Inline component in the deploy form for adding and removing tag values (e.g. clients, scopes).

### Session Liveness

Session liveness is computed server-side using a local idle timeout heuristic (no AWS API calls). The frontend displays:
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
