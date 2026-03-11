# Loom: Agent Builder Playground

A platform for building, testing, and operating AI agents on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. Loom provides a streamlined UI and opinionated backend for agent lifecycle management.

## Features

- **Cognito User Authentication** — Optional login with automatic token refresh and NEW_PASSWORD_REQUIRED challenge handling
- **Platform Catalog** — Browse agents, memory resources, and platform resources in a unified view
- **Agent Management** — Deploy new agents or import existing AgentCore Runtime agents
- **Memory Management** — Create and manage AgentCore Memory resources with configurable strategies (semantic, summary, user preference, episodic, custom)
- **Security Administration** — Manage IAM roles, authorizer configs, credentials, and permission requests
- SSE streaming invocation with real-time response display
- Authenticated agent invocations using user tokens or M2M credentials
- Cold-start latency measurement via automatic CloudWatch log parsing
- Active session tracking with cold-start indicators per agent
- Session liveness detection via idle timeout heuristic (no AWS API calls)
- Card/table view toggle on all listing pages with per-page persistence
- OpenTelemetry observability with ADOT auto-instrumentation (traces for invocations, tool calls, model calls)
- Timezone-aware timestamp display (local / UTC toggle)
- Catppuccin-themed UI (Mocha dark / Latte light)

## Project Structure

```
loom/
├── agents/            # Agent blueprint source code (Strands Agent)
├── backend/           # FastAPI backend (Python, SQLAlchemy, boto3)
├── frontend/          # React/TypeScript frontend (Vite, shadcn, Tailwind CSS)
├── security/          # Security IaC templates (IAM roles, Cognito) + makefile + etc/
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
npm install
npm run dev
```

### Authentication (Optional)

Cognito-based user authentication requires configuration on both the backend and frontend:

**Backend** — Set these environment variables in `backend/etc/environment.sh`:
```bash
export LOOM_COGNITO_USER_POOL_ID=<your-pool-id>
export LOOM_COGNITO_REGION=<your-region>  # defaults to AWS_REGION
```

**Frontend** — Set the user client ID in `frontend/.env`:
```bash
VITE_COGNITO_USER_CLIENT_ID=<your-user-client-id>
```

When both are configured, users must log in before accessing the application. When not configured, the app runs without authentication.

### Cognito Setup

The `security/` directory contains CloudFormation templates for provisioning the Cognito User Pool with groups, users, scopes, and clients. See `security/iac/cognito.yaml` for the full template.

**Groups and scopes:**

| Group | Scopes |
|-------|--------|
| `admins` | agent:read, agent:write, security:read, security:write, data:read, data:write |
| `security-admins` | security:read, security:write |
| `data-stewards` | data:read, data:write |
| `builders` | agent:read, agent:write |
| `operators` | agent:read, security:read, data:read |

**Deploying and managing users:**
```bash
cd security
make cognito             # Deploy Cognito stack
make cognito.set-passwords  # Set permanent passwords for all users
```

### Configuration

Runtime configuration is sourced from `etc/environment.sh`. See the backend and frontend READMEs for available variables.

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
- **Persona Navigation:** Sidebar with Platform Catalog, Agents, Memory, Security Admin, plus MCP Servers and A2A Agents (coming soon)
- **Session Liveness:** Computed locally using an idle timeout heuristic (`LOOM_SESSION_IDLE_TIMEOUT_SECONDS`). No AWS control plane APIs are called — the Bedrock AgentCore SDK does not expose session listing/querying APIs.
