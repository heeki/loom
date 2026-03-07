include etc/environment.sh
BASE_URL=http://localhost:$${LOOM_BACKEND_PORT:-8000}

install:
	source .venv/bin/activate && uv pip install -r requirements.txt

test:
	source .venv/bin/activate && python -m pytest tests/ -v

run:
	source .venv/bin/activate && uvicorn app.main:app --reload --port $${LOOM_BACKEND_PORT:-8000}

# Manual testing targets
curl.health:
	curl -s $(BASE_URL)/health | jq

curl.agents.register:
	curl -s -X POST $(BASE_URL)/api/agents \
		-H "Content-Type: application/json" \
		-d '{"arn": "$(ARN)"}' | jq

curl.agents.list:
	curl -s $(BASE_URL)/api/agents | jq

curl.agents.get:
	curl -s $(BASE_URL)/api/agents/$(AGENT_ID) | jq

curl.agents.refresh:
	curl -s -X POST $(BASE_URL)/api/agents/$(AGENT_ID)/refresh | jq

curl.agents.delete:
	curl -s -X DELETE $(BASE_URL)/api/agents/$(AGENT_ID) -w "\nHTTP %{http_code}\n"

curl.invoke:
	source .venv/bin/activate && python scripts/stream.py \
		$(BASE_URL) $(AGENT_ID) "$(PROMPT)" "$(or $(QUALIFIER),DEFAULT)"

curl.sessions.list:
	curl -s $(BASE_URL)/api/agents/$(AGENT_ID)/sessions | jq

curl.sessions.get:
	curl -s $(BASE_URL)/api/agents/$(AGENT_ID)/sessions/$(SESSION_ID) | jq

curl.logs:
	curl -s "$(BASE_URL)/api/agents/$(AGENT_ID)/logs?qualifier=$(or $(QUALIFIER),DEFAULT)&limit=$(or $(LIMIT),20)$(if $(STREAM),&stream=$(STREAM),)" | jq

curl.logs.streams:
	curl -s "$(BASE_URL)/api/agents/$(AGENT_ID)/logs/streams?qualifier=$(or $(QUALIFIER),DEFAULT)" | jq

curl.logs.session:
	curl -s "$(BASE_URL)/api/agents/$(AGENT_ID)/sessions/$(SESSION_ID)/logs?qualifier=$(or $(QUALIFIER),DEFAULT)" | jq

# Deploy agent
curl.agents.deploy:
	curl -s -X POST $(BASE_URL)/api/agents \
		-H "Content-Type: application/json" \
		-d '{"source": "deploy", "name": "$(NAME)", "code_uri": "$(CODE_URI)", "config": $(or $(CONFIG),{})}' | jq

# Redeploy agent
curl.agents.redeploy:
	curl -s -X POST $(BASE_URL)/api/agents/$(AGENT_ID)/redeploy | jq

# Agent config
curl.agents.config.get:
	curl -s $(BASE_URL)/api/agents/$(AGENT_ID)/config | jq

curl.agents.config.update:
	curl -s -X PUT $(BASE_URL)/api/agents/$(AGENT_ID)/config \
		-H "Content-Type: application/json" \
		-d '{"config": $(CONFIG)}' | jq

# Credential providers
curl.credentials.create:
	curl -s -X POST $(BASE_URL)/api/agents/$(AGENT_ID)/credential-providers \
		-H "Content-Type: application/json" \
		-d '$(BODY)' | jq

curl.credentials.list:
	curl -s $(BASE_URL)/api/agents/$(AGENT_ID)/credential-providers | jq

curl.credentials.delete:
	curl -s -X DELETE $(BASE_URL)/api/agents/$(AGENT_ID)/credential-providers/$(PROVIDER_ID) -w "\nHTTP %{http_code}\n"

# Integrations
curl.integrations.create:
	curl -s -X POST $(BASE_URL)/api/agents/$(AGENT_ID)/integrations \
		-H "Content-Type: application/json" \
		-d '$(BODY)' | jq

curl.integrations.list:
	curl -s $(BASE_URL)/api/agents/$(AGENT_ID)/integrations | jq

curl.integrations.update:
	curl -s -X PUT $(BASE_URL)/api/agents/$(AGENT_ID)/integrations/$(INTEGRATION_ID) \
		-H "Content-Type: application/json" \
		-d '$(BODY)' | jq

curl.integrations.delete:
	curl -s -X DELETE $(BASE_URL)/api/agents/$(AGENT_ID)/integrations/$(INTEGRATION_ID) -w "\nHTTP %{http_code}\n"

# Memory resources
curl.memories.create:
	curl -s -X POST $(BASE_URL)/api/memories \
		-H "Content-Type: application/json" \
		-d '{"name": "$(MEMORY_NAME)", "event_expiry_duration": $(MEMORY_EVENT_EXPIRY_DURATION), "memory_strategies": [{"strategy_type": "semantic", "name": "default-semantic"}]}' | jq

curl.memories.list:
	curl -s $(BASE_URL)/api/memories | jq

curl.memories.get:
	curl -s $(BASE_URL)/api/memories/$(MEMORY_ID) | jq

curl.memories.refresh:
	curl -s -X POST $(BASE_URL)/api/memories/$(MEMORY_ID)/refresh | jq

curl.memories.delete:
	curl -s -X DELETE $(BASE_URL)/api/memories/$(MEMORY_ID) -w "\nHTTP %{http_code}\n"
