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
│   │   ├── agents.ts           # Agent CRUD functions
│   │   ├── invocations.ts      # Session queries + SSE stream consumer
│   │   └── logs.ts             # CloudWatch log queries
│   ├── contexts/
│   │   └── TimezoneContext.tsx  # Timezone preference provider + hook
│   ├── hooks/
│   │   ├── useAgents.ts        # Agent list state + CRUD actions
│   │   ├── useSessions.ts      # Session list state per agent
│   │   ├── useInvoke.ts        # Streaming invocation state + AbortController
│   │   └── useLogs.ts          # Session log fetching
│   ├── components/
│   │   ├── ui/                 # shadcn primitives (auto-generated)
│   │   ├── AgentCard.tsx       # Agent summary card with actions
│   │   ├── AgentRegistrationForm.tsx  # ARN input form
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

**Purpose:** Register agents by ARN and manage the agent inventory.

**Content:**
- `AgentRegistrationForm` at the top: single text input for the Agent Runtime ARN
- On submit: `POST /api/agents` → success/error toast → list auto-refreshes
- Below the form: responsive grid of `AgentCard` components showing:
  - Name or Runtime ID
  - Status badge (color-coded: ACTIVE=default, CREATING/UPDATING=secondary, FAILED=destructive)
  - Active session count alongside runtime status — indicates how many sessions are likely still warm in AWS. When 0, the next invocation will likely be a cold start.
  - Region and Account ID
  - Available qualifiers as outline badges
  - Registered timestamp (timezone-aware)
  - Refresh button (`POST /api/agents/{id}/refresh`)
  - Remove button (`DELETE /api/agents/{id}`)
- Clicking a card navigates to Agent Detail

---

## 5. Agent Detail View

**Purpose:** Invoke agents with streaming, view latency metrics, and inspect session history.

**Layout:** Single-column, full-width stacked layout:

```
┌─────────────────────────────────────────────┐
│ Sessions (full width)                        │
│ Table of prior sessions, clickable rows      │
├─────────────────────────────────────────────┤
│ Latency Summary (placeholder → filled)       │
│ 4-column grid: invoke time, agent start,     │
│ cold start, duration                         │
├─────────────────────────────────────────────┤
│ Invoke Agent                                 │
│ [Qualifier ▼] [Prompt textarea]              │
│ [Invoke] [Cancel]                            │
├─────────────────────────────────────────────┤
│ Response (full width, expands dynamically)   │
│ Streamed text with cursor, session ID badge  │
└─────────────────────────────────────────────┘
```

### Sessions (top)
- Full-width table of all sessions for this agent (`GET /api/agents/{id}/sessions`)
- Columns: Session ID (truncated), Qualifier, Live Status, Invocation count, Created timestamp
- Live status is displayed as a color-coded badge: active (green), expired (muted), streaming/pending (yellow), error (red)
- Auto-refreshes after each invocation completes
- Clicking a row navigates to Session Detail

### Latency Summary
- Always visible as a 4-metric placeholder (shows "—" before invocation)
- Fills in after `session_end` SSE event with:
  - Client invoke time, Agent start time, Cold start latency (ms), Client duration (ms)

### Invoke Form
- `InvokePanel` component: qualifier selector, multi-line prompt textarea, invoke/cancel buttons
- Invoke triggers `POST /api/agents/{id}/invoke` (disabled while streaming)
- Cancel aborts via `AbortController`

### Response Pane
- Appears when streaming starts, spans full width
- **Expands dynamically** with content (no fixed max-height, no scroll overflow)
- Session ID badge and animated "streaming" indicator in header
- Blinking cursor while streaming, disappears on completion
- Monospace font in a bordered container with muted background

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

---

## 8. Future Work

- **Operate Tab** — aggregate dashboard with summary cards (total agents, invocations, avg cold-start, error rate), per-agent latency charts (Recharts), agent drill-down
- **Real-time auto-refresh** of sessions and metrics
- **Log stream selection** via the `/logs/streams` endpoint
- **Agent-level log viewer** (not session-filtered)
- **Latency charts** using Recharts `LineChart` for time-series visualization
- **Theme toggle** button for switching between Mocha (dark) and Latte (light)
