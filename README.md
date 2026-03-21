# Loom

Loom is an enterprise-grade platform for building, deploying, and operating AI agents on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. It provides a unified management UI with Cognito-based authentication, scope-based authorization, multi-persona navigation, and full lifecycle management for agents, memory, MCP servers, and A2A integrations.

## Features

### Agent Lifecycle
- Deploy new agents or import existing AgentCore Runtime agents
- SSE streaming invocation with real-time response display
- Progressive deployment status tracking and async deletion
- Cold-start latency measurement via CloudWatch log parsing
- Active session tracking with idle timeout heuristic

### Memory Management
- Create and manage AgentCore Memory resources
- Configurable strategies: semantic, summary, user preference, episodic, custom

### MCP Servers
- Register and manage MCP servers with tool discovery
- OAuth2 authentication and credential provider support
- Per-persona access control (all_tools or selected_tools)

### A2A Agents
- Register Agent-to-Agent protocol agents by base URL with automatic Agent Card fetching
- Structured Agent Card display: capabilities, authentication schemes, input/output modes, skills
- OAuth2 authentication with test connection
- Per-persona access control (all_skills or selected_skills)
- A2A runtime client with OAuth2 Bearer token injection via AgentCore Identity service
- Handles both SSE streaming and plain JSON responses with automatic method fallback
- Credential provider creation with exponential backoff retry for reliable deployment

### Security and Access Control
- Cognito user authentication with automatic token refresh
- Two-dimensional group-based authorization: Type groups (t-admin, t-user) for UI view and Resource groups (g-admins-*, g-users-*) for access control (19 scopes total)
- IAM role, authorizer, and credential management
- Admin user view switching to preview scoped experiences

### Platform Catalog and Tagging
- Unified catalog view across agents, memory, MCP servers, and platform resources
- Configurable tag policies (platform + custom) and named tag profiles
- Tag badges with filtering and persistent state

### Token Usage and Cost Tracking
- Per-invocation token estimation (4 chars/token heuristic) and cost calculation from model pricing
- Cost dashboard with time-range selector and per-agent breakdown
- Cost badges on agent cards, token/cost columns in invocation tables
- Model pricing metadata for all supported Anthropic and Amazon models

### Admin Dashboard
- Platform usage analytics for super-admins: login tracking, user action tracking, and page navigation tracking
- All audit events are scoped to a browser session UUID (generated at login, stored in React state) to distinguish shared accounts
- Global multi-select user filter that limits all summary cards, charts, and tab tables to selected users; stats are recomputed client-side from filtered data when active
- Summary cards (total logins, total page views, total actions, total duration, most active page) with time-range selector
- Charts: logins over time, actions over time, page views by page (recharts)
- Per-session drill-down: interleaved timeline of logins, actions, and page views for any browser session
- 27 instrumented action types across agent, memory, security, tagging, MCP, and A2A categories

### Observability and UX
- OpenTelemetry observability with ADOT auto-instrumentation and OTEL trace visualization
- Interactive waterfall timeline for inspecting per-span events from OTEL log records
- Card/table view toggle on all listing pages
- Estimated cost column in agent and memory table views; consistent 5-column layout for MCP and A2A tables
- Drag-to-reorder cards with persistent ordering
- JSON import/export on deploy and create forms
- 10 color themes (5 light, 5 dark) with WCAG AA contrast compliance

## Project Structure

```
loom/
├── agents/            # Agent blueprint source code (Strands Agent)
├── backend/           # FastAPI backend (Python, SQLAlchemy, boto3)
│   └── etc/           # Backend environment config
├── frontend/          # React/TypeScript frontend (Vite, shadcn, Tailwind CSS)
├── security/          # Security IaC (IAM roles, Cognito) + makefile
│   └── etc/           # Security environment config
├── iac/               # Infrastructure as Code (CloudFormation, SAM)
├── etc/               # Root configuration
├── makefile           # Root orchestration
└── SPECIFICATIONS.md  # Project-level specification
```

See [`backend/SPECIFICATIONS.md`](backend/SPECIFICATIONS.md) and [`frontend/SPECIFICATIONS.md`](frontend/SPECIFICATIONS.md) for detailed component specifications.

## Deployment

### Prerequisites

- Python 3.11+ with [uv](https://github.com/astral-sh/uv) for dependency management
- Node.js 18+ with npm
- AWS CLI configured with credentials (environment variables, AWS profile, or instance metadata)
- SAM CLI for deploying infrastructure

### Step 1: Configure Environment Files

Three environment files are required. Copy each example and fill in your values:

**Backend** (`backend/etc/environment.sh`):
```bash
cp backend/etc/environment.sh.example backend/etc/environment.sh
```

| Variable | Description |
|----------|-------------|
| `AWS_PROFILE` | AWS CLI profile name |
| `AWS_REGION` | AWS region (e.g., `us-east-1`) |
| `LOOM_ARTIFACT_BUCKET` | S3 bucket for agent deployment artifacts |
| `LOOM_DATABASE_URL` | SQLAlchemy database URL (default: `sqlite:///./loom.db`) |
| `LOOM_BACKEND_PORT` | Backend port (default: `8000`) |
| `LOOM_FRONTEND_PORT` | Frontend port (default: `5173`) |
| `LOOM_COGNITO_USER_POOL_ID` | Cognito User Pool ID (from Step 2) |
| `LOOM_COGNITO_USER_CLIENT_ID` | Cognito User Client ID (from Step 2) |
| `LOOM_COGNITO_REGION` | Cognito region (defaults to `AWS_REGION`) |

**Security** (`security/etc/environment.sh`):
```bash
cp security/etc/environment.sh.example security/etc/environment.sh
```

| Variable | Description |
|----------|-------------|
| `PROFILE` | AWS CLI profile name |
| `REGION` | AWS region |
| `ACCOUNTID` | AWS account ID |
| `BUCKET` | S3 bucket for SAM deployments |
| `P_COGNITO_DOMAIN` | Globally unique Cognito domain prefix |
| `P_TAG_APPLICATION` | Application tag value |
| `P_TAG_GROUP` | Group/team tag value |
| `P_TAG_OWNER` | Owner alias or email |
| `P_COGNITO_USER_POOL_ID` | Cognito User Pool ID (set after Step 2) |
| `P_COGNITO_PERMANENT_PASSWORD` | Password for provisioned demo users |

**Frontend** (`frontend/.env`):
```bash
cp frontend/.env.example frontend/.env
```

| Variable | Description |
|----------|-------------|
| `VITE_COGNITO_USER_CLIENT_ID` | Cognito User Client ID (same as backend `LOOM_COGNITO_USER_CLIENT_ID`) |

### Step 2: Deploy Cognito (Optional)

Authentication is optional. Skip this step to run without login.

```bash
cd security
make cognito                   # Deploy Cognito User Pool, groups, scopes, and clients
# Update P_COGNITO_USER_POOL_ID in security/etc/environment.sh with the stack output
# Update LOOM_COGNITO_USER_POOL_ID and LOOM_COGNITO_USER_CLIENT_ID in backend/etc/environment.sh
# Update VITE_COGNITO_USER_CLIENT_ID in frontend/.env
make cognito.set-passwords     # Set permanent passwords for demo users
```

**Cognito groups and scopes (two-dimensional architecture):**

**Type Groups** (determine UI view):
- `t-admin` — Admin UI with full navigation
- `t-user` — User UI with limited navigation

**Resource Groups** (determine access to resources):
- `g-admins-super` — All 19 scopes (catalog:r/w, agent:r/w, memory:r/w, security:r/w, settings:r/w, tagging:r/w, costs:r/w, mcp:r/w, a2a:r/w, invoke)
- `g-admins-demo` — Read-only to all pages + read/write to demo group resources + costs:write
- `g-admins-security` — security:read/write, settings:read
- `g-admins-memory` — memory:read/write, settings:read
- `g-admins-mcp` — mcp:read/write, settings:read
- `g-admins-a2a` — a2a:read/write, settings:read
- `g-users-demo`, `g-users-test`, `g-users-strategics` — invoke + read access to resources in their group

Users are assigned both a type group and one or more resource groups. Resource filtering uses `loom:group` tag matching.

### Step 3: Start the Backend

```bash
cd backend
uv venv .venv && source .venv/bin/activate
make install
make test       # Run unit tests
make run        # Start FastAPI dev server on LOOM_BACKEND_PORT
```

### Step 4: Start the Frontend

```bash
cd frontend
npm install
npm run dev     # Start Vite dev server on LOOM_FRONTEND_PORT
```

## Architecture

- **Backend:** FastAPI with SQLAlchemy (SQLite), boto3 for AWS, SSE streaming via `StreamingResponse`
- **Frontend:** React 18, TypeScript, Vite, shadcn/ui, Tailwind CSS v4
- **Auth:** Cognito User Pool with group-based scopes; frontend enforces sidebar visibility and write permissions
- **Navigation:** Platform Catalog, Agents, Memory, Security Admin, MCP Servers, A2A Agents, Tagging, Costs, Settings, Admin Dashboard (super-admins only)
