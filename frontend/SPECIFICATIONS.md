# Loom Frontend — Specifications

## 1. Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18 with TypeScript |
| Build tool | Vite 6 |
| UI components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS v4 (Vite plugin, no PostCSS) |
| Theme | 10 themes: 5 light + 5 dark (Catppuccin, Rosé Pine Dawn, Ayu, Everforest, Solarized, Dracula, Gruvbox, Nord, Tokyo Night) |
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
│   │   ├── memories.ts         # Memory resource CRUD + refresh
│   │   ├── security.ts         # Security admin: roles, authorizers, credentials, permissions
│   │   └── settings.ts        # Settings API: tag policy + tag profile CRUD
│   ├── contexts/
│   │   ├── AuthContext.tsx      # Cognito auth provider (login, logout, token refresh)
│   │   ├── TimezoneContext.tsx  # Timezone preference provider + hook
│   │   └── ThemeContext.tsx     # Theme provider with 10 themes, localStorage persistence
│   ├── hooks/
│   │   ├── useAgents.ts        # Agent list state + CRUD actions
│   │   ├── useSessions.ts      # Session list state per agent
│   │   ├── useInvoke.ts        # Streaming invocation state + AbortController
│   │   ├── useLogs.ts          # Session log fetching
│   │   └── useDeployment.ts    # Agent config, credential providers, integrations hooks
│   ├── components/
│   │   ├── ui/                 # shadcn primitives + searchable-select.tsx + multi-select.tsx + add-filter-dropdown.tsx
│   │   ├── SortableCardGrid.tsx — Drag-to-reorder card grid using @dnd-kit, localStorage persistence
│   │   ├── AgentCard.tsx       # Agent summary card with refresh + Trash2 icon deletion
│   │   ├── AgentRegistrationForm.tsx  # Tabbed form: ARN registration + agent deployment
│   │   ├── AuthorizerManagementPanel.tsx # Authorizer config + credential management
│   │   ├── MemoryCard.tsx              # Memory resource summary card
│   │   ├── MemoryManagementPanel.tsx    # Memory resource create form + list table
│   │   ├── ResourceTagFields.tsx       # Shared tag profile selector + tag resolution
│   │   ├── DeploymentPanel.tsx # Deployment details panel
│   │   ├── InvokePanel.tsx     # Qualifier select, credential select, prompt input, invoke/cancel
│   │   ├── LatencySummary.tsx  # Timing breakdown
│   │   ├── SessionTable.tsx    # Clickable session list
│   │   ├── InvocationTable.tsx # Invocation timing data
│   │   └── LogViewer.tsx       # Scrollable log viewer
│   ├── pages/
│   │   ├── AgentListPage.tsx   # Agents persona: registration form + agent grid
│   │   ├── AgentDetailPage.tsx # Sessions, latency, invoke, response
│   │   ├── CatalogPage.tsx     # Platform Catalog: agents, memory, MCP, A2A sections
│   │   ├── SecurityAdminPage.tsx  # Security persona: roles, authorizers, credentials, permissions
│   │   ├── LoginPage.tsx        # Cognito login + NEW_PASSWORD_REQUIRED challenge
│   │   ├── MemoryManagementPage.tsx # Memory persona: memory resource management
│   │   ├── TaggingPage.tsx         # Tagging persona: tag policy + tag profile CRUD
│   │   ├── SettingsPage.tsx        # Settings persona: display preferences
│   │   └── SessionDetailPage.tsx  # Session metadata, invocations, logs
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
├── components.json             # shadcn configuration
├── makefile
└── SPECIFICATIONS.md           # This file
```

---

## 3. Application Shell

The app uses a persona-based single-page architecture with a sidebar for workflow selection:

### Persona Navigation (Sidebar)

| Persona | Icon | Description | Required Scope | Default |
|---------|------|-------------|----------------|---------|
| Platform Catalog | BookOpen | Browse agents, memory resources, MCP servers (coming soon), A2A agents (coming soon) | Always visible | Yes |
| Agents | Bot | Deploy new agents or import existing ones | `agent:read` or `agent:write` | |
| Memory | Brain | Create and manage AgentCore Memory resources | `memory:read` or `memory:write` | |
| Security Admin | Shield | Manage roles, authorizers, credentials, permissions | `security:read` or `security:write` | |
| Tagging | Tags | Manage tag policies and tag profiles | Always visible | |
| Settings | Settings | Manage display preferences | Always visible | |
| MCP Servers | Network | Future MCP server management (disabled) | `mcp:read` or `mcp:write` | |
| A2A Agents | Users | Future A2A agent management (disabled) | `a2a:read` or `a2a:write` | |

Sidebar items are conditionally rendered based on the user's scopes derived from their Cognito group membership. When auth is not configured, all items are visible.

The sidebar also contains:
- User indicator with username display and logout button (when authenticated)
- Live clock display
- Version badge

### Admin View Switching
Admin users see an Eye icon dropdown in the sidebar header that lets them simulate other roles (security-admins, data-stewards, builders, operators). This overrides scope checks via `effectiveHasScope` so the admin can see what each role's experience looks like, without losing admin access. The dropdown resets when the page is refreshed.

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
- Page header: "Platform Catalog" with card/table view toggle (top-right)
- Organized into sections: Agents, Memory Resources, MCP Servers (coming soon), A2A Agents (coming soon)
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
- Spinner animation when agent is in a creating/deploying state
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

---

## 5. Agents View (Agent Administration)

**Purpose:** Deploy new agents or import existing ones to AgentCore Runtime.

**Content:**
- Page header: "Agent Administration" with card/table view toggle (top-right)
- Sub-header: "Agents" with description and "Add Agent" button (right-aligned)
- "Add Agent" toggles a Card containing Deploy/Import tab switcher and `AgentRegistrationForm`
- When deploy succeeds, the form collapses and an ephemeral `AgentCard` appears at the top of the grid with CREATING status and spinner/timer. Once the real agent appears in the agents list, the ephemeral card is removed.
- Below the form: responsive grid of `AgentCard` components (cards default) or table view
- Bottom section: "Additional Configuration" with MCP Servers and A2A Agents placeholders (coming soon)

### Import Tab

- ARN text input and Model selector on the same line (ARN fills remaining space, model is fixed width)
- Labels: "AgentCore Runtime ARN" and "Model Used"
- Model selector uses `SearchableSelect` with grouped options (Anthropic / Amazon), no default selection
- Import button with `min-w-[120px]` to prevent layout shift during loading spinner

### Deploy Tab

Full deployment form with sections:
- **JSON Paste**: Collapsible section (ChevronDown/ChevronRight toggle) with monospace textarea for pasting JSON agent configuration. Maps `name`, `description`, `persona` (→ agent description), `instructions` (→ behavioral guidelines), `behavior` (→ output expectations). Apply/Cancel buttons. Invalid JSON shows inline error without clearing existing fields.
- **Agent Identity**: name (1/3 width) and description (2/3 width)
- **System Prompt**: agent description, behavioral guidelines, output expectations — each with placeholder examples
- **Model / Protocol / Network / IAM Role**: single flex row with explicit widths (20% / 10% / 10% / flex-1). Model uses `SearchableSelect` with grouped options, no default selection. Protocol offers HTTP as selectable; MCP and A2A shown as disabled. Network offers PUBLIC; VPC shown as disabled. IAM Role uses a `SearchableSelect` with searchable dropdown. Both model and IAM role are required — deploy button is disabled until both are selected.
- **Role Permissions (read-only)**: collapsible section shown after IAM role selection, displays policy document. Clicking the header toggles visibility.
- **Authorizer**: radio selection of None, Cognito, or Other. Authorizer dropdown is 25% width, shows just the authorizer config name. Fields show "Allowed Clients" and "Allowed Scopes".
  - Cognito: searchable Cognito pool select (30% width), auto-populated discovery URL, tag inputs for allowed clients and scopes, app client ID and client secret fields
  - Other: textbox for discovery URL, tag inputs for allowed clients and scopes
- **Lifecycle**: idle timeout and max lifetime fields with dynamic placeholders fetched from `/api/agents/defaults` (e.g., "300" and "3600")
- **Resource Tags**: `ResourceTagFields` component with tag profile dropdown (persisted in `sessionStorage`). Deploy-time tags are auto-applied; build-time tags are resolved from the selected tag profile.
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
- Credential selector populates from all authorizer configs and their credentials, plus a "Manual token" option
- When a credential is selected, the `credential_id` is passed with the invoke request
- When "Manual token" is selected, a password input field appears for entering a raw bearer token; the `bearer_token` is passed with the invoke request
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
  - **Managed Roles**: list, create (import existing / wizard), view policy document, delete
  - **Authorizer Configs**: list, create (Cognito type with pool selection and auto-populated discovery URL), update, delete
  - **Authorizer Credentials**: per-config credential management (add label + client_id + client_secret, list, delete). Credential form uses 1/4 / 1/4 / 1/2 field widths. Authorizer type displayed as "Amazon Cognito" for cognito type.
  - **Permission Requests**: create requests for additional IAM permissions, review (approve/deny) with role application

---

## 8. Memory Management View (Memory Administration)

**Purpose:** Create new AgentCore Memory resources with configurable strategies or import existing ones.

**Layout:** Page header "Memory Administration" with card/table view toggle (top-right), followed by "Add Memory" button, create form (toggle), and memory list (cards default or table).

### Create Form

Toggled via the "Add Memory" button. Contained in a `Card` with the following fields:

- **Name** (required, flex-1) and **Event Expiry** (days, fixed 140px width) — same row
- **Description** — full width, optional
- **Memory Execution Role ARN** and **Encryption Key ARN** — 2-column grid, optional
- **Strategies** — dynamic list, each strategy in a dashed-border card:
  - **Type** (Select: Semantic, Summary, User Preference, Episodic, Custom) and **Name** — same row
  - **Description** — full width, optional
  - **Namespaces** — `TagInput` (press Enter to add, click × to remove)
  - Trash icon to remove individual strategies
  - "Add Strategy" ghost button to add more
- **Resource Tags**: `ResourceTagFields` component (same as agent deploy form) — tag profile dropdown with `sessionStorage` persistence
- **Create** button (disabled until name provided) and **Cancel** button

### Memory List (Card View / Table View)

**Card view** (default): Responsive grid of `MemoryCard` components (3 columns on large screens). Each card displays name, status badge, spinner+timer for transitional states, region, account, event expiry, strategies count, registered timestamp, tag badges (for tags with `show_on_card=true`), refresh and delete buttons. Multi-select tag filter bar above the grid with AND logic.

**Table view**: Table with columns (using `table-fixed` layout with percentage-based widths matching agent tables):

| Column | Width | Description |
|--------|-------|-------------|
| Name | 30% | Memory resource name (font-medium) |
| Status | 12% | Badge with status variant + spinner for transitional states |
| Strategies | 14% | Count of configured strategies |
| Event Expiry | 14% | Duration in days (computed from seconds) |
| Region | 14% | AWS region |
| Registered | 16% | Timezone-aware timestamp |

### Status Badges

Status badges use `statusVariant()` mapping:
- **ACTIVE** — default variant
- **CREATING** — secondary variant + spinning `Loader2` icon
- **FAILED** — destructive variant
- **DELETING** — secondary variant + spinning `Loader2` icon

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
- **Tag Policies** section (top): displays `platform:required` tags as read-only rows with a Lock icon and designation badge, followed by `custom:optional` tags (editable/deletable with designation badge). "Add Custom Tag" button shows a form with: key (text, required), default value (optional text), show on card (checkbox, default true). Custom tags are always created as `required=false`.
- **Tag Profiles** section (below policies): list, create, edit, delete named tag presets
  - Each profile card shows: name, timestamps, and tag value badges
  - Create/edit form has two sections:
    1. **Platform (Required)** — input fields for each `platform:required` tag (mandatory, marked with `*`)
    2. **Custom (Optional)** — checkbox per custom tag; checking reveals a value input. Unchecking removes the tag from the profile.
  - Accessible to all scopes; `*:write` can create, edit, and delete; `*:read` can only view
  - Delete with inline confirmation (Confirm/Cancel)
- Always visible in the sidebar (no scope guard for visibility)

---

## 10. Session Detail View

**Purpose:** Inspect a single session's invocations and CloudWatch logs.

**Content:**
- Session metadata card — session_id, qualifier, live status badge, created timestamp
- Invocation table — all invocations with timing data
- Log viewer — CloudWatch logs filtered to this session, dynamically expanding

---

## 11. Design Decisions

### Persona-Based Navigation
Chose a sidebar with persona-based workflows over traditional tab navigation. Each persona represents a distinct user role (catalog browser, agent builder, security admin, memory manager) with its own page and feature set. The sidebar provides persistent access to all personas and includes theme/timezone controls.

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

### Theme System
10 themes organized into Light and Dark groups:
- **Light:** Ayu Light (warm sandy/orange), Catppuccin Latte (cool blue-gray, default), Everforest Light (warm green), Rosé Pine Dawn (warm rose), Solarized Light (warm yellow-blue)
- **Dark:** Catppuccin Mocha (deep purple-blue), Dracula (vibrant purple), Gruvbox (warm earthy), Nord (arctic blue), Tokyo Night (indigo blue)

ThemeContext manages theme state with localStorage persistence. Latte uses `:root` variables (no class); all other themes use CSS class selectors on `<html>`. The `@custom-variant dark` includes all dark theme classes. Light themes have darkened foreground/muted-foreground/border for readability; dark themes have brightened values. Badge `default` and `secondary` variants include `border-border` for visibility across all themes.

### Drag-to-Reorder Card Grid
`SortableCardGrid` uses @dnd-kit/core + @dnd-kit/sortable for drag-and-drop reordering of cards within grid sections. Order is persisted to localStorage keyed by `storageKey`. Uses `PointerSensor` with 8px activation distance, `rectSortingStrategy`, and `closestCenter` collision detection.

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
- `AuthContext` provides login, logout, token refresh, user state, and scope-based authorization to the entire app.
- Tokens (id, access, refresh) are stored in React state only — never in localStorage or cookies.
- The `AuthProvider` wraps the app at the top level (outside `TimezoneProvider`). If Cognito is not configured (empty pool ID from backend or missing `VITE_COGNITO_USER_CLIENT_ID`), authentication is bypassed and all scopes are granted.
- The user client ID is configured via the `VITE_COGNITO_USER_CLIENT_ID` Vite environment variable (in `frontend/.env`), not fetched from the backend. The backend only provides the pool ID and region via `GET /api/auth/config`.
- `LoginPage` renders when the user is not authenticated. It handles the `NEW_PASSWORD_REQUIRED` challenge for admin-created Cognito users.
- Access tokens are automatically refreshed 60 seconds before expiry using the refresh token.
- The user indicator (username + logout button) is shown in the sidebar footer, above the theme selector.
- `apiFetch` and `invokeAgentStream` automatically include the `Authorization: Bearer` header when a token is available, via a module-level token setter (`setAuthToken`/`getAuthToken`).

### Scope-Based Authorization
- `AuthContext` extracts `cognito:groups` from the decoded ID token and maps them to scopes using a `GROUP_SCOPES` lookup table (must match the backend `GROUP_SCOPES` exactly). The `hasScope(scope)` function is exposed to the entire app.
- Scopes (15 total): `invoke`, `catalog:read`, `catalog:write`, `agent:read`, `agent:write`, `memory:read`, `memory:write`, `security:read`, `security:write`, `settings:read`, `settings:write`, `mcp:read`, `mcp:write`, `a2a:read`, `a2a:write`.
- Groups (7): `super-admins` (all scopes), `demo-admins` (all read/write, no invoke), `security-admins`, `memory-admins`, `mcp-admins`, `a2a-admins`, `users` (invoke only).
- Sidebar visibility is controlled by scopes — each persona item is rendered only when the user has the corresponding `*:read` or `*:write` scope. The Platform Catalog is always visible.
- Write operations are gated by a `readOnly` prop propagated from `App.tsx` through page components to individual UI elements. When `readOnly` is true, add/edit/delete buttons are disabled or hidden.
- Pages and their `readOnly` mapping: `AgentListPage` and `CatalogPage` use `!hasScope("agent:write")`, `SecurityAdminPage` uses `!hasScope("security:write")`, `MemoryManagementPage` uses `!hasScope("memory:write")`, `TaggingPage` uses `!hasScope("memory:write")`.
- Components that respect `readOnly`: `AgentCard`, `AgentListPage`, `CatalogPage`, `SecurityAdminPage`, `RoleManagementPanel`, `AuthorizerManagementPanel`, `PermissionRequestsPanel`, `MemoryManagementPage`, `MemoryManagementPanel`, `MemoryCard`.

### Resource Tagging
- Tag policies use a two-tier designation system: `platform:required` (keys starting with `loom:`) and `custom:optional` (all others). Designation is computed from the key, not stored. Filter categorization uses the `required` flag, not key prefix.
- Tag policies are fetched from `/api/settings/tags` and used to derive `showOnCardKeys` for tag badge display and filter dropdowns.
- Tag profiles are named presets managed via the Tagging page. The `ResourceTagFields` shared component renders a profile dropdown (persisted in `sessionStorage` as `loom:selectedTagProfileId`), resolves tags from the selected profile + policy defaults, displays all profile tags as badges, and calls `onChange(tags)`. Used by both agent deploy and memory create forms.
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
- `apiFetch<T>()` is a thin wrapper around `fetch` with JSON parsing, `ApiError` class, and automatic auth token injection
- Each API domain (agents, auth, invocations, logs, security) is a separate module with typed functions

### Session Liveness Display
Computed server-side using `LOOM_SESSION_IDLE_TIMEOUT_SECONDS`. The frontend displays `live_status` with color-coded badges and `active_session_count` on agent cards.

### View Mode Persistence
Card/table view mode state is lifted to `App.tsx` with separate state variables per page (`catalogViewMode`, `agentsViewMode`, `memoryViewMode`). Each page receives its mode and setter as props. This ensures the selection persists when switching between personas — the page components unmount but the state lives in the parent.

### Deploy Flow
Agent deployment uses a fire-and-forget pattern. The form collapses immediately on deploy, the backend creates a DB record before starting the AWS call, and `fetchAgents()` picks up the new record. The `useAgents` hook polls transitional agents (deploying/CREATING/endpoint CREATING) at 5-second intervals using a `watchIds` effect dependency. An `initialLoadDone` ref prevents skeleton flash on subsequent fetches. Agent cards show two-phase creation status: deploying → completing deployment → finalizing endpoint, with a timer using `registered_at` to avoid resets on phase transitions.

### SSE Stream Consumer
`invokeAgentStream()` uses `ReadableStream` to consume POST-based SSE responses with buffer-based line parsing, typed callback dispatch, and `AbortSignal` for cancellation.

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

---

## 12. Future Work

- **Markdown rendering** for agent responses
- **MCP server integration** configuration
- **A2A agent integration** configuration
- **VPC network mode** support
- **MCP and A2A protocol** support
- **Operate Tab** — aggregate dashboard with summary cards, per-agent latency charts
- **Real-time auto-refresh** of sessions and metrics
- **Log stream selection** and agent-level log viewer
- **Latency charts** using Recharts
- **Memory integration** with agent deployment (attach memory to agents)
