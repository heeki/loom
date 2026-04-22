# Strands Agent for AgentCore Runtime

Pre-built agent code for deployment on Amazon Bedrock AgentCore Runtime, powered by the Strands Agents SDK.

## Overview

This agent is configured entirely via environment variables and/or a JSON configuration file — no user-authored code is generated. Users configure agents through system prompts, behavioral guidelines, and integration settings. Feature flags toggle integrations (MCP tools, A2A agents, memory) at deploy time.

## Directory Structure

```
strands_agent/
├── etc/
│   ├── config.json         # Local development configuration
│   └── environment.sh      # Local env vars (gitignored)
├── src/
│   ├── __init__.py
│   ├── handler.py          # AgentCore Runtime entry point
│   ├── agent.py            # Agent initialization and configuration
│   ├── config.py           # Configuration loading and validation
│   ├── integrations/
│   │   ├── __init__.py
│   │   ├── mcp_client.py   # MCP tool client vending
│   │   ├── a2a_client.py   # A2A agent client vending
│   │   └── memory.py       # AgentCore Memory hooks
│   └── telemetry.py        # OTEL instrumentation setup
├── tests/
│   ├── __init__.py
│   ├── test_config.py
│   ├── test_agent.py
│   ├── test_handler.py
│   ├── test_telemetry.py
│   ├── test_mcp_client.py
│   ├── test_a2a_client.py
│   └── test_memory.py
├── makefile
├── requirements.txt
└── README.md
```

## Configuration

The agent reads configuration from one of two sources (checked in order):

1. `AGENT_CONFIG_JSON` — inline JSON string
2. `AGENT_CONFIG_PATH` — path to a JSON configuration file

### Configuration Schema

```json
{
  "system_prompt": "You are a helpful assistant...",
  "model_id": "us.anthropic.claude-sonnet-4-20250514",
  "integrations": {
    "mcp_servers": [
      {
        "name": "jira",
        "enabled": true,
        "transport": "streamable_http",
        "endpoint_url": "https://mcp.example.com/jira",
        "auth": {
          "type": "oauth2",
          "well_known_endpoint": "https://auth.example.com/.well-known/openid-configuration",
          "credentials_secret_arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:loom/jira-creds"
        }
      }
    ],
    "a2a_agents": [
      {
        "name": "summarizer",
        "enabled": true,
        "endpoint_url": "https://a2a.example.com/summarizer",
        "auth": {
          "type": "oauth2",
          "well_known_endpoint": "https://auth.example.com/.well-known/openid-configuration",
          "credentials_secret_arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:loom/a2a-creds"
        }
      }
    ],
    "memory": {
      "enabled": true
    }
  }
}
```

### System Prompt Injection

The system prompt is resolved with the following precedence:

1. `AGENT_SYSTEM_PROMPT` environment variable (highest priority — injected by the frontend at deploy time)
2. `system_prompt` field in the configuration JSON file

This allows the frontend to pass the user-configured prompt as a deploy-time parameter without modifying the static config file.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_CONFIG_JSON` | Inline configuration JSON string | — |
| `AGENT_CONFIG_PATH` | Path to configuration JSON file (local dev) | — |
| `AGENT_SYSTEM_PROMPT` | System prompt (overrides config file) | — |
| `AGENT_OBSERVABILITY_ENABLED` | Enables ADOT export pipeline | — |
| `OTEL_SERVICE_NAME` | Service name for ADOT telemetry | `loom-agent` |
| `MEMORY_STORE_ID` | AgentCore Memory store identifier | — |
| `AWS_REGION` | AWS region | `us-east-1` |
| `LOG_LEVEL` | Logging level | `INFO` |

## Development

### Setup

```bash
make install
```

### Run Locally

```bash
source etc/environment.sh
make run
```

### Run Tests

```bash
make test
```

### Build Deployment Artifact

```bash
make build
```

Produces `build/agent.zip` — a self-contained zip deployable to AgentCore Runtime.

## Integrations

### MCP Tool Servers

MCP (Model Context Protocol) tool servers are dynamically loaded from configuration. The agent creates MCP clients at startup for each enabled server. Currently supports `streamable_http` transport.

**Authentication types:**
- `oauth2` — Uses `_OAuth2Auth` httpx handler to exchange workload tokens for downstream access tokens via AgentCore Identity credential providers.
- `api_key` — Uses `_ApiKeyAuth` httpx handler. Resolves the API key once from AWS Secrets Manager at initialization (not per-request) to avoid throttling. Header injection follows `api_key_header_name` — `Authorization` headers use `Bearer` prefix; all others set the raw key.
- Unauthenticated — no auth handler.

**Dynamic MCP connectors:** The handler accepts `dynamic_mcp_servers` in the invocation payload for per-invocation MCP server attachment. A connection pool keyed by `(server_name, actor_id)` reuses previously-connected servers across invocations. For API key connectors, the `{actor_id}` placeholder in `credentials_secret_arn` is resolved to the invoking user's identity.

### A2A Agent Clients

Agent-to-agent (A2A) communication uses the Strands SDK `A2AAgent` class. Each enabled A2A agent in the configuration is wrapped as a `@tool` function that the orchestrating agent can invoke during conversation.

**`_AuthenticatedA2AAgent`** — Subclass of `A2AAgent` for OAuth2-protected A2A endpoints. Injects OAuth2 Bearer tokens via the AgentCore Identity service M2M flow (using the workload token from `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE`). Handles:

- **Agent Card fetching** with authentication, backfilling required fields that older agent cards may omit, and overriding the card's internal URL with the external AgentCore Runtime endpoint.
- **Message sending** with capability-aware method selection. Checks `agent_card.capabilities.streaming` — uses `message/stream` (SSE) only when streaming is supported, otherwise goes directly to `message/send`. Falls back from `message/stream` to `message/send` when the server returns "Method not found".
- **SSE response parsing** — handles both `text/event-stream` (standard A2A streaming) and `application/json` (AgentCore proxy-collapsed) content types. Buffers `Message` events and yields them after `Task` events so that `stream_async` picks the content-bearing `Message` as the `last_complete_event`.
- **Manual task tracking** instead of `ClientTaskManager` to handle duplicate `Task` events emitted by some A2A servers.
- **Salesforce Agentforce support** — detects Salesforce URLs and uses `/v1/card` for Agent Card endpoint instead of `/.well-known/agent.json`. Trusts the card's declared RPC URL (does not override with the configured endpoint) since Salesforce RPC URLs differ from base URLs.

**Authentication flow:** The `_OAuth2Auth` httpx handler (shared with MCP clients) exchanges the ephemeral container workload token for a downstream OAuth2 access token via the AgentCore Identity service credential provider.

### AgentCore Memory

When enabled, the agent uses the `MemoryHook` (a Strands `HookProvider`) to load and save conversational context via AgentCore Memory. The memory store must be pre-provisioned and its ID provided via `MEMORY_STORE_ID`.

**Lifecycle:**
- **Before invocation:** Retrieves memory records via `retrieve_memory_records` using the last user message as the search query. Retrieved records are injected into `invocation_state["memory"]`.
- **After invocation:** Creates events in the memory store for each message in the conversation result via `create_event`.

**Cost telemetry:** The hook always emits a `LOOM_MEMORY_TELEMETRY: retrievals=N, events_sent=M` structured log line at INFO level after each invocation. The backend parses this to compute memory costs (`stm_cost = events_sent / 1000 * $0.25`, `ltm_cost = retrievals / 1000 * $0.50`).

**Error handling:** `AccessDeniedException` and other errors are caught and logged at WARNING level without interrupting the agent invocation. If memory operations fail, the telemetry line still emits with zero counters.

### Observability (OTEL)

The agent emits OpenTelemetry traces and metrics via the AWS Distro for OpenTelemetry (ADOT).

**Span hierarchy:**
- `agent.invocation` (root span per request) — created by `trace_invocation()` in `handler.py`
  - `tool.call` (child spans) — created by `TelemetryHook` via `BeforeToolCallEvent`
  - `model.call` (child spans) — created by `TelemetryHook` via `BeforeModelCallEvent`

**Span attributes:**
- `agent.invocation_id` — session ID passed from the invocation payload
- `agent.session_id` — session ID set on the root span
- `tool.name` — name of the tool being called

**ADOT auto-instrumentation:** The deployment entry point uses `opentelemetry-instrument` as a wrapper (`["opentelemetry-instrument", "src/handler.py"]`), which activates ADOT auto-instrumentation at process startup — before any application code runs. This automatically traces boto3 calls, HTTP clients, and other supported libraries without any manual provider configuration.

**Noop mode:** When running locally without the `opentelemetry-instrument` wrapper, the OpenTelemetry API falls back to noop providers — all tracing APIs succeed without errors and with no performance overhead. The `TelemetryHook` is always registered but produces no-op spans in this mode.

**Deploy-time configuration:** The backend automatically sets `OTEL_SERVICE_NAME` to the agent name when deploying to AgentCore Runtime.
