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
│   │   ├── client.ts           # apiFetch<T>() wrapper + ApiError class
│   │   ├── agents.ts           # Agent CRUD + fetchRoles(), fetchCognitoPools(), fetchModels(), deployAgent(), deleteAgent(id, cleanupAws)
│   │   ├── invocations.ts      # Session queries + SSE stream consumer
│   │   └── logs.ts             # CloudWatch log queries
│   ├── contexts/
│   │   └── TimezoneContext.tsx  # Timezone preference provider + hook
│   ├── hooks/
│   │   ├── useAgents.ts        # Agent list state + CRUD actions
│   │   ├── useSessions.ts      # Session list state per agent
│   │   ├── useInvoke.ts        # Streaming invocation state + AbortController
│   │   ├── useLogs.ts          # Session log fetching
│   │   └── useDeployment.ts    # Agent config, credential providers, integrations hooks
│   ├── components/
│   │   ├── ui/                 # shadcn primitives (auto-generated) + searchable-select.tsx (combobox with click-outside detection)
│   │   ├── AgentCard.tsx       # Agent summary card with actions
│   │   ├── AgentRegistrationForm.tsx  # Tabbed form: ARN registration + agent deployment
│   │   ├── DeploymentPanel.tsx # Deployment details panel (runtime status, protocol, network, role, deployed timestamp)
│   │   ├── InvokePanel.tsx     # Qualifier select, prompt input, invoke/cancel
│   │   ├── LatencySummary.tsx  # Timing breakdown (placeholder until filled)
│   │   ├── SessionTable.tsx    # Clickable session list
│   │   ├── InvocationTable.tsx # Invocation timing data
│   │   └── LogViewer.tsx       # Scrollable log viewer
│   ├── pages/
│   │   ├── AgentListPage.tsx   # Registration form + agent grid
│   │   ├── AgentDetailPage.tsx # Sessions, latency, invoke, response
│   │   └── SessionDetailPage.tsx  # Session metadata, invocations, logs
│   ├── lib/
│   │   ├── utils.ts            # shadcn cn() utility
│   │   └── format.ts           # Timezone-aware timestamp + metric formatters
│   ├── App.tsx                 # State-driven navigation + breadcrumbs + timezone
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

The app uses a state-driven single-page architecture with drill-down navigation:

```
Agents  >  [Agent Name]  >  [Session ID]
```

- **No router library** — navigation is managed via lifted state in `App.tsx` (`selectedAgentId`, `selectedSessionId`)
- Breadcrumb navigation in the header allows clicking back to any level
- A back button is shown when drilling into agent or session views
- Sonner `<Toaster>` provides toast notifications for all user actions
- **Timezone selector** in the header toggles all timestamps between local and UTC

No authentication or authorization in the initial prototype.

---

## 4. Agent List (Home View)

**Purpose:** Register agents by ARN, deploy new agents, and manage the agent inventory.

**Content:**
- `AgentRegistrationForm` at the top with two tabs:
  - **Register** tab: single text input for the Agent Runtime ARN. On submit: `POST /api/agents` → success/error toast → list auto-refreshes.
  - **Deploy** tab: full deployment form with the following sections:
    - **Agent Identity**: name (1/3 width) and description (2/3 width)
    - **System Prompt**: agent description, behavioral guidelines, output expectations — each with placeholder examples
    - **Model / Protocol / Network / IAM Role**: single flex row with explicit widths (20% / 10% / 10% / flex-1). Protocol offers HTTP as selectable; MCP and A2A shown as disabled with "(coming soon)". Network offers PUBLIC as selectable; VPC shown as disabled with "(coming soon)". IAM Role uses a SearchableSelect component with a searchable dropdown of existing roles.
    - **Authorizer**: radio selection of None, Cognito, or Other.
      - Cognito: searchable Cognito pool select (30% width), auto-populated discovery URL, tag inputs for allowed clients and scopes (press Enter to add, X badge to remove), app client ID and client secret fields (secret is password-masked)
      - Other: textbox for discovery URL, tag inputs for allowed clients and scopes
    - **Lifecycle**: idle timeout (60–28800, step 60, default 300) and max lifetime (60–28800, step 60, default 3600)
    - **Integrations**: Memory, MCP Servers, A2A Agents — all shown as disabled checkboxes with "coming soon" labels
- Below the form: responsive grid of `AgentCard` components showing:
  - Name
  - Protocol badge
  - Status badge (color-coded: ACTIVE=default, CREATING/UPDATING=secondary, FAILED=destructive)
  - Active session count alongside runtime status — indicates how many sessions are likely still warm in AWS. When 0, the next invocation will likely be a cold start.
  - Region and Account ID
  - Network mode
  - Available qualifiers as outline badges
  - Registered timestamp (timezone-aware)
  - Refresh button (`POST /api/agents/{id}/refresh`)
  - Remove button with confirmation flow: Cancel/Confirm buttons with a fixed-height row below for "Remove in AgentCore" checkbox (shown when agent has runtime_id)
- Card layout is uniform across all agents — the checkbox row space is always reserved to prevent layout shifts
- Clicking a card navigates to Agent Detail

---

## 5. Agent Detail View

**Purpose:** Invoke agents with streaming, view latency metrics, inspect session history, and view deployment details.

**Layout:** Single-column, full-width stacked layout:

```
┌─────────────────────────────────────────────┐
│ Sessions (full width)                        │
│ Table of prior sessions, clickable rows      │
├─────────────────────────────────────────────┤
│ Invoke Agent                                 │
│ [Qualifier ▼] [Prompt textarea]              │
│ [Invoke] [Cancel]                            │
├─────────────────────────────────────────────┤
│ Latency Summary (placeholder → filled)       │
│ 4-column grid: invoke time, agent start,     │
│ cold start, duration                         │
├─────────────────────────────────────────────┤
│ Error (if any)                               │
├─────────────────────────────────────────────┤
│ Response (full width, expands dynamically)   │
│ Raw text with whitespace-pre-wrap, monospace │
├─────────────────────────────────────────────┤
│ Deployment (deployed agents only)            │
│ Runtime status, protocol, network, role,     │
│ deployed timestamp                           │
└─────────────────────────────────────────────┘
```

### Sessions (top)
- Full-width table of all sessions for this agent (`GET /api/agents/{id}/sessions`)
- Columns: Session ID (truncated), Qualifier, Live Status, Invocation count, Created timestamp
- Live status is displayed as a color-coded badge: active (green), expired (muted), streaming/pending (yellow), error (red)
- Auto-refreshes after each invocation completes
- Clicking a row navigates to Session Detail

### Invoke Form
- `InvokePanel` component: qualifier selector, multi-line prompt textarea, invoke/cancel buttons
- Invoke triggers `POST /api/agents/{id}/invoke` (disabled while streaming)
- Cancel aborts via `AbortController`

### Latency Summary
- Always visible as a 4-metric placeholder (shows "—" before invocation)
- Fills in after `session_end` SSE event with:
  - Client invoke time, Agent start time, Cold start latency (ms), Client duration (ms)

### Response Pane
- Shown when `streamedText`, `isStreaming`, or `sessionStart` is truthy (stays visible even if streaming ends with no content)
- Raw text display with `whitespace-pre-wrap` and monospace font
- **Expands dynamically** with content (no fixed max-height, no scroll overflow)
- Session ID badge and animated "streaming" indicator in header
- Blinking cursor while streaming, disappears on completion
- Bordered container with muted background

### Deployment Section (deployed agents only)
- Simplified card matching AgentCard styling
- Shows: runtime status badge, protocol, network mode, execution role, deployed timestamp
- No config hash, no endpoint status, no redeploy button

### Streaming Implementation
- **POST-based SSE** using `fetch` + `ReadableStream` (avoids `EventSource` GET-only limitation)
- Buffer-based line parser handles arbitrary chunk boundaries
- Parses `event:` / `data:` pairs into typed callbacks: `onSessionStart`, `onChunk`, `onSessionEnd`, `onError`
- `AbortController` signal passed through for cancellation
- Cleanup on component unmount

---

## 6. Session Detail View

**Purpose:** Inspect a single session's invocations and CloudWatch logs.

**Content:**
- **Session metadata card** — session_id, qualifier, live status badge (color-coded), created timestamp
- **Invocation table** — all invocations for this session:
  - Invocation ID (truncated), Status, Cold Start (ms), Duration (ms), Created timestamp
- **Log viewer** — CloudWatch logs filtered to this session:
  - Fetched via `GET /api/agents/{id}/sessions/{session_id}/logs?qualifier=...`
  - Dynamically expanding container with monospace font (no fixed height)
  - Each line shows timezone-aware HH:MM:SS.mmm timestamp + message
  - Auto-fetches on mount, manual refresh button

---

## 7. Design Decisions

### Navigation: Lifted State vs. Router
Chose lifted state in `App.tsx` over React Router. The app has only three views with a strict drill-down hierarchy. A router would add unnecessary complexity and bundle size for this use case. Navigating back to the agent list (via the back button or breadcrumb) triggers a re-fetch of agent data, ensuring `active_session_count` reflects the latest state.

### Layout: Stacked Single-Column for Agent Detail
Previous design used a two-column split (invoke left, sessions right). Revised to a full-width stacked layout because:
- Sessions (prior invocations) are the primary context — shown first at the top
- Latency summary serves as a persistent metrics placeholder that fills in after invocation
- Response pane needs room to expand dynamically — a half-width column constrained it and caused overflow
- Full-width stacking gives each section appropriate breathing room

### Dynamic Expansion: Response Pane and Log Viewer
Both the response pane and log viewer use plain `div` containers with no `max-height` or `ScrollArea` constraint. This lets content grow naturally, avoiding the "overflow and look ugly" problem that occurs with fixed-height scroll containers. The response pane uses `whitespace-pre-wrap` for streamed text; the log viewer uses `flex` rows for timestamp-aligned log entries.

### Catppuccin Theme
Applied the Catppuccin color palette to replace the default shadcn neutral theme:
- **Mocha** (dark mode, default): Base #1e1e2e, primary Blue #89b4fa, destructive Red #f38ba8
- **Latte** (light mode): Base #eff1f5, primary Blue #1e66f5, destructive Red #d20f39
- Dark mode is the default (matching the catppuccin/tmux convention), activated via `class="dark"` on `<html>`
- Both variants are defined via CSS custom properties in `index.css` and can be toggled

### Tailwind CSS v4 (Vite Plugin)
Using the `@tailwindcss/vite` plugin instead of PostCSS. This eliminates the need for `tailwind.config.ts` and `postcss.config.js` — configuration is handled via CSS `@theme` blocks in `index.css`.

### Timezone-Aware Timestamps
All timestamps throughout the UI are formatted via shared utilities in `src/lib/format.ts`:
- `formatTimestamp()` — ISO datetime strings (session/invocation created_at)
- `formatUnixTime()` — Unix epoch seconds (SSE timing data)
- `formatLogTime()` — Log event timestamps (HH:MM:SS.mmm)
- `formatMs()` — Millisecond durations

A `TimezoneContext` stores the user's preference ("local" or "UTC"). A dropdown in the header allows switching. All components read from this context — changing the preference updates every timestamp in the UI instantly.

### shadcn/ui Components
Using shadcn/ui for UI primitives (Button, Card, Table, Select, etc.). Components are copied into `src/components/ui/` and can be customized directly. The `cn()` utility from `src/lib/utils.ts` merges Tailwind classes.

### API Layer Design
- `apiFetch<T>()` is a thin wrapper around `fetch` that handles JSON parsing, 204 No Content, and error extraction from `{detail}` response bodies
- `ApiError` class carries `status` and `detail` for structured error handling
- Each API domain (agents, invocations, logs) is a separate module with typed functions

### Session Liveness Display
Session liveness is computed server-side using a local idle timeout heuristic — no AWS API calls are needed (the Bedrock AgentCore SDK does not expose session querying APIs). The frontend displays the computed `live_status` with color-coded badges:
- **active** (green) — session is likely still warm in AWS
- **expired** (muted) — session has likely been reclaimed
- **streaming** / **pending** (yellow) — invocation in progress
- **error** (red) — invocation failed

The `active_session_count` on each agent card provides a cold-start indicator: when 0, users know the next invocation will incur startup latency.

### SSE Stream Consumer
The `invokeAgentStream()` function uses `ReadableStream` to consume POST-based SSE responses. A buffer accumulates partial chunks and splits on double newlines to extract complete SSE messages. This approach:
- Handles arbitrary chunk boundaries (tokens split across reads)
- Supports typed callback dispatch (`onSessionStart`, `onChunk`, `onSessionEnd`, `onError`)
- Accepts an `AbortSignal` for cancellation
- Releases the reader lock in a `finally` block

### React Hooks
Custom hooks encapsulate data fetching and state management:
- `useAgents` — auto-fetches on mount, exposes `fetchAgents()` for re-fetch on navigation back, CRUD actions refresh the list after mutation
- `useSessions` — re-fetches when `agentId` changes, exposes `refetch()` for post-invocation refresh
- `useInvoke` — manages all streaming state, stores `AbortController` in a ref, cleans up on unmount; lifted to `AgentDetailPage` so it can be composed across the stacked layout
- `useLogs` — exposes `fetchSessionLogs()` for on-demand log loading
- `useDeployment` — fetches agent config, credential providers, and integration data for deployment forms

### SearchableSelect Component
Custom combobox used for IAM roles and Cognito pools. Uses click-outside detection, filtered option list, and a check mark for the selected item. Accepts a `className` prop for width control.

### TagInput Pattern
Inline component for adding/removing tag-style values (clients, scopes). Single textbox with Enter to add, badge with X to remove. Values are collected as a string array on form submit.

### Agent Card Layout Stability
The remove confirmation row (checkbox + buttons) always reserves a fixed-height space below buttons. This prevents card height changes when toggling confirmation state, keeping the grid layout stable across all cards.

### Secrets Handling
The Cognito client secret field is password-masked in the deploy form. The secret is sent to the backend which stores it in AWS Secrets Manager — it never persists in the frontend or local database.

### Deploy Form Spacing
Model / Protocol / Network / IAM Role use a flex row with explicit width percentages (20% / 10% / 10% / flex-1) for consistent spacing. Agent Identity name and description split 1/3 and 2/3.

---

## 8. Future Work

- **Markdown rendering** for agent responses
- **MCP server integration** configuration
- **A2A agent integration** configuration
- **VPC network mode** support
- **MCP and A2A protocol** support
- **Operate Tab** — aggregate dashboard with summary cards (total agents, invocations, avg cold-start, error rate), per-agent latency charts (Recharts), agent drill-down
- **Real-time auto-refresh** of sessions and metrics
- **Log stream selection** via the `/logs/streams` endpoint
- **Agent-level log viewer** (not session-filtered)
- **Latency charts** using Recharts `LineChart` for time-series visualization
- **Theme toggle** button for switching between Mocha (dark) and Latte (light)
