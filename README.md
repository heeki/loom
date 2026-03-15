# Loom: A simple, opinionated, enterprise-grade agent platform

A platform for building, testing, and operating AI agents on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. Loom provides a streamlined UI and opinionated backend for agent lifecycle management.

## Features

- **Cognito User Authentication** — Optional login with automatic token refresh and NEW_PASSWORD_REQUIRED challenge handling
- **Platform Catalog** — Browse agents, memory resources, and platform resources in a unified view
- **Agent Management** — Deploy new agents or import existing AgentCore Runtime agents
- **Memory Management** — Create and manage AgentCore Memory resources with configurable strategies (semantic, summary, user preference, episodic, custom)
- **Security Administration** — Manage IAM roles, authorizer configs, credentials, and permission requests
- **Resource Tagging** — Configurable tag policies (platform + custom) and named tag profiles applied to all deployed resources (agents, memory, IAM roles). Tag badges on cards with show/hide toggle for custom tags. Progressive disclosure filtering with persistent filter state across navigation
- **Tagging** — Dedicated page for managing tag policies (platform read-only with lock icon, custom editable/deletable) and tag profiles (create, edit, delete named tag presets with drag-to-reorder)
- **Settings** — Display preferences (theme and timezone)
- SSE streaming invocation with real-time response display and friendly error messages
- Authenticated agent invocations using user tokens, M2M credentials, or manual bearer tokens
- Automatic token refresh — 401 responses trigger transparent access token refresh and request retry
- Group-based invoke restriction — super-admins invoke any agent; demo-admins and users restricted to agents within their `loom:group`
- Cold-start latency measurement via automatic CloudWatch log parsing
- Active session tracking with cold-start indicators per agent
- Session liveness detection via idle timeout heuristic (no AWS API calls)
- Card/table view toggle on all listing pages with per-page persistence
- OpenTelemetry observability with ADOT auto-instrumentation (traces for invocations, tool calls, model calls)
- Timezone-aware timestamp display (local / UTC toggle)
- 10 color themes: 5 light (Ayu, Catppuccin Latte, Everforest, Rosé Pine Dawn, Solarized) and 5 dark (Catppuccin Mocha, Dracula, Gruvbox, Nord, Tokyo Night)
- Instant deploy feedback with two-phase creation status tracking (deploying, completing deployment, finalizing endpoint)
- Credential suggestions on access denied errors — identifies the correct authorizer for the agent
- Drag-to-reorder cards within grid sections with persistent ordering
- Admin user view switching — simulate specific users (admin, demo-admin-1, demo-user-1, etc.) to preview their scoped experience

## Project Structure

```
loom/
├── agents/            # Agent blueprint source code (Strands Agent)
├── backend/           # FastAPI backend (Python, SQLAlchemy, boto3)
│   └── etc/           # Backend environment config (environment.sh.example)
├── frontend/          # React/TypeScript frontend (Vite, shadcn, Tailwind CSS)
├── security/          # Security IaC templates (IAM roles, Cognito) + makefile
│   └── etc/           # Security environment config (environment.sh.example)
├── etc/               # Configuration (environment.sh)
├── iac/               # Infrastructure as Code (CloudFormation, SAM)
├── makefile           # Root orchestration
├── CLAUDE.md          # Project conventions
├── SPECIFICATIONS.md  # Project-level specification
└── README.md          # This file
```

See [`backend/SPECIFICATIONS.md`](backend/SPECIFICATIONS.md) and [`frontend/SPECIFICATIONS.md`](frontend/SPECIFICATIONS.md) for detailed component specifications.

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- AWS credentials configured via the standard boto3 credential chain (environment variables, AWS profile, or instance metadata)

### Setup

```bash
# Backend
cd backend
uv venv .venv && source .venv/bin/activate
make install
make test
make run

# Frontend
cd frontend
cp .env.example .env   # Required — set VITE_COGNITO_USER_CLIENT_ID for Cognito login
npm install
npm run dev
```

> **Note:** The `frontend/.env` file is required when using Cognito authentication. Without it, the Cognito login flow will not work. See the Authentication section below for details.

### Authentication (Optional)

Cognito-based user authentication requires configuration on both the backend and frontend:

**Backend** — Set these environment variables in `backend/etc/environment.sh`:
```bash
export LOOM_COGNITO_USER_POOL_ID=<your-pool-id>
export LOOM_COGNITO_REGION=<your-region>  # defaults to AWS_REGION
export LOOM_COGNITO_USER_CLIENT_ID=<your-user-client-id>  # same as frontend VITE_COGNITO_USER_CLIENT_ID
```

**Frontend** — Set the user client ID in `frontend/.env`:
```bash
VITE_COGNITO_USER_CLIENT_ID=<your-user-client-id>
```

When both are configured, users must log in before accessing the application. When not configured, the app runs without authentication and all features are accessible.

The frontend enforces scope-based authorization: sidebar items are shown or hidden based on the user's Cognito group membership, and write operations (add, edit, delete) are disabled for users who lack the corresponding `*:write` scope.

### Cognito Setup

The `security/` directory contains CloudFormation templates for provisioning the Cognito User Pool with groups, users, scopes, and clients. See `security/iac/cognito.yaml` for the full template.

**Groups and scopes:**

| Group | Scopes |
|-------|--------|
| `super-admins` | All 15 scopes (invoke, catalog:r/w, agent:r/w, memory:r/w, security:r/w, settings:r/w, mcp:r/w, a2a:r/w) |
| `demo-admins` | All read/write scopes plus invoke |
| `security-admins` | security:read, security:write |
| `memory-admins` | memory:read, memory:write |
| `mcp-admins` | mcp:read, mcp:write |
| `a2a-admins` | a2a:read, a2a:write |
| `users` | invoke |

**Deploying and managing users:**
```bash
cd security
make cognito             # Deploy Cognito stack
make cognito.set-passwords  # Set permanent passwords for all users
```

### Configuration

Runtime configuration is sourced from `etc/environment.sh`. Example templates are provided:
- `backend/etc/environment.sh.example` — Backend environment variables (ports, database, AWS region, S3 bucket, Cognito)
- `security/etc/environment.sh.example` — Security stack variables (Cognito pool, passwords)
- `frontend/.env.example` — Frontend environment variables (Cognito user client ID)

### Make Targets

Check the root `makefile` and component-level `makefile` files for available commands:

```bash
make -C backend test    # Run backend tests
make -C backend run     # Start backend dev server
make -C frontend dev    # Start frontend dev server
```

## Architecture

- **Backend:** FastAPI with SQLAlchemy (SQLite), boto3 for AWS interactions, SSE streaming via `StreamingResponse`
- **Frontend:** React 18, TypeScript, Vite, shadcn/ui, Tailwind CSS v4
- **Persona Navigation:** Sidebar with Platform Catalog, Agents, Memory, Security Admin, Tagging, Settings, plus MCP Servers and A2A Agents (coming soon)
- **Session Liveness:** Computed locally using an idle timeout heuristic (`LOOM_SESSION_IDLE_TIMEOUT_SECONDS`). No AWS control plane APIs are called — the Bedrock AgentCore SDK does not expose session listing/querying APIs.
