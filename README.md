# Loom: Agent Builder Playground

A platform for building, testing, and operating AI agents on Amazon Bedrock AgentCore Runtime and AWS Strands Agents. Loom provides a streamlined UI and opinionated backend for agent lifecycle management.

## Features

- Agent registration via AgentCore Runtime ARN
- SSE streaming invocation with real-time response display
- Cold-start latency measurement via automatic CloudWatch log parsing
- Active session tracking with cold-start indicators per agent
- Session liveness detection via idle timeout heuristic (no AWS API calls)
- Prompt, thinking, and response text storage per invocation
- Timezone-aware timestamp display (local / UTC toggle)
- Catppuccin-themed UI (Mocha dark / Latte light)

## Project Structure

```
loom/
├── backend/           # FastAPI backend (Python, SQLAlchemy, boto3)
├── frontend/          # React/TypeScript frontend (Vite, shadcn, Tailwind CSS)
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
- **Session Liveness:** Computed locally using an idle timeout heuristic (`SESSION_IDLE_TIMEOUT_MINUTES`). No AWS control plane APIs are called — the Bedrock AgentCore SDK does not expose session listing/querying APIs.
