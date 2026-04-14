# Loom Frontend — Specifications

## 1. Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18 with TypeScript |
| Build tool | Vite 6 |
| UI components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS v4 (Vite plugin, no PostCSS) |
| Theme | 10 themes: 5 light + 5 dark (Ayu Light, Catppuccin Latte, Everforest, Rosé Pine Dawn, Solarized, Ayu Dark, Catppuccin Mocha, Dracula, Nord, Tokyo Night) |
| HTTP client | Native `fetch` (typed wrappers in `src/api/client.ts`, dynamic `VITE_API_BASE_URL` with nullish coalescing fallback) |
| SSE streaming | `fetch` + `ReadableStream` (POST-based SSE) |
| Notifications | Sonner (toast) |
| Module system | ESM |

---

## 2. Project Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── types.ts            # TypeScript interfaces mirroring backend models (A2aAgent, A2aAgentSkill, A2aAgentAccess, A2aAgentCard, CostDashboardResponse, CostActualsResponse, CostActualAgent, CostActualSession, AgentCostSummary, ModelPricing)
│   │   ├── client.ts           # apiFetch<T>() wrapper + ApiError class, dynamic BASE_URL via VITE_API_BASE_URL, automatic auth token injection, and 401 auto-refresh via `setOnUnauthorized` callback
│   │   ├── auth.ts             # Cognito auth API (initiateAuth, respondToChallenge, refreshTokens)
│   │   ├── agents.ts           # Agent CRUD + fetchRoles(), fetchCognitoPools(), fetchModels(), fetchDefaults()
│   │   ├── invocations.ts      # Session queries + SSE stream consumer (with auth header)
│   │   ├── logs.ts             # CloudWatch log queries: `getSessionLogs`, `getAgentLogs`, `listLogStreams`, `listVendedLogSources`, `getVendedLogs`
│   │   ├── mcp.ts              # MCP server CRUD, tools, access, test connection
│   │   ├── a2a.ts              # A2A agent CRUD, test connection, card refresh, access
│   │   ├── memories.ts         # Memory resource CRUD + refresh
│   │   ├── security.ts         # Security admin: roles, authorizers, credentials, permissions
│   │   ├── settings.ts        # Settings API: tag policy + tag profile CRUD
│   │   ├── costs.ts           # Cost dashboard (estimated + actuals) + model pricing API
│   │   ├── traces.ts          # Trace API: `getSessionTraces`, `getTraceDetail`
│   │   └── audit.ts           # Admin audit API: recordLogin, recordAction, recordPageView, fetchLogins, fetchActions, fetchPageViews, fetchSessions, fetchSessionTimeline, fetchAuditSummary, trackAction (fire-and-forget)
│   ├── contexts/
│   │   ├── AuthContext.tsx      # Cognito auth provider (login, logout, token refresh, browserSessionId generation and login audit)
│   │   ├── TimezoneContext.tsx  # Timezone preference provider + hook
│   │   └── ThemeContext.tsx     # Theme provider with 10 themes, localStorage persistence, WCAG-compliant contrast
│   ├── hooks/
│   │   ├── useAgents.ts        # Agent list state + CRUD actions
│   │   ├── useSessions.ts      # Session list state per agent
│   │   ├── useInvoke.ts        # Streaming invocation state + AbortController
│   │   ├── useLogs.ts          # On-demand session and stream log fetching with optional cache-busting (`noCache` parameter appends `_t` timestamp)
│   │   ├── useDeployment.ts    # Agent config, credential providers, integrations hooks
│   │   ├── useMcpServers.ts   # MCP server list state + CRUD actions
│   │   ├── useA2aAgents.ts  # A2A agent list with auto-fetch, CRUD callbacks
│   │   └── useTraces.ts    # Trace list + detail state management
│   ├── components/
│   │   ├── ui/                 # shadcn primitives + searchable-select.tsx + multi-select.tsx + add-filter-dropdown.tsx
│   │   ├── SortableCardGrid.tsx — Drag-to-reorder card grid using @dnd-kit, default alphabetical sort, SortButton, localStorage persistence
│   │   ├── SortableTableHead.tsx — Clickable sortable table column headers with arrow indicators
│   │   ├── AgentCard.tsx       # Agent summary card with refresh + Trash2 icon deletion
│   │   ├── AgentRegistrationForm.tsx  # Tabbed form: ARN registration + agent deployment
│   │   ├── JsonConfigSection.tsx     # Shared collapsible JSON import/export section
│   │   ├── AuthorizerManagementPanel.tsx # Authorizer config + credential management
│   │   ├── McpAccessControl.tsx        # Persona access control for MCP servers and tools
│   │   ├── McpServerForm.tsx          # Form for adding/editing MCP servers with OAuth2 config
│   │   ├── McpToolList.tsx            # Tool list display with schema details
│   │   ├── A2aAgentForm.tsx          # A2A agent create/edit form with OAuth2 disclosure
│   │   ├── A2aAgentCardView.tsx      # Structured Agent Card display with skills
│   │   ├── A2aSkillList.tsx          # Expandable skill cards with tags, examples, modes
│   │   ├── A2aAccessControl.tsx      # Per-persona access control for A2A agent skills
│   │   ├── MemoryCard.tsx              # Memory resource summary card
│   │   ├── MemoryManagementPanel.tsx    # Memory resource create form + list table
│   │   ├── ResourceTagFields.tsx       # Shared tag profile selector + tag resolution
│   │   ├── DeploymentPanel.tsx # Deployment details panel
│   │   ├── InvokePanel.tsx     # Qualifier select, credential select, prompt input, invoke/cancel
│   │   ├── LatencySummary.tsx  # Invocation metrics (timing + token usage + cost)
│   │   ├── SessionTable.tsx    # Clickable session list
│   │   ├── InvocationTable.tsx # Invocation timing data + token/cost columns
│   │   ├── LogViewer.tsx       # Paginated log viewer with toggleable line numbers and timestamps
│   │   ├── TraceList.tsx      # Trace summary table (Trace ID, Start/End Time, Duration, Spans, Events) with clickable rows
│   │   └── TraceGraph.tsx     # Interactive waterfall timeline with colored span bars, hover detail panel, click-to-select events, expand/collapse all
│   ├── pages/
│   │   ├── AgentListPage.tsx   # Agents persona: registration form + agent grid
│   │   ├── AgentDetailPage.tsx # Sessions, latency, invoke, response
│   │   ├── CatalogPage.tsx     # Platform Catalog: agents, memory, MCP, A2A agents sections
│   │   ├── SecurityAdminPage.tsx  # Security persona: roles, authorizers, credentials, permissions
│   │   ├── LoginPage.tsx        # Cognito login + NEW_PASSWORD_REQUIRED challenge
│   │   ├── McpServersPage.tsx  # MCP server management: list, detail, tools, access
│   │   ├── A2aAgentsPage.tsx       # A2A agent management with card/access tabs
│   │   ├── MemoryManagementPage.tsx # Memory persona: memory resource management
│   │   ├── TaggingPage.tsx         # Tagging persona: tag policy + tag profile CRUD
│   │   ├── SettingsPage.tsx        # Settings persona: display preferences + cost estimation settings
│   │   ├── CostDashboardPage.tsx  # Cost dashboard with time-range selector and per-agent breakdown
│   │   ├── AdminDashboardPage.tsx # Admin-only dashboard: summary cards, charts, Sessions/Logins/Actions/Page Views tabs
│   │   ├── SessionDetailPage.tsx  # Session metadata, invocations, tabbed Logs/Traces view
│   │   └── InvocationDetailPage.tsx  # Invocation details, cost breakdown, Traces tab
│   ├── lib/
│   │   ├── utils.ts            # shadcn cn() utility
│   │   ├── format.ts           # Timezone-aware timestamp + metric formatters
│   │   ├── status.ts           # Status badge variant mapping
│   │   └── errors.ts           # Friendly invoke error message mapping
│   ├── App.tsx                 # Auth gate + persona-based navigation + sidebar
│   ├── main.tsx                # Entry point
│   └── index.css               # Tailwind v4 imports + Catppuccin CSS variables
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts
├── etc/
│   ├── environment.sh           # Sources account-specific file + shared outputs
│   └── environment.sh.example   # Example environment configuration template
├── iac/
│   └── ecs.yaml                 # Frontend ECS Fargate service (task def, service)
├── .dockerignore                # Excludes .env, node_modules, dist
├── Dockerfile                   # Multi-stage container image (Node build + nginx serve)
├── nginx.conf                   # nginx SPA config with gzip and immutable asset caching
├── components.json              # shadcn configuration
├── makefile                     # dev, build, ecs.* targets
└── SPECIFICATIONS.md            # This file
```

---

## 3. Application Shell

The app uses a persona-based single-page architecture with a sidebar for workflow selection:

### Persona Navigation (Sidebar)

| Persona | Icon | Description | Required Scope | Default |
|---------|------|-------------|----------------|---------|
| Platform Catalog | BookOpen | Browse agents, memory resources, MCP servers, A2A agents | Always visible | Yes |
| Agents | Bot | Deploy new agents or import existing ones | `agent:read` or `agent:write` | |
| Memory | Brain | Create and manage AgentCore Memory resources | `memory:read` or `memory:write` | |
| Security Admin | Shield | Manage roles, authorizers, credentials, permissions | `security:read` or `security:write` | |
| Tags | Tags | Manage tag policies and tag profiles | Always visible | |
| Settings | Settings | Manage display preferences | Always visible | |
| MCP Servers | Network | Register and manage MCP servers, tools, and access control | `mcp:read` or `mcp:write` | |
| A2A Agents | Users | Register and manage A2A agents, view Agent Cards, and control access | `a2a:read` or `a2a:write` | |
| Registry | Library | Browse and manage AWS Agent Registry records for governance and discovery | `registry:read` or `registry:write` | |
| Costs | DollarSign | Cost dashboard with estimated costs, actual runtime costs from CloudWatch, and cost estimation settings | `catalog:read` | |
| Admin Dashboard | BarChart3 | Platform usage analytics: login tracking, action tracking, page navigation, per-session drill-down, summary cards and charts | `isAdmin` (super-admins only) | |

Sidebar items are conditionally rendered based on the user's scopes derived from their Cognito group membership. When auth is not configured, all items are visible.

The sidebar also contains:
- User indicator with username display and logout button (when authenticated)
- Live clock display
- Version badge

### Admin View Switching
Admin users see an Eye icon dropdown in the sidebar that lets them simulate specific users (admin, demo-admin-1, demo-admin-2, security-admin, integration-admin, demo-user-1, demo-user-2). Each user maps to their Cognito groups, and `effectiveHasScope` resolves scopes from those groups. This lets admins see what each user's experience looks like — including group-restricted resource visibility — without losing admin access. The dropdown resets when the page is refreshed.

### Drill-Down Navigation (Catalog)

Within the Catalog persona, state-driven drill-down navigation:

```
Catalog  >  [Agent Name]  >  [Session ID]
```

- **No router library** — navigation is managed via lifted state in `App.tsx` (`selectedAgentId`, `selectedSessionId`)
- Breadcrumb navigation in the header allows clicking back to any level
- Sonner `<Toaster>` provides toast notifications for all user actions

---

## 4. Platform Catalog (Home View)

**Purpose:** Browse and manage registered agents, memory resources, and other platform resources.

**Content:**
- Page description: "Browse and manage registered agents and resources." with estimates disclaimer: "Costs for agents and memory resources are *estimates*."
- Page header: "Platform Catalog" with card/table view toggle (top-right)
- Organized into collapsible sections: Agents, Memory Resources, MCP Servers, A2A Agents. Each section header has a ChevronRight/ChevronDown toggle. Collapse state persisted to `localStorage` under `loom:collapsedSections:catalog`.
- Tag-based filter bar above the agents grid, with multi-select dropdowns (checkbox-based) for each tag policy with `show_on_card=true`. Client-side AND filtering with "Clear filters" button and agent count display (e.g., "Showing 3 of 12 agents")
- Card/table view toggle applies to all sections on the page
- Agents section: responsive grid of `AgentCard` components (3 columns on large screens) or table view
- Memory Resources section: responsive grid of `MemoryCard` components with delete and refresh wired to API, manual RefreshCw button next to section header; or table view
- Transitional-state polling: if any memory is in CREATING or DELETING state, polls at 3-second intervals; stops when all resources are stable. Memories returning 404 on refresh are automatically purged.
- Loading skeleton placeholders during data fetch
- Empty state with instructions when no agents/memories exist

### AgentCard

Each card displays:
- Agent name (or runtime ID fallback)
- Protocol badge (e.g., `HTTP`) — inline with name
- Status badge (color-coded: READY=default, CREATING=secondary, FAILED=destructive) — inline with name
- Progressive deployment status phases: `initializing`, `creating_credentials` (Creating credential provider), `creating_role` (Creating IAM role), `building_artifact` (Building artifact), `deploying` (Deploying runtime), then "Completing deployment", "Finalizing endpoint"
- Spinner animation when agent is in a creating/deploying state
- Spinner animation and elapsed timer when agent is in DELETING state, using `deleteStartTime` prop for accurate timer display
- Endpoint status badge hidden during DELETING state
- `DEPLOY_IN_PROGRESS` set for determining transitional states
- Active session count badge (when > 0)
- Region, Account ID, Network mode, Available qualifiers, Authorizer (name, "Cognito", "external", or "None"), Registered timestamp
- Tag badges (secondary variant) for tags marked `show_on_card` in tag policies, formatted as `key: value`
- Refresh button (RefreshCw icon) and Trash2 icon (top-right) for refresh/deletion

### Delete Confirmation

Clicking the Trash2 icon triggers an overlay confirmation panel:
- Absolutely positioned at the bottom of the card (`absolute inset-x-0 bottom-0`) to prevent other cards in the grid from changing height
- "Also delete in AgentCore" checkbox (right-aligned, shown only when agent has a runtime_id)
- Cancel and Confirm buttons (right-aligned)
- Clicks within the overlay are stopped from propagating to the card's `onClick`

When deletion is confirmed with "Also delete in AgentCore" checked, the agent transitions to DELETING status with a spinner and timer on the card. The `useAgents` hook polls the agent status at 5-second intervals. When the poll returns 404, the hook calls the purge endpoint to remove the agent from the local database and shows a success toast.

---

## 5. Agents View (Agent Administration)

**Purpose:** Deploy new agents or import existing ones to AgentCore Runtime.

**Content:**
- Page header: "Agent Administration" with card/table view toggle (top-right)
- Sub-header: "Agents" with description and "Add Agent" button (right-aligned)
- "Add Agent" toggles a Card containing Deploy/Import tab switcher and `AgentRegistrationForm`
- When deploy succeeds, the form collapses and an ephemeral `AgentCard` appears at the top of the grid with CREATING status and spinner/timer. Once the real agent appears in the agents list, the ephemeral card is removed.
- Below the form: responsive grid of `AgentCard` components (cards default) or table view

### Import Tab

- ARN text input and Model selector on the same line (ARN fills remaining space, model is fixed width)
- Labels: "AgentCore Runtime ARN" and "Model Used"
- Model selector uses `SearchableSelect` with grouped options (Anthropic / Amazon), no default selection
- Import button with `min-w-[120px]` to prevent layout shift during loading spinner

### Deploy Tab

Full deployment form with sections:
- **JSON Import/Export**: Collapsible section (ChevronDown/ChevronRight toggle) via the shared `JsonConfigSection` component. Import maps `name`, `description`, `persona` (→ agent description), `instructions` (→ behavioral guidelines), `behavior` (→ output expectations), `model`, `role`, `network_mode`, `authorizer`, `tags` (tag profile name). Export serializes the current form state to JSON using human-readable identifiers (model ID, role name, authorizer name, tag profile name); empty/default fields are omitted. Apply/Export/Cancel buttons. Invalid JSON shows inline error without clearing existing fields.
- **Agent Identity**: name (1/3 width) and description (2/3 width)
- **System Prompt**: agent description, behavioral guidelines, output expectations — each with placeholder examples
- **Model / Protocol / Network / IAM Role**: single flex row with explicit widths (20% / 10% / 10% / flex-1). Model uses `SearchableSelect` with grouped options, no default selection. Protocol offers HTTP as selectable; MCP and A2A shown as disabled. Network offers PUBLIC; VPC shown as disabled. IAM Role uses a `SearchableSelect` with searchable dropdown. Both model and IAM role are required — deploy button is disabled until both are selected.
- **Role Permissions (read-only)**: collapsible section shown after IAM role selection, displays policy document. Clicking the header toggles visibility.
- **Authorizer**: radio selection of None, Cognito, or Other. Authorizer dropdown is 25% width, shows just the authorizer config name. Fields show "Allowed Clients" and "Allowed Scopes".
  - Cognito: searchable Cognito pool select (30% width), auto-populated discovery URL, tag inputs for allowed clients and scopes, app client ID and client secret fields
  - Other: textbox for discovery URL, tag inputs for allowed clients and scopes
- **Lifecycle**: idle timeout and max lifetime fields with dynamic placeholders fetched from `/api/agents/defaults` (e.g., "300" and "3600")
- **Resource Tags**: `ResourceTagFields` component with tag profile dropdown (persisted in `sessionStorage`). Deploy-time tags are auto-applied; build-time tags are resolved from the selected tag profile.
- **Integrations**: Memory (enabled, with multi-select dropdown for memory resources), MCP Servers (enabled with multi-select dropdown), A2A Agents (enabled with multi-select dropdown)

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
- `InvokePanel` component: qualifier selector, credential selector, multi-line prompt textarea, invoke/cancel buttons
- Model ID displayed as a badge in the panel header
- Credential dropdown is context-aware:
  - **OAuth agents** (agent has authorizer): shows user's token (default), M2M credentials from authorizer configs, and manual token (always last)
  - **Non-OAuth agents** (no authorizer): shows "No credentials (SigV4)" only
- When a credential is selected, the `credential_id` is passed with the invoke request
- When "Manual token" is selected, a password input field appears for entering a raw bearer token
- Session dropdown auto-selects the newly created session after an invocation
- Token indicator (Key icon + badge) shown when `session_start` includes `has_token: true`

### Latency Summary
- 4-metric placeholder (shows "—" before invocation), fills in after `session_end` SSE event

### Error Display
- Invocation errors show user-friendly messages mapped from raw error patterns via `friendlyInvokeError()` in `lib/errors.ts`
- Pattern matching: 401/unauthorized → auth required, 403/forbidden → access denied, token errors → expired/invalid, credential errors → credential required
- Collapsible "Show details" toggle reveals the raw error for debugging
- Error card styled with `border-destructive`

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
  - **Managed Roles**: list, create (import existing / wizard), view policy document, delete. Uses `SortableCardGrid` with drag-to-reorder (storage key `security-roles`), full-width single-column layout (role cards contain long ARNs and expandable policy documents), default alphabetical sort by role name, and A-Z/Z-A sort toggle.
  - **Authorizer Configs**: list, create (Cognito type with pool selection and auto-populated discovery URL), update, delete. Uses `SortableCardGrid` with drag-to-reorder (storage key `security-authorizers`), default alphabetical sort by config name, and A-Z/Z-A sort toggle.
  - **Authorizer Credentials**: per-config credential management (add label + client_id + client_secret, list, delete). Credential form uses 1/4 / 1/4 / 1/2 field widths. Authorizer type displayed as "Amazon Cognito" for cognito type.
  - **Permission Requests**: create requests for additional IAM permissions, review (approve/deny) with role application. Uses `SortableCardGrid` with drag-to-reorder (storage key `security-permissions`), default alphabetical sort by role name, and A-Z/Z-A sort toggle.

---

## 8. Memory Management View (Memory Administration)

**Purpose:** Create new AgentCore Memory resources with configurable strategies or import existing ones.

**Layout:** Page header "Memory Administration" with card/table view toggle (top-right), followed by "Add Memory" button, create form (toggle), and memory list (cards default or table).

### Create Form

Toggled via the "Add Memory" button. Contained in a `Card` with the following fields:

- **JSON Import/Export**: Collapsible section via the shared `JsonConfigSection` component. Import maps `name`, `description`, `event_expiry_duration` (validated 3-364), `tags` (tag profile name lookup), `strategies` (array with strategy_type validation). Export serializes the current form state; empty/default fields are omitted. Apply/Export/Cancel buttons.
- **Name** (required, flex-1) and **Event Expiry** (days, fixed 140px width) — same row
- **Description** — full width, optional
- **Memory Execution Role ARN** and **Encryption Key ARN** — 2-column grid, optional
- **Strategies** — dynamic list, each strategy in a dashed-border card:
  - **Type** (Select: Semantic, Summary, User Preference, Episodic, Custom) and **Name** — same row
  - **Description** — full width, optional
  - **Namespace** — single text input field
  - Trash icon to remove individual strategies
  - "Add Strategy" ghost button to add more
- **Resource Tags**: `ResourceTagFields` component (same as agent deploy form) — tag profile dropdown with `sessionStorage` persistence
- **Create** button (disabled until name provided) and **Cancel** button

### Memory List (Card View / Table View)

**Card view** (default): Responsive grid of `MemoryCard` components (3 columns on large screens). Each card displays name, status badge, spinner+timer for transitional states, region, account, event expiry, strategies count, registered timestamp, tag badges (for tags with `show_on_card=true`), refresh and delete buttons. Multi-select tag filter bar above the grid with AND logic.

**Table view**: Table with columns (using `table-fixed` layout with percentage-based widths matching agent tables):

| Column | Width | Description |
|--------|-------|-------------|
| Name | 26% | Memory resource name (font-medium) |
| Status | 10% | Badge with status variant + spinner for transitional states |
| Cost | 12% | Estimated total memory cost (`~N.NNNN` or `—`) |
| Strategies | 12% | Count of configured strategies |
| Event Expiry | 12% | Duration in days (computed from seconds) |
| Region | 12% | AWS region |
| Registered | 16% | Timezone-aware timestamp |

### Status Badges

Status badges use `statusVariant()` mapping:
- **ACTIVE** — default variant
- **CREATING** — secondary variant + spinning `Loader2` icon
- **FAILED** — destructive variant
- **DELETING** — secondary variant + spinning `Loader2` icon
- **initializing** — secondary variant
- **creating_credentials** — secondary variant
- **creating_role** — secondary variant
- **building_artifact** — secondary variant
- **deploying** — secondary variant
- **ENDPOINT_CREATING** — secondary variant

### Timer Accuracy

Elapsed timers for transitional states use per-resource timestamps:
- **CREATING**: Timer uses the creation initiation timestamp (tracked in component state) rather than `created_at` from the server.
- **DELETING**: Timer uses the delete initiation timestamp (tracked in component state) rather than `created_at`.
- A 10-minute creation timeout shows an error toast rather than spinning indefinitely.

### Delete Confirmation

Inline overlay on the card or table row (absolute positioned at bottom):
- "Also delete in AgentCore" checkbox (shown when memory has a memory_id)
- Cancel button (ghost) and Confirm button (destructive)
- Clicks within overlay are stopped from propagating

### Notifications

All operations show Sonner toast notifications:
- Success: "Memory resource created", "Memory resource refreshed", "Memory resource deleted"
- Error: Mapped from HTTP status codes (400→invalid request, 403→access denied, 404→not found, 409→conflict, 429→rate limited, 502→AWS service error)

### Empty State

When no memory resources exist: centered muted text "No memory resources yet. Add one above."

---

## 8a. MCP Servers View (MCP Server Administration)

**Purpose:** Register and manage MCP (Model Context Protocol) servers, view available tools, and control persona access. MCP servers can be selected during agent deployment for runtime integration.

**Layout:** Page header "MCP Server Administration" with card/table view toggle (top-right), followed by "Add MCP Server" button, create form (toggle), and server list (cards default or table).

### Server List

**Card view** (default): `SortableCardGrid` with drag-to-reorder (storage key `mcp-servers`), default alphabetical sort by name, and A-Z/Z-A sort toggle. Each card displays server name, status badge (`active`=default, `inactive`=secondary, `error`=destructive), endpoint URL, transport type badge, auth type badge, created timestamp. Delete with inline confirmation overlay (same pattern as AgentCard).

**Table view**: Sortable columns — Name (18%), Endpoint (46%), Transport (10%), Auth (10%), Created (16%).

### Server Detail View

Accessed by clicking a server card/row. Shows:
- Header with server name, endpoint URL, status/transport/auth badges
- "Edit Server" button (opens inline McpServerForm with pre-filled data)
- Tab bar: Tools | Access

**Tools tab** (`McpToolList`):
- Tool count and last-refreshed timestamp
- "Refresh Tools" button to fetch from the MCP server
- Each tool displayed as a card: tool name (bold), description, collapsible input schema (formatted JSON in monospace `pre` block)
- Empty state: "No tools discovered. Click 'Refresh Tools' to fetch from the MCP server."

**Access tab** (`McpAccessControl`):
- Lists all registered agents (personas) with checkbox to grant/revoke access
- When access granted: radio for "All Tools" / "Selected Tools"
- When "Selected Tools": checkboxes for individual tools (from cached tool list)
- "Save" button to persist changes
- Deny by default — personas without an explicit rule cannot use the server

### McpServerForm

Create/edit form with:
- Name (required, 1/3 width) and Endpoint URL (required, flex-1) and Transport Type (select: SSE/Streamable HTTP, 180px)
- Description (textarea)
- Authentication section: radio toggle for None / OAuth2
- When OAuth2: well-known URL, client ID, client secret (password input with "(unchanged)" placeholder in edit mode), scopes (space-separated)
- "Test Connection" button (only shown in edit mode) with success/failure badge result
- Create/Update and Cancel buttons

---

## 8b. A2A Agents View (A2A Agent Administration)

**Purpose:** Register and manage A2A (Agent-to-Agent) protocol integrations, view structured Agent Card information, and control persona access to agent skills.

**Layout:** Page header "A2A Agent Administration" with card/table view toggle (top-right), followed by "Add A2A Agent" button, create form (toggle), and agent list (cards default or table).

### Agent List

**Card view** (default): `SortableCardGrid` with drag-to-reorder (storage key `a2a-agents`), default alphabetical sort by name, and A-Z/Z-A sort toggle. Each card displays agent name, version badge, base URL, provider, auth type, created timestamp. Edit/Delete buttons with inline confirmation overlay.

**Table view**: Sortable columns — Name (18%), URL (46%), Version (10%), Auth (10%), Created (16%). No Provider or Status column; structure matches the MCP Servers table.

### Agent Detail View

Accessed by clicking an agent card/row. Shows:
- Header with agent name, edit button, and description
- "Edit Agent" opens inline A2aAgentForm with pre-filled data
- Tab bar: Agent Card | Access

**Agent Card tab** (`A2aAgentCardView`):
- Header section: agent name, version badge, status badge, provider info, documentation link, "Refresh Card" button with last-fetched timestamp
- Capabilities section: enabled/disabled badges for Streaming, Push Notifications, State History
- Authentication Schemes section: badges for each scheme (e.g., Bearer, Basic)
- Input/Output Modes section: MIME type badges
- Skills section (`A2aSkillList`): expandable skill cards with name, skill ID, description, tag badges, examples (bulleted list), and input/output mode overrides

**Access tab** (`A2aAccessControl`):
- Lists all registered agents (personas) with checkbox to grant/revoke access
- When access granted: radio for "All Skills" / "Selected Skills"
- When "Selected Skills": checkboxes for individual skills with name and description
- "Save" button to persist changes
- Deny by default — personas without an explicit rule cannot use the agent

### A2aAgentForm

Create/edit form with:
- Base URL (required) with helper text about Agent Card endpoint
- Authentication section: radio toggle for None / OAuth2
- When OAuth2: well-known URL, client ID, client secret (password input with "(unchanged)" placeholder in edit mode), scopes (space-separated)
- "Test Connection" button (only shown in edit mode) with success/failure badge result
- Register/Update and Cancel buttons

---

## 9. Settings View

**Purpose:** Manage display preferences.

**Content:**
- Page header: "Settings" with description "Manage display preferences."
- **Preferences** section: Theme selector (grouped by Light/Dark using SelectGroup/SelectLabel, always drops down via `position="popper"`) and Timezone selector (local/UTC)
- Always visible in the sidebar (no scope guard for visibility)

---

## 9a. Tagging View

**Purpose:** Manage tag policies (platform + custom) and tag profiles.

**Tag Designations:**
- `platform:required` — tags with `loom:` prefix. Required for all resources. Read-only in the policy list (Lock icon). Always shown as input fields in the profile form.
- `custom:optional` — user-defined tags without `loom:` prefix. Optional, editable, deletable. In the profile form, each appears as a checkbox; checking it reveals a value input.
- Designation is computed from the key (not stored). The legacy `source` column is retained in the DB for backward compatibility but is not exposed in the API or UI.

**Content:**
- Page header: "Tagging" with description "Manage tag policies and tag profiles."
- **Tag Policies** section (top): displays `platform:required` tags as read-only rows with a Lock icon and designation badge, followed by `custom:optional` tags (editable/deletable with designation badge). "Add Custom Tag" button shows a form with: key (text, required), default value (optional text), show on card (checkbox, default true). Custom tags are always created as `required=false`. Sort toggle (A-Z/Z-A) available for policies and profiles.
- **Tag Profiles** section (below policies): list, create, edit, delete named tag presets
  - Each profile card shows: name, timestamps, and tag value badges
  - Collapsible profile groups: platform required tags and custom optional tags are in collapsible sections (ChevronDown/ChevronRight toggle)
  - Create/edit form has two sections:
    1. **Platform (Required)** — input fields for each `platform:required` tag (mandatory, marked with `*`)
    2. **Custom (Optional)** — checkbox per custom tag; checking reveals a value input. Unchecking removes the tag from the profile.
  - Form-fill import: JSON import via `JsonConfigSection` auto-populates profile form with tag key-value pairs from the imported JSON
  - Accessible to all scopes; `*:write` can create, edit, and delete; `*:read` can only view
  - Delete with inline confirmation (Confirm/Cancel)
- Always visible in the sidebar (no scope guard for visibility)

---

## 10. Session Detail View

**Purpose:** Inspect a single session's invocations and CloudWatch logs.

**Content:**
- Session metadata card — session_id, qualifier, live status badge, created timestamp
- Invocation table — all invocations with timing data
- Tabbed layout (shadcn Tabs) with **Logs** and **Traces** tabs, defaulting to Logs
- **Logs tab**: Log source selector — dropdown to switch between session-filtered logs (service-level), individual log streams (with simplified stream name display and timezone-aware timestamps), and vended log sources (runtime APPLICATION_LOGS, runtime USAGE_LOGS, memory APPLICATION_LOGS)
- **Traces tab**: Trace list table (Trace ID, Start Time, End Time, Duration, Spans, Events). Description text indicates clicking a trace ID for detail. Clicking a trace shows the interactive `TraceGraph` waterfall timeline with per-span event inspection. Traces are lazy-loaded on first tab activation.
- Log controls — toggle buttons for line numbers (`#` icon, enabled by default) and timestamps (clock icon, enabled by default), plus a Refresh button that cache-busts by appending a `_t` timestamp parameter
- Log viewer — paginated display (200 lines per page) with first/prev/next/last navigation, global line numbering across pages, and "Showing N–M of T log lines" indicator. Pagination controls appear at top and bottom when content exceeds one page.

---

## 11. Design Decisions

### Persona-Based Navigation
Chose a sidebar with persona-based workflows over traditional tab navigation. Each persona represents a distinct user role (catalog browser, agent builder, security admin, memory manager) with its own page and feature set. The sidebar provides persistent access to all personas and includes theme/timezone controls.

### Navigation: Lifted State vs. Router
Chose lifted state in `App.tsx` over React Router. Persona selection and drill-down navigation (within Catalog) are managed via state variables. A router would add unnecessary complexity for this use case.

### Layout: Stacked Single-Column for Agent Detail
Full-width stacked layout gives each section appropriate breathing room. Sessions are shown first as primary context, followed by invoke form, latency summary, response pane, and deployment details.

### Dynamic Expansion: Response Pane and Log Viewer
Both use plain `div` containers with no `max-height` or `ScrollArea` constraint, letting content grow naturally. The log viewer paginates at 200 lines per page with navigation controls to avoid rendering performance issues with large log sets.

### AgentCard Grid Stability
The delete confirmation uses absolute positioning (`absolute inset-x-0 bottom-0`) to overlay the card rather than expanding it, preventing layout shifts in the responsive grid.

### Grouped Searchable Model Selector
Model selection uses `SearchableSelect` with group headers (Anthropic / Amazon). Search matches both display name and model ID value, allowing power users to search by inference profile ID. No default is pre-selected — the user must explicitly choose a model on both register and deploy forms.

### Theme System
10 themes organized into Light and Dark groups:
- **Light:** Ayu Light (white + blue), Catppuccin Latte (cool blue-gray, default), Everforest Light (warm green), Rosé Pine Dawn (warm rose), Solarized Light (warm yellow-blue)
- **Dark:** Ayu Dark (dark blue), Catppuccin Mocha (deep purple-blue), Dracula (vibrant purple), Nord (arctic blue), Tokyo Night (indigo blue)

ThemeContext manages theme state with localStorage persistence. Latte uses `:root` variables (no class); all other themes use CSS class selectors on `<html>`. The `@custom-variant dark` includes all dark theme classes (`dark`, `dracula`, `ayudark`, `nord`, `tokyonight`). Badge `default` and `secondary` variants include `border-border` for visibility across all themes.

**WCAG Accessibility Compliance:**
All themes target WCAG 2.1 AA or better:
- Text contrast (`--foreground`, `--muted-foreground`): ≥ 4.5:1 against their background surface
- Border contrast (`--border`): ≥ 3:1 against adjacent surfaces

Light theme card backgrounds are set to significantly darker surface values (e.g., Latte uses Catppuccin `surface0 #ccd0da` as card, vs. the `base #eff1f5` background) so cards are visually distinct from the page. Dark theme `--muted-foreground` and `--border` values are lightened relative to prior values to satisfy contrast thresholds on dark surfaces.

### Drag-to-Reorder Card Grid with Alphabetical Sorting
`SortableCardGrid` uses @dnd-kit/core + @dnd-kit/sortable for drag-and-drop reordering of cards within grid sections. Order is persisted to localStorage keyed by `storageKey`. Uses `PointerSensor` with 8px activation distance, `rectSortingStrategy`, and `closestCenter` collision detection.

**Default alphabetical sorting:** All cards are sorted alphabetically (case-insensitive, A-Z) on initial load when no persisted custom order exists. The `getName` prop extracts the display name from each item for sorting. New items not in a persisted order are sorted alphabetically among themselves and appended after persisted items.

**Sort toggle control:** A standalone `SortButton` component (ArrowDownAZ/ArrowUpAZ icons) is placed inline with each section header, next to "Add" buttons. Sort direction is controlled by the parent component and persisted to localStorage per grid (keyed as `loom-sort-${storageKey}`). `SortableCardGrid` accepts `sortDirection` as a controlled prop. After applying a sort option, drag-to-reorder still works — once the user drags a card, the new order becomes the custom order, the sort direction is cleared via the `onSortDirectionChange(null)` callback, and the custom order is persisted. Exported helpers: `loadSortDirection()`, `saveSortDirection()`, `toggleSortDirection()`.

**Table view column sorting:** Pages with table views (CatalogPage, AgentListPage, MemoryManagementPanel, McpServersPage, A2aAgentsPage) use `SortableTableHead` for clickable column headers. Clicking a column header sorts by that column (ascending); clicking again reverses to descending. An arrow indicator (ArrowUp/ArrowDown) shows the active sort column and direction. The `sortRows()` helper provides generic multi-column sorting with support for both string and numeric values.

**Table column layout standards:**
- **Agent tables** (AgentListPage, CatalogPage): Name 26%, Status 10%, Cost 12%, Protocol 12%, Network 12%, Region 12%, Registered 16%.
- **Memory tables** (MemoryManagementPanel, CatalogPage): Name 26%, Status 10%, Cost 12%, Strategies 12%, Event Expiry 12%, Region 12%, Registered 16%.
- **MCP Server tables** (McpServersPage, CatalogPage): Name 18%, Endpoint 46%, Transport 10%, Auth 10%, Created 16%.
- **A2A Agent tables** (A2aAgentsPage, CatalogPage): Name 18%, URL 46%, Version 10%, Auth 10%, Created 16%. Matches MCP structure — no Provider or Status column.
- All tables use `table-fixed` with the above widths summing to 100%. Delete/refresh operations are card-view only; no action columns in tables.

**Applied to all card grids:** CatalogPage (agents, memories), AgentListPage (agents), MemoryManagementPanel (memories), TaggingPage (policies, profiles), RoleManagementPanel (roles, full-width single-column), AuthorizerManagementPanel (authorizers), PermissionRequestsPanel (permissions).

### Registry `registryEnabled` Pattern
All pages displaying registry UI elements (RegistryStatusBadge, RegistryActions) fetch `getRegistryConfig()` on mount and maintain a `registryEnabled` boolean state. When registry is disabled (no ARN configured in Settings), all registry badges and action buttons are hidden:
- `RegistryStatusBadge` accepts a `registryEnabled` prop (default `true`). When `false`, returns `null` regardless of status.
- `RegistryActions` rendering is gated at each render site via `{registryEnabled && <RegistryActions ... />}`.
- `AgentCard` accepts `registryEnabled` (default `true`) and passes it to its embedded `RegistryStatusBadge`.
- Applied consistently across CatalogPage, AgentListPage, McpServersPage, and A2aAgentsPage in both card and table views.

### Tailwind CSS v4 (Vite Plugin)
Using the `@tailwindcss/vite` plugin instead of PostCSS. Configuration is handled via CSS `@theme` blocks in `index.css`.

### Timezone-Aware Timestamps
All timestamps use shared utilities in `src/lib/format.ts`. A `TimezoneContext` stores the user's preference ("local" or "UTC"), applied globally.

### SearchableSelect Component
Custom combobox with click-outside detection, filtered option list, check mark for selected item, and optional group headers. Accepts a `className` prop for width control. Filter matches both `label` and `value` fields.

### JsonConfigSection Component
Shared collapsible component for JSON import/export on forms. Encapsulates the collapse/expand toggle (ChevronRight/ChevronDown), monospace textarea, and Apply/Export/Cancel button row. Props: `onApply(json) => string | null` (returns error or null on success), `onExport() => string`, optional `label` and `placeholder`. On successful apply, the input clears and the section auto-collapses. On export, the serialized JSON is written to the textarea and the section expands if collapsed. Used by both `AgentRegistrationForm` and `MemoryManagementPanel` to ensure consistent behavior. Export produces human-readable JSON (model ID for agents, role names, profile names rather than internal IDs) that is valid input for import (round-trip capable).

### TagInput Pattern
Inline component for adding/removing tag-style values (clients, scopes). Single textbox with Enter to add, badge with X to remove.

### Secrets Handling
Cognito client secrets are password-masked in forms. Secrets are sent to the backend which stores them in AWS Secrets Manager — they never persist in the frontend or local database.

### User Authentication
- `AuthContext` provides login, logout, token refresh, user state, and scope-based authorization to the entire app.
- Tokens (id, access, refresh) are stored in React state only — never in localStorage or cookies.
- On logout, all `loom:invokePrompt:*` keys are cleared from `sessionStorage` so per-agent prompt drafts do not persist across user sessions.
- The `AuthProvider` wraps the app at the top level (outside `TimezoneProvider`). If Cognito is not configured (empty pool ID from backend or missing `VITE_COGNITO_USER_CLIENT_ID`), authentication is bypassed and all scopes are granted.
- The user client ID is configured via the `VITE_COGNITO_USER_CLIENT_ID` Vite environment variable (in `frontend/.env`), not fetched from the backend. The backend only provides the pool ID and region via `GET /api/auth/config`.
- `LoginPage` renders when the user is not authenticated. It handles the `NEW_PASSWORD_REQUIRED` challenge for admin-created Cognito users.
- Access tokens are automatically refreshed 60 seconds before expiry using the refresh token.
- The user indicator (username + logout button) is shown in the sidebar footer, above the theme selector.
- `apiFetch` and `invokeAgentStream` automatically include the `Authorization: Bearer` header when a token is available, via a module-level token setter (`setAuthToken`/`getAuthToken`).
- On 401 responses, `apiFetch` calls a registered `onUnauthorized` callback that refreshes the Cognito access token via `REFRESH_TOKEN_AUTH` and retries the failed request. This prevents expired token errors during long sessions.

### Scope-Based Authorization
- `AuthContext` extracts `cognito:groups` from the decoded ID token and maps them to scopes using a `GROUP_SCOPES` lookup table (must match the backend `GROUP_SCOPES` exactly). The `hasScope(scope)` function is exposed to the entire app.
- Scopes (21 total): `invoke`, `catalog:read`, `catalog:write`, `agent:read`, `agent:write`, `memory:read`, `memory:write`, `security:read`, `security:write`, `settings:read`, `settings:write`, `tagging:read`, `tagging:write`, `costs:read`, `costs:write`, `mcp:read`, `mcp:write`, `a2a:read`, `a2a:write`, `registry:read`, `registry:write`.
- Two-dimensional group architecture:
  - **Type groups**: `t-admin` (admin UI), `t-user` (user UI) — determine layout and default navigation
  - **Resource groups**:
    - `g-admins-super`: All 21 scopes (full access)
    - `g-admins-demo`: Read/write to most pages including MCP and A2A + demo group resources
    - `g-admins-security`, `g-admins-memory`, `g-admins-mcp`, `g-admins-a2a`: Domain-specific admin scopes
    - `g-admins-registry`: `mcp:read`, `a2a:read`, `registry:read`, `registry:write`, `settings:read`, `settings:write`, `tagging:read`
    - `g-users-demo`, `g-users-test`, `g-users-strategics`: invoke + group-filtered read access
- Sidebar visibility is controlled by scopes — each persona item is rendered only when the user has the corresponding `*:read` or `*:write` scope. Platform Catalog, Tagging, and Settings are always visible.
- Write operations are gated by a `readOnly` prop propagated from `App.tsx` through page components to individual UI elements. When `readOnly` is true, add/edit/delete buttons are disabled or hidden.
- Pages and their `readOnly` mapping: `AgentListPage` and `CatalogPage` use `!hasScope("agent:write")`, `SecurityAdminPage` uses `!hasScope("security:write")`, `MemoryManagementPage` uses `!hasScope("memory:write")`, `TaggingPage` uses `!hasScope("tagging:write")`.
- Components that respect `readOnly` and `userGroups`: `AgentCard`, `AgentListPage`, `CatalogPage`, `SecurityAdminPage`, `RoleManagementPanel`, `AuthorizerManagementPanel`, `PermissionRequestsPanel`, `MemoryManagementPage`, `MemoryManagementPanel`, `MemoryCard`, `TaggingPage`.
- Demo-admin restrictions: Delete buttons hidden for resources not in demo group via `userGroups` prop. Tag policy edit restricted to super-admins only. Tag profile edit restricted by group ownership.

### Resource Tagging
- Tag policies use a two-tier designation system: `platform:required` (keys starting with `loom:`) and `custom:optional` (all others). Designation is computed from the key, not stored. Filter categorization uses the `required` flag, not key prefix.
- Tag policies are fetched from `/api/settings/tags` and used to derive `showOnCardKeys` for tag badge display and filter dropdowns.
- Tag profiles are named presets managed via the Tagging page. The `ResourceTagFields` shared component renders a profile dropdown (persisted in `sessionStorage` as `loom:selectedTagProfileId`), resolves tags from the selected profile + policy defaults, displays all profile tags as badges, and calls `onChange(tags)`. Used by both agent deploy and memory create forms.
- `ResourceTagFields` accepts an optional `groupRestriction` prop. When set (for demo-admins), only profiles whose `loom:group` matches the restriction are shown, and the resolved `loom:group` tag is forced to the restriction value. `MemoryManagementPanel` also receives `groupRestriction` for the same purpose.
- Tag resolution: for each policy, use user-supplied value → fall back to `default_value` (only for required policies) → error if required and missing. Custom/optional tags only appear when the profile explicitly sets them. The previous `source` (build-time/deploy-time) distinction has been removed.
- `showOnCardKeys` (derived from tag policies with `show_on_card=true`) is filtered by the eyeball toggle to produce `effectiveShowOnCardKeys`, which is passed as a prop to `AgentCard` and `MemoryCard` components from all listing pages.
- Tag badges use `variant="secondary"` to visually distinguish them from status and protocol badges.
- **Progressive disclosure filtering:** All listing pages (CatalogPage, AgentListPage, MemoryManagementPanel) split show-on-card policies into required and custom using the `required` flag. The filter bar renders in order: required filters → eyeball toggle → activated custom filters → "custom filters" Add dropdown → Clear filters → item count. All label rows use fixed `h-4 flex items-center` wrappers for consistent visual alignment. Custom `AddFilterDropdown` component (not Radix Select) provides the "Add filter" dropdown with click-outside-to-close behavior.
- **Custom tag show/hide toggle:** An Eye/EyeOff button in the filter bar (positioned left of custom filter dropdowns) toggles visibility of custom tags on agent and memory cards. The preference is persisted to `localStorage` as `loom:showCustomTags`. When hidden, only required tags appear on cards; filtering still works independently.
- **Filter persistence:** Both `tagFilters` and `activeCustomFilterKeys` are persisted to `localStorage` per page (e.g., `loom:tagFilters:agents`, `loom:customFilterKeys:catalog`) so filter state survives page navigation.
- Filter state uses `Record<string, string[]>` to support multiple selected values per tag key with AND logic.

### MultiSelect Component
Custom dropdown with checkboxes for multi-value selection. Uses `min-w-[140px]` with auto-expanding width to fit content (no truncation). Closes on outside click via `mousedown` event listener. Shows "All" when no values selected, the value when one is selected, or "N selected" for multiple. Uses `bg-input-bg` to match the existing `Select` component styling.

### AddFilterDropdown Component
Custom dropdown for adding custom tag filters to the filter bar. Uses a plain `<button>` with an absolute-positioned option list (not Radix Select, which has issues with empty controlled values). Shows a Plus icon and "Add filter" label, with a ChevronDown indicator. Closes on outside click via `mousedown` event listener. Each option triggers `onSelect` and closes the dropdown. Matches `MultiSelect` styling (`h-7`, `min-w-[140px]`, `bg-input-bg`).

### Pydantic Error Handling
`apiFetch` in `client.ts` handles Pydantic validation errors where `detail` is an array of objects (not a string). Array entries are mapped to their `msg` fields and joined with `"; "` for display. This prevents `[object Object]` from appearing in error toasts.

### API Layer Design
- `apiFetch<T>()` is a thin wrapper around `fetch` with JSON parsing, `ApiError` class, automatic auth token injection, and 401 auto-refresh (intercepts unauthorized responses, refreshes the token, and retries once)
- Each API domain (agents, auth, invocations, logs, security) is a separate module with typed functions
- `api/a2a.ts` — A2A agent operations: CRUD, test connection, card retrieval/refresh, skills, access rules

### Session Liveness Display
Computed server-side using `LOOM_SESSION_IDLE_TIMEOUT_SECONDS`. The frontend displays `live_status` with color-coded badges and `active_session_count` on agent cards.

### View Mode Persistence
Card/table view mode state is lifted to `App.tsx` with separate state variables per page (`catalogViewMode`, `agentsViewMode`, `memoryViewMode`). Each page receives its mode and setter as props. This ensures the selection persists when switching between personas — the page components unmount but the state lives in the parent.

### Deploy Flow
Agent deployment uses a fire-and-forget pattern. The form collapses immediately on deploy, the backend creates a DB record before starting the AWS call, and `fetchAgents()` picks up the new record. The `useAgents` hook polls transitional agents (deploying/CREATING/endpoint CREATING) at 2-second intervals using a `watchIds` effect dependency. Smart polling: during local build phases (`creating_credentials`, `creating_role`, `building_artifact`, `deploying`), the backend returns DB state without AWS API calls. An `initialLoadDone` ref prevents skeleton flash on subsequent fetches. Agent cards show two-phase creation status: deploying → completing deployment → finalizing endpoint, with a timer using `registered_at` to avoid resets on phase transitions. Agent deletion with AWS cleanup follows a matching async pattern: the DELETE endpoint marks the agent as DELETING, the hook polls at 2-second intervals, detects 404 when the runtime is fully deleted, uses a background task for DB purge after runtime is confirmed deleted, and shows a success toast.

### SSE Stream Consumer
`invokeAgentStream()` uses `ReadableStream` to consume POST-based SSE responses with buffer-based line parsing, typed callback dispatch, and `AbortSignal` for cancellation.

### Queued Prompt (ChatPage)
The input textarea remains enabled during streaming. Sending a message while a response is streaming enqueues it (single slot, last-write-wins). The queued message appears as a dimmed bubble (`bg-primary/50`) with a cancel (X) button and full markdown rendering. It auto-sends when streaming completes (skipped on error). Switching agents or starting a new conversation discards the queued message. Send and cancel-stream buttons are independent (both visible during streaming).

### Deploy Card
When a deploy starts, `AgentListPage` records the deploying agent name and triggers an immediate `fetchAgents()` to pick up the DB record (created before the AWS API call). The `useAgents` hook handles ongoing polling for transitional agents. This replaced the earlier ephemeral card approach which caused position glitches when the real agent appeared.

### Friendly Error Messages
`lib/errors.ts` provides `friendlyInvokeError(raw: string, authorizerName?: string): string` that maps raw error strings to user-friendly messages using pattern matching. When an `authorizerName` is provided (from the agent's `authorizer_config`), 401/403 errors include a hint about which authorizer to use. The `useInvoke` hook stores both the friendly error (for display) and the raw error (for the 'Show details' toggle). This keeps error UX readable while preserving debugging information.

### Credential Suggestion on Errors
`friendlyInvokeError()` accepts an optional `authorizerName` parameter (from the agent's `authorizer_config`). On 401/403 errors, if the agent has a configured authorizer, the error message includes a hint like: 'This agent uses the "authorizer-name" authorizer — make sure you select a credential from that authorizer.' This helps users identify the correct credential without trial and error.

### Authorizer Display on Agent Cards
Agent cards show the configured authorizer in the metadata section. The backend extracts `customJWTAuthorizer` configuration from the AgentCore `describe_runtime` response on import and refresh, stores it as JSON in the `authorizer_config` column, and returns it in the agent response. The frontend renders: "Cognito" for cognito type, the authorizer name if available, "external" for unknown types, or muted "None" when absent.

### Manual Bearer Token Input
The invoke panel's credential dropdown includes a "Manual token" sentinel value. Selecting it reveals a password input for pasting a raw bearer token. The token is passed in the invoke request body as `bearer_token` and takes highest priority (Priority 0) in the backend's token selection chain — above user tokens, credential-based tokens, and agent config tokens.

### Hooks
- `useA2aAgents()` — A2A agent list with auto-fetch, CRUD callbacks, toast notifications

### Key Components
- **A2aAgentForm** — Create/edit form for A2A agents with base URL input and progressive OAuth2 disclosure (auth_type toggle reveals well-known URL, client ID, secret, scopes). Test connection button in edit mode.
- **A2aAgentCardView** — Structured display of the full Agent Card: header (name, version, status, provider, documentation, refresh button with last-fetched timestamp), capabilities (streaming, push notifications, state history as enabled/disabled badges), authentication schemes, input/output mode badges, and skills list.
- **A2aSkillList** — Expandable skill cards with name, skill ID, description, tag badges, examples (bulleted list), and input/output mode overrides.
- **A2aAccessControl** — Per-persona access control for A2A agent skills. Checkbox to grant/revoke access, all_skills/selected_skills radio, individual skill checkboxes with descriptions. Deny by default.

### Views

| View | Persona | Description |
|------|---------|-------------|
| A2aAgentsPage | A2A Agents | A2A agent CRUD, agent detail with Agent Card and Access tabs, card/table views |
| CostDashboardPage | Costs | Cost dashboard with time-range selector (7d/30d/90d/All), summary cards (Total Cost, Model Tokens, Runtime, Memory), Estimated Costs table with per-agent breakdown and methodology formulas, Actual Costs with separate Runtime and Memory sub-sections, collapsible agent groups for Runtime, consolidated per-resource rows for Memory, sortable columns |

### Token Usage and Cost Display

- **LatencySummary** renamed to "Invocation Metrics": single-row layout with 7 metrics — Client Invoke, Agent Start, Cold Start, Duration, Input Tokens, Output Tokens, Est. Cost.
- **InvocationTable**: 3 additional columns — Input Tokens, Output Tokens, Est. Cost with formatting helpers.
- **AgentCard**: READY status badge hidden; cost badge shown when `total_estimated_cost > 0`.
- **Agent table view**: Includes an Estimated Cost column (12%) showing the agent's total estimated cost from `cost_summary.total_cost`. Formatted as `~N.NNNNNN` for costs below $0.01 or `~N.NNNN` otherwise. Shows `—` (U+2014) when no cost data is available.
- **Memory table view**: Includes an Estimated Cost column (12%) showing `cost_summary.total_memory_estimated_cost`. Same formatting as agent cost column.
- **MemoryCard**: ACTIVE status badge hidden for visual cleanliness.
- **CostDashboardPage**: Three-section cost dashboard:
  - **Summary cards**: Total Cost (Model + Runtime + Memory), Model Tokens (with invocation count), Runtime (CPU + Mem breakdown), Memory (STM + LTM breakdown).
  - **Estimated Costs table**: Per-agent breakdown with columns Agent, Model, Invocations, Model Tokens, AgentCore Runtime, AgentCore Memory, Per Invoke, Total. Single-row per agent with sub-details as `text-[10px]` inline divs (token in/out, CPU+Mem split, STM+LTM split). Methodology formulas displayed below header. Sortable columns via `SortableTableHead`. Estimates disclaimer: costs are estimates based on token heuristics and pricing defaults.
  - **Actual Costs** with separate Runtime and Memory sub-cards:
    - **Runtime**: Collapsible agent groups — each agent row shows agent name, session count, total CPU cost, total memory cost, and subtotal. Expand to see individual session rows with event counts, time range, resource hours (vCPU·h, GB·h), and per-session costs. Sortable at the agent level. Description: "Costs from runtime USAGE_LOGS for the runtime within the time window. CPU I/O wait discount: N%, configurable in Settings." Note: USAGE_LOGS session IDs are internal to AgentCore and do not match Loom's runtimeSessionId.
    - **Memory**: Consolidated per-resource table with columns Memory, Log Events, Extractions, Consolidations, LTM Retrievals, Records Stored, Total. One row per memory resource. Sortable columns. Description: "Costs from memory APPLICATION_LOGS. Memory pipeline session IDs are internal to AgentCore and do not correlate with runtime session IDs."
    - NOTE: "Delivery of usage logs for calculating actual costs can be delayed. If costs are not showing up, try again in 15 minutes."
  - Pull Actuals button with loading timer. Module-level cache preserves actuals across page navigation.
  - Time-range selector: 7d, 30d, 90d, All buttons. Changing time range clears cached actuals.
- **SettingsPage**: CPU I/O Wait Discount input (0–99%) with save-on-blur and Enter key support. Description: "Assumed % of CPU time spent waiting on I/O. Applied as a discount to runtime CPU cost across estimates and actuals."

---

## 12. Admin Dashboard

**Purpose:** Platform usage analytics for super-admins. Accessible only via `isAdmin` check — the sidebar item is hidden for non-admin users.

**Auth context additions:**
- `browserSessionId: string | null` — UUID generated at login via `crypto.randomUUID()`, stored in React state (not localStorage). Resets on page refresh or re-login to distinguish usage sessions.
- On login: `recordLogin(username, browserSessionId)` is called fire-and-forget via `audit.ts`.
- On logout: `browserSessionId` is cleared to `null`.

**Page view tracking (`App.tsx`):**
- A `pageEntryRef` records `{persona, enteredAt}` for the currently active persona.
- When `activePersona` changes, the previous page's duration is computed and `recordPageView` is called fire-and-forget.
- A `beforeunload` listener uses `navigator.sendBeacon` to POST the final page view when the tab is closed.

**Action tracking (`audit.ts` → `trackAction`):**
- `trackAction(userId, browserSessionId, category, type, resourceName?)` — fire-and-forget wrapper around `recordAction`.
- Called at the point of submission (before the API call, not on success) in all page and component handlers.
- Categories and actions instrumented:

| Category | Actions |
|----------|---------|
| `agent` | `deploy`, `import`, `invoke`, `redeploy`, `delete`, `remove_conversation` |
| `memory` | `create`, `import`, `delete` |
| `security` | `add_role`, `delete_role`, `add_authorizer`, `add_credential`, `delete_authorizer`, `approve_request`, `deny_request` |
| `tagging` | `add_tag`, `edit_tag`, `delete_tag`, `add_profile`, `edit_profile`, `delete_profile` |
| `mcp` | `add_server`, `delete_server`, `test_connection`, `invoke_tool`, `update_permissions` |
| `a2a` | `add_agent`, `delete_agent`, `test_connection`, `update_permissions` |

`remove_conversation` is emitted from `ChatPage` when a user removes a conversation from the sidebar (calls `hideSession` then records the action with the agent name as the resource name).

**Dashboard layout (`AdminDashboardPage.tsx`):**
- **Global user filter:** Multi-select dropdown in the header (labeled "Users:") listing all unique user IDs from the loaded data. Selecting users filters all summary cards, charts, and tab tables to only that subset. When no users are selected ("All users"), the full unfiltered data is shown. When a filter is active, summary stats are recomputed client-side from the filtered sessions, actions, and page views (rather than relying on the API summary, which is unfiltered). Pagination page counters reset when the filter changes.
- Time range selector: Today / Last 7 days / Last 30 days / All time.
- Summary cards (5): Total Logins, Total Page Views, Total Actions, Total Duration, Most Active Page. Stats reflect the active user filter when set.
- Charts (recharts, 3): Logins Over Time (bar chart, daily), Actions Over Time (bar chart, daily), Page Views by page name (horizontal bar chart). All charts use custom tooltip components for consistent theme-aware styling. Chart data reflects the active user filter.
- Tabs (3): Sessions, Actions, Page Views.
  - **Sessions:** Table of aggregated browser sessions (session ID, user, login time, last activity, page view count, action count, duration). Clicking a row shows the full interleaved event timeline (logins, actions, page views). Filtered by the global user filter.
  - **Actions:** Table with category and action type filters. Filtered by the global user filter.
  - **Page Views:** Table with page name filter. Filtered by the global user filter.

---

## 13. End-User Chat Interface

**Purpose:** A consumer-oriented chat experience for end-users (`t-user` group). Hides all admin functionality and presents a clean, focused interface for interacting with agents.

### Routing

After authentication, `App.tsx` checks whether the effective user (real or "view as") belongs to the `t-user` type group and not `t-admin`. If so, `ChatPage` is rendered instead of the admin layout. Admins can switch to end-user mode via the "View as" dropdown by selecting any `demo-user-*` or `test-user` account.

A "Previewing end-user experience as [user]" banner is shown to admins when in view-as mode, with an "Exit preview" button that returns to the admin layout.

### ChatPage (`frontend/src/pages/ChatPage.tsx`)

**Layout:** Two-column with a narrow left sidebar and a main chat area. An optional right panel shows memory information. Content is centered with a max-width on wide screens.

**Sidebar contents:**
- Logo
- Agent picker — shown only when multiple agents are accessible; auto-selected when only one exists
- "New Conversation" button
- Conversation history list (past sessions for the current user, showing date/time and message count)
- "My Memory" button (shown only when the selected agent has memory resources attached)
- User indicator and logout button

**Agent filtering:** Agents are filtered client-side by comparing the agent's `loom:group` tag against the user's `g-users-*` group names. An agent with no `loom:group` tag is visible to all users.

**Chat area:**
- Header with agent name and "responding..." indicator while streaming (scoped to the active conversation)
- Scrollable message history with alternating user (right-aligned, primary color) and assistant (left-aligned, muted) bubbles
- In-flight messages displayed during streaming: user prompt bubble immediately, streaming assistant bubble with animated cursor and thinking spinner
- Markdown rendering for all message bubbles (user, assistant, and queued) via `react-markdown` + `remark-gfm`: paragraphs, headings (h1–h3), ordered/unordered lists, tables, blockquotes, inline code, fenced code blocks, bold, links. Assistant responses additionally render JSON code blocks as collapsible `CollapsibleJsonBlock` components (click to expand/collapse).
- Error display as styled text in the chat area
- Text input at the bottom (Enter to send, Shift+Enter for newline), with Send/Cancel buttons

**Session management:**
- New conversations start with no session ID; a new `InvocationSession` is created automatically on first invocation
- **Immediate session tab creation:** On `session_start` SSE event, the new session is immediately added to the sidebar conversation list and auto-selected (highlighted). The conversation tab appears as soon as the agent acknowledges the invocation — before the response finishes streaming.
- After each invocation, `sessionEnd.session_id` is captured and used for subsequent messages in the same conversation
- On `sessionEnd`, messages are loaded from the backend via `getSession()` as the authoritative source. `setPendingPrompt(null)` is deferred until after `setMessages()` completes, preventing the streaming bubbles from disappearing before persisted messages are ready.
- Resuming a past session calls `getSession()` and reconstructs the message history from `invocation.prompt_text` / `invocation.response_text` pairs
- Removing a conversation calls `hideSession()`, records a `remove_conversation` audit action via `trackAction`, and clears the chat area if the removed session was active. The remove button is shown on all owned sessions except the one currently streaming — sessions with an active AgentCore Runtime session (but not actively streaming a response) are removable.

**Streaming state scoping:**
- `isCurrentlyStreaming` is derived as `isStreaming && (!sessionStart || sessionStart.session_id === currentSessionId)`. The thinking spinner, streaming bubble, and "responding..." header text are all conditioned on `isCurrentlyStreaming`, not `isStreaming`. This prevents streaming UI from leaking into unrelated conversations when the user switches sessions mid-stream.

**`useInvoke` subscription stability:**
- `clearInvokeState(agentId)` resets the module-level store to `EMPTY` and notifies subscribers, but does NOT remove the listener set for the agent. This keeps the component's subscription alive after "New Conversation" so that subsequent invocations correctly propagate to the UI. Deleting the listener entry (the prior behavior) caused a silent state-update drop where streams ran to completion without any React re-renders.

**Abstractions (admin details hidden):**
- No qualifier picker (always uses `DEFAULT`)
- No credential selector (uses default)
- No session ID display
- No bearer token input

### Memory Panel

Accessible via the "My Memory" sidebar button when the selected agent has memory resources.

**Session Memory section:**
- Shows the current conversation's exchange count
- Lists any custom-strategy names/descriptions from attached memory resources

**"What I Remember About You" section (long-term):**
- Shown only when at least one long-term strategy exists (`semantic`, `summary`, `user_preference`, `episodic`)
- Displays each strategy's admin-configured `name` and `description` as user-facing labels
- No memory IDs, ARNs, namespaces, strategy types, or configuration objects exposed

**User isolation:**
- Session list filtered server-side via the `user_id` query parameter passed to the `list_sessions` API; the frontend passes `currentUserId` from Cognito auth to scope sessions per user
- Session list refresh is suppressed while an invocation is actively streaming (`isStreaming` guard) to prevent race conditions between auth resolution and session state
- Memory content is managed by the agent; the panel shows strategy metadata only

---

## 14. Future Work

- **VPC network mode** support
- **Operate Tab** — aggregate dashboard with summary cards, per-agent latency charts
- **Real-time auto-refresh** of sessions and metrics
- **Log stream selection** and agent-level log viewer
- **Latency charts** using Recharts
- **Memory integration** with agent deployment (attach memory to agents)
