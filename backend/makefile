include etc/environment.sh
BASE_URL=http://localhost:$${BACKEND_PORT:-8000}

install:
	source .venv/bin/activate && uv pip install -r requirements.txt

test:
	source .venv/bin/activate && python -m pytest tests/ -v

run:
	source .venv/bin/activate && uvicorn app.main:app --reload --port $${BACKEND_PORT:-8000}

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
