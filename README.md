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
- Per-invocation token counting via Bedrock CountTokens API (Anthropic/Meta models) with 4 chars/token heuristic fallback
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
- 10 color themes (5 light, 5 dark) with WCAG AA contrast compliance, and timezone-aware timestamps

## Project Structure

```
loom/
├── agents/            # Agent blueprint source code (Strands Agent)
├── backend/           # FastAPI backend (Python, SQLAlchemy, boto3)
│   ├── etc/           # Backend environment config (app + ECS backend service)
│   └── iac/           # Backend infrastructure (RDS, EC2 bastion, ECS backend service)
├── frontend/          # React/TypeScript frontend (Vite, shadcn, Tailwind CSS)
│   ├── etc/           # Frontend environment config (ECS frontend service)
│   └── iac/           # Frontend infrastructure (ECS frontend service)
├── shared/            # Shared IaC (IAM roles, Cognito, DNS, infra, ECS cluster) + deployment makefile
│   └── etc/           # Shared environment config (Cognito, infra, DNS)
├── makefile           # Infrastructure, Docker, and deployment orchestration
└── SPECIFICATIONS.md  # Project-level specification
```

See [`backend/SPECIFICATIONS.md`](backend/SPECIFICATIONS.md) and [`frontend/SPECIFICATIONS.md`](frontend/SPECIFICATIONS.md) for detailed component specifications.

## Local Development

### SQLite (Zero-Config)

The backend defaults to SQLite (`sqlite:///./loom.db`) — no database setup required. Tables are auto-created on startup via `app.db:init_db()`.

**Backend:**
```bash
cd backend
uv venv .venv && source .venv/bin/activate
make install
make test       # Run unit tests
make run        # Runs on LOOM_BACKEND_PORT (default 8000)
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev     # Runs on LOOM_FRONTEND_PORT (default 5173)
```

### SSM Tunnel to Private RDS

To develop locally against a deployed RDS instance, open an SSM tunnel through the EC2 bastion.

**Prerequisites:** `loom-rds` and `loom-ec2` stacks must be deployed (see [Deployment](#deployment)).

```bash
cd backend
make tunnel              # Port forwards localhost:5432 → RDS via EC2 bastion
uv pip install ".[postgres]"
```

Set `LOOM_DATABASE_URL` in `backend/etc/environment.sh` — it is constructed from `P_RDS_USERNAME`, `P_RDS_PASSWORD`, `LOOM_DATABASE_HOST` (localhost when tunneled), `O_RDS_PORT`, and `P_RDS_DB_NAME`.

To migrate an existing SQLite database to PostgreSQL:

```bash
make migrate-db          # Copies sqlite:///./loom.db → $LOOM_DATABASE_URL
```

### Database Selection Logic

`backend/app/db.py` auto-detects the database type from the `LOOM_DATABASE_URL` scheme:
- **SQLite** (`sqlite:///`): uses `check_same_thread=False`
- **PostgreSQL** (`postgresql+psycopg2://`): uses `pool_pre_ping=True` and `pool_recycle=1800`

## Deployment

### Prerequisites

**Development tools:**
- Python 3.11+ with [uv](https://github.com/astral-sh/uv) for dependency management
- Node.js 18+ with npm
- AWS CLI configured with credentials (environment variables, AWS profile, or instance metadata)
- SAM CLI for deploying infrastructure
- Podman (or Docker) for building container images

**VPC and networking:**
- VPC with at least 2 private subnets in different AZs (required for RDS Multi-AZ)
- At least 1 public subnet for ALB and EC2 bastion
- Internet gateway for public subnets
- NAT gateway in a public subnet for private subnet outbound traffic (required for ECR image pulls)

**S3 bucket for SAM deployments:**
- Create an S3 bucket for CloudFormation template artifacts with versioning enabled
- Set the `BUCKET` variable in `shared/etc/environment.sh`

**Domain and Route 53:**
- Parent Route 53 hosted zone must be accessible for NS delegation
- Set `P_INFRA_DOMAIN_NAME` to the desired subdomain (e.g., `loom.example.com`)

**ECS service-linked role** (once per account):
```bash
cd shared && make ecs.init    # Creates AWSServiceRoleForECS service-linked role
```

**CloudWatch Transaction Search:**
- Enable CloudWatch Transaction Search for AgentCore Observability in the AWS console
- Navigate to CloudWatch > Settings > Transaction Search and enable it for the target region

**Account-specific environment files:**
- Create `shared/etc/environment_<account_suffix>.sh` and `backend/etc/environment_<account_suffix>.sh` with account-specific parameters
- Use `*.sh.example` files as templates
- Update `shared/etc/environment.sh` and `backend/etc/environment.sh` to source the new account file

### Step 1: Configure Environment Files

Four environment files are required. Copy each example and fill in your values:

**Shared** (`shared/etc/environment.sh`):
```bash
cp shared/etc/environment.sh.example shared/etc/environment.sh
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
| `P_COGNITO_PERMANENT_PASSWORD` | Password for provisioned demo users |

**Backend** (`backend/etc/environment.sh`):
```bash
cp backend/etc/environment.sh.example backend/etc/environment.sh
```

| Variable | Description |
|----------|-------------|
| `AWS_PROFILE` | AWS CLI profile name |
| `AWS_REGION` | AWS region (e.g., `us-east-1`) |
| `LOOM_ARTIFACT_BUCKET` | S3 bucket for agent deployment artifacts |
| `LOOM_DATABASE_URL` | SQLAlchemy database URL — SQLite for local dev (default: `sqlite:///./loom.db`) or PostgreSQL for cloud deployments (e.g. `postgresql+psycopg2://user:pass@host:5432/loom`) |
| `LOOM_BACKEND_PORT` | Backend port (default: `8000`) |
| `LOOM_COGNITO_USER_POOL_ID` | Cognito User Pool ID (from Step 2) |
| `LOOM_COGNITO_USER_CLIENT_ID` | Cognito User Client ID (from Step 2) |
| `LOOM_COGNITO_REGION` | Cognito region (defaults to `AWS_REGION`) |

**Frontend environment** (`frontend/etc/environment.sh`):
```bash
cp frontend/etc/environment.sh.example frontend/etc/environment.sh
```

| Variable | Description |
|----------|-------------|
| `PROFILE` | AWS CLI profile name |
| `REGION` | AWS region |
| `ACCOUNTID` | AWS account ID |
| `P_ECS_PUBLIC_SUBNET_IDS` | Public subnet IDs for frontend ECS tasks |
| `P_ECS_FRONTEND_CPU` | CPU units (default: `256`) |
| `P_ECS_FRONTEND_MEMORY` | Memory in MiB (default: `512`) |

**Frontend Vite** (`frontend/.env`):
```bash
cp frontend/.env.example frontend/.env
```

| Variable | Description |
|----------|-------------|
| `VITE_COGNITO_USER_CLIENT_ID` | Cognito User Client ID (same as backend `LOOM_COGNITO_USER_CLIENT_ID`) |

### Step 2: Deploy Cognito (Optional)

Authentication is optional. Skip this step to run without login.

```bash
cd shared
make cognito                   # Deploy Cognito User Pool, groups, scopes, and clients
# Update O_COGNITO_USER_POOL_ID in shared/etc/environment.sh with the stack output
# Update O_COGNITO_USER_POOL_ID and O_COGNITO_USER_CLIENT_ID in backend/etc/environment.sh
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

For **cloud deployments** using RDS PostgreSQL, install the PostgreSQL driver and point `LOOM_DATABASE_URL` to your RDS instance:

```bash
uv pip install ".[postgres]"
# Set LOOM_DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/loom in backend/etc/environment.sh
make run
```

To migrate an existing SQLite database to PostgreSQL:

```bash
make migrate-db   # copies sqlite:///./loom.db → $LOOM_DATABASE_URL
```

### Step 4: Start the Frontend

```bash
cd frontend
npm install
npm run dev     # Start Vite dev server on LOOM_FRONTEND_PORT
```

### Step 5: Deploy to AWS (Optional)

For cloud deployment, the frontend and backend are containerized and deployed to ECS Fargate behind an ALB. The deployment uses a multi-stack architecture:

| Stack | Directory | Description |
|-------|-----------|-------------|
| `loom-dns` | `shared/` | Route 53 hosted zone for subdomain delegation |
| `loom-infra` | `shared/` | S3, ECR, ACM certificate, ALB |
| `loom-cognito` | `shared/` | Cognito User Pool, groups, scopes |
| `loom-role-*` | `shared/` | IAM execution roles for agents |
| `loom-ecs-cluster` | `shared/` | ECS Fargate cluster (shared) |
| `loom-ecs-frontend` | `frontend/` | Frontend ECS task definition + service |
| `loom-ecs-backend` | `backend/` | Backend ECS task definition + service + auto-scaling |
| `loom-rds` | `backend/` | RDS PostgreSQL + optional RDS Proxy |
| `loom-ec2` | `backend/` | EC2 bastion for SSM tunneling (optional) |

**DNS prerequisite:** The DNS stack creates a Route 53 hosted zone for `P_INFRA_DOMAIN_NAME`. If your domain's parent hosted zone is in a different account, you must add NS delegation records in the parent account before deploying the infra stack (see [Cross-Account DNS Delegation](#cross-account-dns-delegation) below).

**Phase 0** — Deploy DNS, set up delegation, and create ECS service-linked role:

```bash
cd shared && make ecs.init    # Create ECS service-linked role, once per account (~1 min)
cd shared && make dns         # Route 53 hosted zone for subdomain (~1 min)
cd shared && make dns.outputs # Capture oHostedZoneId → O_INFRA_HOSTED_ZONE_ID, oNameServers → NS delegation
```

If cross-account: add NS delegation records in the parent account's hosted zone (see below).

**Phase 1** — Deploy foundation stacks (all independent, can run in parallel):

```bash
cd shared && make infra       # S3, ECR, ACM, ALB (~3 min)
cd shared && make cognito     # Cognito User Pool, groups, scopes (~1 min)
cd shared && make role        # IAM execution roles (~1 min)
cd shared && make ecs         # ECS Fargate cluster (~1 min)
cd backend && make rds        # RDS PostgreSQL + optional RDS Proxy (~25 min)
cd backend && make ec2        # EC2 bastion for SSM tunneling, optional (~3 min)
```

**Note on `role` stacks:** A separate role stack must be created for each application prefix. For example, deploying a role with the prefix `demo` creates an execution role shared by all `demo_*` agents. If you add agents with a different prefix (e.g., `finance_*`), you must deploy an additional role stack for that prefix.

**Phase 2** — Capture stack outputs:

All stack outputs are stored in a single file (`shared/etc/outputs_<profile>.sh`) that is included by all environment files across shared, frontend, and backend directories.

```bash
cd shared && make outputs     # Query all stacks, write to shared/etc/outputs_<profile>.sh
```

This writes all `O_*` variables to one file and updates `frontend/.env` with the Cognito client ID. No manual copy-paste needed.

| Stack | Output | Variable |
|-------|--------|----------|
| `loom-ecs-cluster` | `oEcsClusterArn` | `O_ECS_CLUSTER_ARN` |
| `loom-ecs-cluster` | `oEcsClusterName` | `O_ECS_CLUSTER_NAME` |
| `loom-dns` | `oHostedZoneId` | `O_INFRA_HOSTED_ZONE_ID` |
| `loom-dns` | `oNameServers` | *(NS delegation — displayed in terminal)* |
| `loom-infra` | `oEcsSecurityGroupId` | `O_INFRA_ECS_SG_ID` |
| `loom-infra` | `oFrontendTargetGroupArn` | `O_INFRA_FRONTEND_TG_ARN` |
| `loom-infra` | `oBackendTargetGroupArn` | `O_INFRA_BACKEND_TG_ARN` |
| `loom-infra` | `oFrontendRepositoryUri` | `O_ECR_FRONTEND_URI` |
| `loom-infra` | `oBackendRepositoryUri` | `O_ECR_BACKEND_URI` |
| `loom-cognito` | `oCognitoUserPoolId` | `O_COGNITO_USER_POOL_ID` |
| `loom-cognito` | `oUserClientId` | `O_COGNITO_USER_CLIENT_ID` |
| `loom-rds` | `oRdsSecretArn` | `O_RDS_SECRET_ARN` |
| `loom-rds` | `oConnectEndpoint` | `O_RDS_PROXY_ENDPOINT` |
| `loom-rds` | `oRdsPort` | `O_RDS_PORT` |
| `loom-ec2` | `oInstanceId` | `O_EC2_INSTANCE_ID` |

Then set Cognito user passwords: `cd shared && make cognito.set-passwords`.

**Stack dependency graph:**
```
Phase 0          Phase 1                          Phase 3
--------         ----------------------           ------------------
ecs.init --+     infra    (~3 min)  --+
           |     cognito  (~1 min)  --|
dns -------+     role*    (~1 min)  --+--------> loom-ecs-frontend (~3 min)
                 ecs      (~1 min)  --|          loom-ecs-backend  (~3 min)
                 rds      (~25 min) --|
                 ec2      (~3 min)  --+ (optional)

* A role stack is deployed per application prefix (e.g., demo -> demo_* agents)
```

**Phase 3** — Deploy containers (frontend and backend can run in parallel):

```bash
cd shared && make deploy              # Build, push, and deploy both

# Or independently:
cd shared && make deploy.frontend     # Frontend only (~1 min build + ~3 min deploy)
cd shared && make deploy.backend      # Backend only (~1 min build + ~3 min deploy)

# Or deploy ECS services directly (after images are pushed):
cd frontend && make ecs               # Frontend ECS service only
cd backend && make ecs                # Backend ECS service only
```

**Approximate total deployment time:** ~35 minutes end-to-end (dominated by RDS at ~25 min; Phase 1 stacks deploy in parallel).

## Architecture

- **Backend:** FastAPI with SQLAlchemy (SQLite for local dev, PostgreSQL/RDS for cloud), boto3 for AWS, SSE streaming via `StreamingResponse`
- **Infrastructure:** SAM templates — shared (DNS, S3, ECR, ACM, ALB, ECS cluster) in `shared/iac/`, frontend ECS service in `frontend/iac/`, backend (RDS, EC2 bastion, ECS service) in `backend/iac/`
- **Containers:** Dockerfiles for both frontend (multi-stage Node + nginx) and backend (Python 3.13 slim + uvicorn + agent source from repo root), deployable to ECS Fargate behind an ALB with ACM certificate
- **Frontend:** React 18, TypeScript, Vite, shadcn/ui, Tailwind CSS v4
- **Auth:** Cognito User Pool with group-based scopes; frontend enforces sidebar visibility and write permissions
- **Navigation:** Platform Catalog, Agents, Memory, Security Admin, MCP Servers, A2A Agents, Tags, Costs, Settings, Admin Dashboard (super-admins only)

### Cross-Account DNS Delegation

The DNS stack (`loom-dns`) creates a Route 53 hosted zone for `P_INFRA_DOMAIN_NAME`. If your domain's parent hosted zone is in a different AWS account, you must add NS delegation records in the parent account **before** deploying the infra stack (which creates the ACM certificate).

**After deploying the DNS stack**, retrieve the NS records:

```bash
cd shared && make dns.outputs    # Look for oNameServers (comma-separated list of 4 NS records)
```

**In the parent account** (where the domain's hosted zone lives):

Add an NS record in the parent hosted zone that delegates the subdomain to the deployment account:

```bash
aws route53 change-resource-record-sets --hosted-zone-id <parent-hosted-zone-id> --profile <parent-account-profile> --change-batch '{
  "Changes": [{
    "Action": "CREATE",
    "ResourceRecordSet": {
      "Name": "loom.yourdomain.com",
      "Type": "NS",
      "TTL": 300,
      "ResourceRecords": [
        {"Value": "ns-XXXX.awsdns-XX.org"},
        {"Value": "ns-XXXX.awsdns-XX.co.uk"},
        {"Value": "ns-XXXX.awsdns-XX.com"},
        {"Value": "ns-XXXX.awsdns-XX.net"}
      ]
    }
  }]
}'
```

Replace the 4 NS values with the actual name servers from `oNameServers`. Once delegation is active, the ACM certificate will validate automatically and the ALB alias record will resolve through the delegation from the parent zone.

If your domain's hosted zone is already in the deployment account, no delegation is needed — DNS resolution works directly.
