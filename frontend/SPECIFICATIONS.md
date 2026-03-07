# Loom Frontend — Specifications

## 1. Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18 with TypeScript |
| Build tool | Vite 6 |
| UI components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS v4 (Vite plugin, no PostCSS) |
| Theme | Catppuccin (Mocha dark / Latte light) |
| HTTP client | Native `fetch` (typed wrappers in `src/api/client.ts`) |
| SSE streaming | `fetch` + `ReadableStream` (POST-based SSE) |
| Notifications | Sonner (toast) |
| Module system | ESM |

---

## 2. Project Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── types.ts            # TypeScript interfaces mirroring backend models
│   │   ├── client.ts           # apiFetch<T>() wrapper + ApiError class + auth token injection
│   │   ├── auth.ts             # Cognito auth API (initiateAuth, respondToChallenge, refreshTokens)
│   │   ├── agents.ts           # Agent CRUD + fetchRoles(), fetchCognitoPools(), fetchModels(), fetchDefaults()
│   │   ├── invocations.ts      # Session queries + SSE stream consumer (with auth header)
│   │   ├── logs.ts             # CloudWatch log queries
│   │   └── security.ts         # Security admin: roles, authorizers, credentials, permissions
│   ├── contexts/
│   │   ├── AuthContext.tsx      # Cognito auth provider (login, logout, token refresh)
│   │   └── TimezoneContext.tsx  # Timezone preference provider + hook
│   ├── hooks/
│   │   ├── useAgents.ts        # Agent list state + CRUD actions
│   │   ├── useSessions.ts      # Session list state per agent
│   │   ├── useInvoke.ts        # Streaming invocation state + AbortController
│   │   ├── useLogs.ts          # Session log fetching
│   │   └── useDeployment.ts    # Agent config, credential providers, integrations hooks
│   ├── components/
│   │   ├── ui/                 # shadcn primitives + searchable-select.tsx
│   │   ├── AgentCard.tsx       # Agent summary card with eraser icon deletion
│   │   ├── AgentRegistrationForm.tsx  # Tabbed form: ARN registration + agent deployment
│   │   ├── AuthorizerManagementPanel.tsx # Authorizer config + credential management
│   │   ├── DeploymentPanel.tsx # Deployment details panel
│   │   ├── InvokePanel.tsx     # Qualifier select, credential select, prompt input, invoke/cancel
│   │   ├── LatencySummary.tsx  # Timing breakdown
│   │   ├── SessionTable.tsx    # Clickable session list
│   │   ├── InvocationTable.tsx # Invocation timing data
│   │   └── LogViewer.tsx       # Scrollable log viewer
│   ├── pages/
│   │   ├── AgentListPage.tsx   # Builder persona: registration form + agent grid
│   │   ├── AgentDetailPage.tsx # Sessions, latency, invoke, response
│   │   ├── CatalogPage.tsx     # Catalog persona: agent card grid with management
│   │   ├── SecurityAdminPage.tsx  # Security persona: roles, authorizers, credentials, permissions
│   │   ├── LoginPage.tsx        # Cognito login + NEW_PASSWORD_REQUIRED challenge
│   │   ├── DataIntegrationPage.tsx # Integration persona (placeholder)
│   │   └── SessionDetailPage.tsx  # Session metadata, invocations, logs
│   ├── lib/
│   │   ├── utils.ts            # shadcn cn() utility
│   │   ├── format.ts           # Timezone-aware timestamp + metric formatters
│   │   └── status.ts           # Status badge variant mapping
│   ├── App.tsx                 # Auth gate + persona-based navigation + sidebar
│   ├── main.tsx                # Entry point
│   └── index.css               # Tailwind v4 imports + Catppuccin CSS variables
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts
├── components.json             # shadcn configuration
├── makefile
└── SPECIFICATIONS.md           # This file
```

---

## 3. Application Shell

The app uses a persona-based single-page architecture with a sidebar for workflow selection:

### Persona Navigation (Sidebar)

| Persona | Description | Default |
|---------|-------------|---------|
| Catalog | Browse and manage agents, invoke, view sessions | Yes |
| Builder | Register agents by ARN or deploy new agents | |
| Security Admin | Manage roles, authorizers, credentials, permissions | |
| Data Integration | Manage data integrations (placeholder) | |

The sidebar also contains:
- User indicator with email/username display and logout button (when authenticated)
- Theme toggle (Mocha dark / Latte light)
- Timezone selector (local / UTC)
- Live clock display

### Drill-Down Navigation (Catalog)

Within the Catalog persona, state-driven drill-down navigation:

```
Catalog  >  [Agent Name]  >  [Session ID]
```

- **No router library** — navigation is managed via lifted state in `App.tsx` (`selectedAgentId`, `selectedSessionId`)
- Breadcrumb navigation in the header allows clicking back to any level
- Sonner `<Toaster>` provides toast notifications for all user actions

---

## 4. Catalog (Home View)

**Purpose:** Browse registered/deployed agents, invoke them, and manage agent lifecycle.

**Content:**
- Responsive grid of `AgentCard` components (3 columns on large screens)
- Loading skeleton placeholders during data fetch
- Empty state with instructions when no agents exist

### AgentCard

Each card displays:
- Agent name (or runtime ID fallback)
- Protocol badge (e.g., `HTTP`) — inline with name
- Status badge (color-coded: READY=default, CREATING=secondary, FAILED=destructive) — inline with name
- Spinner animation when agent is in a creating/deploying state
- Active session count badge (when > 0)
- Region, Account ID, Network mode, Available qualifiers, Registered timestamp
- Eraser icon (top-right) for deletion

### Delete Confirmation

Clicking the eraser icon triggers an overlay confirmation panel:
- Absolutely positioned at the bottom of the card (`absolute inset-x-0 bottom-0`) to prevent other cards in the grid from changing height
- "Also delete in AgentCore" checkbox (right-aligned, shown only when agent has a runtime_id)
- Cancel and Confirm buttons (right-aligned)
- Clicks within the overlay are stopped from propagating to the card's `onClick`

---

## 5. Builder View

**Purpose:** Register agents by ARN and deploy new agents to AgentCore Runtime.

**Content:**
- `AgentRegistrationForm` with two tabs: Register and Deploy
- Below the form: responsive grid of `AgentCard` components

### Register Tab

- ARN text input and Model selector on the same line (ARN fills remaining space, model is fixed width)
- Labels: "AgentCore Runtime ARN" and "Model Used"
- Model selector uses `SearchableSelect` with grouped options (Anthropic / Amazon), no default selection
- Register button with `min-w-[120px]` to prevent layout shift during loading spinner

### Deploy Tab

Full deployment form with sections:
- **Agent Identity**: name (1/3 width) and description (2/3 width)
- **System Prompt**: agent description, behavioral guidelines, output expectations — each with placeholder examples
- **Model / Protocol / Network / IAM Role**: single flex row with explicit widths (20% / 10% / 10% / flex-1). Model uses `SearchableSelect` with grouped options, no default selection. Protocol offers HTTP as selectable; MCP and A2A shown as disabled. Network offers PUBLIC; VPC shown as disabled. IAM Role uses a `SearchableSelect` with searchable dropdown. Both model and IAM role are required — deploy button is disabled until both are selected.
- **Role Permissions (read-only)**: collapsible section shown after IAM role selection, displays policy document. Clicking the header toggles visibility.
- **Authorizer**: radio selection of None, Cognito, or Other. Authorizer dropdown is 25% width, shows just the authorizer config name. Fields show "Allowed Clients" and "Allowed Scopes".
  - Cognito: searchable Cognito pool select (30% width), auto-populated discovery URL, tag inputs for allowed clients and scopes, app client ID and client secret fields
  - Other: textbox for discovery URL, tag inputs for allowed clients and scopes
- **Lifecycle**: idle timeout and max lifetime fields with dynamic placeholders fetched from `/api/agents/defaults` (e.g., "300" and "3600")
- **Integrations**: Memory, MCP Servers, A2A Agents — all shown as disabled checkboxes with "coming soon" labels

---

## 6. Agent Detail View

**Purpose:** Invoke agents with streaming, view latency metrics, inspect session history, and view deployment details.

**Layout:** Single-column, full-width stacked layout:

### Sessions (top)
- Full-width table of all sessions for this agent
- Columns: Session ID (truncated), Qualifier, Live Status, Invocation count, Created timestamp
- Live status badges: active (green), expired (muted), streaming/pending (yellow), error (red)
- Clicking a row navigates to Session Detail

### Invoke Form
- `InvokePanel` component: qualifier selector, credential selector (optional), multi-line prompt textarea, invoke/cancel buttons
- Model ID displayed as a badge in the panel header
- Credential selector populates from all authorizer configs and their credentials
- When a credential is selected, the `credential_id` is passed with the invoke request
- Token indicator (Key icon + badge) shown when `session_start` includes `has_token: true`

### Latency Summary
- 4-metric placeholder (shows "—" before invocation), fills in after `session_end` SSE event

### Response Pane
- Raw text display with `whitespace-pre-wrap` and monospace font
- Expands dynamically with content (no fixed max-height)
- Session ID badge, model ID badge, and animated "streaming" indicator in header
- Blinking cursor while streaming

### Deployment Section (deployed agents only)
- Shows: runtime status badge, protocol, network mode, execution role, deployed timestamp

---

## 7. Security Admin View

**Purpose:** Manage IAM roles, authorizer configurations, authorizer credentials, and permission requests.

**Content:**
- `SecurityAdminPage` with sections for:
  - **Managed Roles**: list, create (import existing / wizard), view policy document, delete
  - **Authorizer Configs**: list, create (Cognito type with pool selection and auto-populated discovery URL), update, delete
  - **Authorizer Credentials**: per-config credential management (add label + client_id + client_secret, list, delete). Credential form uses 1/4 / 1/4 / 1/2 field widths. Authorizer type displayed as "Amazon Cognito" for cognito type.
  - **Permission Requests**: create requests for additional IAM permissions, review (approve/deny) with role application

---

## 8. Session Detail View

**Purpose:** Inspect a single session's invocations and CloudWatch logs.

**Content:**
- Session metadata card — session_id, qualifier, live status badge, created timestamp
- Invocation table — all invocations with timing data
- Log viewer — CloudWatch logs filtered to this session, dynamically expanding

---

## 9. Design Decisions

### Persona-Based Navigation
Chose a sidebar with persona-based workflows over traditional tab navigation. Each persona represents a distinct user role (catalog browser, agent builder, security admin, data integrator) with its own page and feature set. The sidebar provides persistent access to all personas and includes theme/timezone controls.

### Navigation: Lifted State vs. Router
Chose lifted state in `App.tsx` over React Router. Persona selection and drill-down navigation (within Catalog) are managed via state variables. A router would add unnecessary complexity for this use case.

### Layout: Stacked Single-Column for Agent Detail
Full-width stacked layout gives each section appropriate breathing room. Sessions are shown first as primary context, followed by invoke form, latency summary, response pane, and deployment details.

### Dynamic Expansion: Response Pane and Log Viewer
Both use plain `div` containers with no `max-height` or `ScrollArea` constraint, letting content grow naturally.

### AgentCard Grid Stability
The delete confirmation uses absolute positioning (`absolute inset-x-0 bottom-0`) to overlay the card rather than expanding it, preventing layout shifts in the responsive grid.

### Grouped Searchable Model Selector
Model selection uses `SearchableSelect` with group headers (Anthropic / Amazon). Search matches both display name and model ID value, allowing power users to search by inference profile ID. No default is pre-selected — the user must explicitly choose a model on both register and deploy forms.

### Catppuccin Theme
- **Mocha** (dark mode, default): Base #1e1e2e, primary Blue #89b4fa, destructive Red #f38ba8
- **Latte** (light mode): Base #eff1f5, primary Blue #1e66f5, destructive Red #d20f39
- `bg-input-bg` CSS variable maps to `#ffffff` (light) / `#313244` (dark) — used for bordered content sections

### Tailwind CSS v4 (Vite Plugin)
Using the `@tailwindcss/vite` plugin instead of PostCSS. Configuration is handled via CSS `@theme` blocks in `index.css`.

### Timezone-Aware Timestamps
All timestamps use shared utilities in `src/lib/format.ts`. A `TimezoneContext` stores the user's preference ("local" or "UTC"), applied globally.

### SearchableSelect Component
Custom combobox with click-outside detection, filtered option list, check mark for selected item, and optional group headers. Accepts a `className` prop for width control. Filter matches both `label` and `value` fields.

### TagInput Pattern
Inline component for adding/removing tag-style values (clients, scopes). Single textbox with Enter to add, badge with X to remove.

### Secrets Handling
Cognito client secrets are password-masked in forms. Secrets are sent to the backend which stores them in AWS Secrets Manager — they never persist in the frontend or local database.

### User Authentication
- `AuthContext` provides login, logout, token refresh, and user state to the entire app.
- Tokens (id, access, refresh) are stored in React state only — never in localStorage or cookies.
- The `AuthProvider` wraps the app at the top level (outside `TimezoneProvider`). If Cognito is not configured (empty pool ID/client ID), authentication is bypassed and the app loads normally.
- `LoginPage` renders when the user is not authenticated. It handles the `NEW_PASSWORD_REQUIRED` challenge for admin-created Cognito users.
- Access tokens are automatically refreshed 60 seconds before expiry using the refresh token.
- The user indicator (email/username + logout button) is shown in the sidebar footer, above the theme selector.
- `apiFetch` and `invokeAgentStream` automatically include the `Authorization: Bearer` header when a token is available, via a module-level token setter (`setAuthToken`/`getAuthToken`).

### API Layer Design
- `apiFetch<T>()` is a thin wrapper around `fetch` with JSON parsing, `ApiError` class, and automatic auth token injection
- Each API domain (agents, auth, invocations, logs, security) is a separate module with typed functions

### Session Liveness Display
Computed server-side using `LOOM_SESSION_IDLE_TIMEOUT_SECONDS`. The frontend displays `live_status` with color-coded badges and `active_session_count` on agent cards.

### SSE Stream Consumer
`invokeAgentStream()` uses `ReadableStream` to consume POST-based SSE responses with buffer-based line parsing, typed callback dispatch, and `AbortSignal` for cancellation.

---

## 10. Future Work

- **Markdown rendering** for agent responses
- **MCP server integration** configuration
- **A2A agent integration** configuration
- **VPC network mode** support
- **MCP and A2A protocol** support
- **Operate Tab** — aggregate dashboard with summary cards, per-agent latency charts
- **Real-time auto-refresh** of sessions and metrics
- **Log stream selection** and agent-level log viewer
- **Latency charts** using Recharts
- **Data Integration** persona implementation
