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
│   │   ├── a2a_client.py   # A2A agent client vending (scaffold)
│   │   └── memory.py       # AgentCore Memory hooks
│   └── telemetry.py        # OTEL instrumentation setup
├── tests/
│   ├── __init__.py
│   ├── test_config.py
│   ├── test_agent.py
│   ├── test_mcp_client.py
│   ├── test_a2a_client.py
│   ├── test_memory.py
│   └── test_handler.py
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

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_CONFIG_PATH` | Path to configuration JSON file | — |
| `AGENT_CONFIG_JSON` | Inline configuration JSON string | — |
| `MEMORY_STORE_ID` | AgentCore Memory store identifier | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTEL collector endpoint | `http://localhost:4317` |
| `OTEL_SERVICE_NAME` | Service name for telemetry | `loom-agent` |
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

### A2A Agent Clients

Agent-to-agent (A2A) communication is scaffolded but not yet implemented. The configuration schema is defined and client vending follows the same pattern as MCP tools.

### AgentCore Memory

When enabled, the agent uses Strands hooks to load and save conversational context via AgentCore Memory. The memory store must be pre-provisioned and its ID provided via `MEMORY_STORE_ID`.

### Observability (OTEL)

The agent emits OpenTelemetry traces and metrics via the AWS Distro for OpenTelemetry (ADOT). Spans are created for agent invocations, tool calls, and model calls.
