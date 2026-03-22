include etc/environment.sh
BASE_URL=http://localhost:$${LOOM_BACKEND_PORT:-8000}

install:
	source .venv/bin/activate && uv pip install -r requirements.txt

test:
	source .venv/bin/activate && python -m pytest tests/ -v

run:
	source .venv/bin/activate && uvicorn app.main:app --reload --port $${LOOM_BACKEND_PORT:-8000}

# Setup and migration
migrate: migrate-db fix-sequences

reset-db:
	source .venv/bin/activate && python scripts/reset_db.py

migrate-db:
	source .venv/bin/activate && python scripts/migrate_sqlite_to_postgres.py \
		--source sqlite:///./loom.db \
		--dest $${LOOM_DATABASE_URL}

fix-sequences:
	source .venv/bin/activate && python scripts/fix_sequences.py

# AgentCore credential providers
agentcore.credentials.list:
	aws bedrock-agentcore-control list-oauth2-credential-providers \
		--profile $(PROFILE) \
		--region $(REGION) | jq

agentcore.credentials.delete-all:
	@for name in $$(aws bedrock-agentcore-control list-oauth2-credential-providers \
		--profile $(PROFILE) \
		--region $(REGION) | jq -r '.credentialProviders[].name'); do \
		echo "Deleting $$name..."; \
		aws bedrock-agentcore-control delete-oauth2-credential-provider \
			--profile $(PROFILE) \
			--region $(REGION) \
			--name "$$name"; \
	done

# Shared infrastructure (S3)
infra: infra.package infra.deploy

infra.package:
	sam package \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(P_INFRA_TEMPLATE) \
		--output-template-file $(P_INFRA_OUTPUT) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_INFRA_STACK)

infra.deploy:
	sam deploy \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(P_INFRA_OUTPUT) \
		--stack-name $(P_INFRA_STACK) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_INFRA_STACK) \
		--parameter-overrides \
			pArtifactBucketName=$${LOOM_ARTIFACT_BUCKET} \
			pTagApplication=$(P_TAG_APPLICATION) \
			pTagGroup=$(P_TAG_GROUP) \
			pTagOwner=$(P_TAG_OWNER) \
		--no-confirm-changeset

infra.outputs:
	@aws cloudformation describe-stacks \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_INFRA_STACK) \
		--query 'Stacks[0].Outputs' \
		--output json | jq .

infra.delete:
	sam delete \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_INFRA_STACK) \
		--no-prompts

# RDS infrastructure
rds: rds.package rds.deploy

rds.package:
	sam package \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(P_RDS_TEMPLATE) \
		--output-template-file $(P_RDS_OUTPUT) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_RDS_STACK)

rds.deploy:
	sam deploy \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(P_RDS_OUTPUT) \
		--stack-name $(P_RDS_STACK) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_RDS_STACK) \
		--parameter-overrides \
			pDbName=$(P_RDS_DB_NAME) \
			pDbUsername=$(P_RDS_USERNAME) \
			pDbPassword=$(P_RDS_PASSWORD) \
			pDbInstanceClass=$(P_RDS_INSTANCE_CLASS) \
			pDbAllocatedStorage=$(P_RDS_ALLOCATED_STORAGE) \
			pDbMultiAZ=$(P_RDS_MULTI_AZ) \
			pEnableProxy=$(P_RDS_ENABLE_PROXY) \
			pVpcId=$(P_RDS_VPC_ID) \
			pSubnetIds=$(P_RDS_PRIVATE_SUBNET_IDS) \
			pAllowedCidr=$(P_RDS_ALLOWED_CIDR) \
			pTagApplication=$(P_TAG_APPLICATION) \
			pTagGroup=$(P_TAG_GROUP) \
			pTagOwner=$(P_TAG_OWNER) \
		--capabilities CAPABILITY_NAMED_IAM \
		--no-confirm-changeset

rds.outputs:
	@aws cloudformation describe-stacks \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_RDS_STACK) \
		--query 'Stacks[0].Outputs' \
		--output json | jq .

rds.get-url:
	@aws secretsmanager get-secret-value \
		--profile $(PROFILE) \
		--region $(REGION) \
		--secret-id $(P_RDS_STACK)/database-url \
		--query SecretString \
		--output text | jq -r .url

rds.delete:
	sam delete \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_RDS_STACK) \
		--no-prompts

# EC2 infrastructure (SSM tunnel)
ec2: ec2.package ec2.deploy

ec2.package:
	sam package \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(P_EC2_TEMPLATE) \
		--output-template-file $(P_EC2_OUTPUT) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_EC2_STACK)

ec2.deploy:
	sam deploy \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(P_EC2_OUTPUT) \
		--stack-name $(P_EC2_STACK) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_EC2_STACK) \
		--parameter-overrides \
			pVpcId=$(P_RDS_VPC_ID) \
			pSubnetId=$(P_EC2_PUBLIC_SUBNET_ID) \
			pInstanceType=$(P_EC2_INSTANCE_TYPE) \
			pTagApplication=$(P_TAG_APPLICATION) \
			pTagGroup=$(P_TAG_GROUP) \
			pTagOwner=$(P_TAG_OWNER) \
		--capabilities CAPABILITY_NAMED_IAM \
		--no-confirm-changeset

ec2.outputs:
	@aws cloudformation describe-stacks \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_EC2_STACK) \
		--query 'Stacks[0].Outputs' \
		--output json | jq .

ec2.delete:
	sam delete \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_EC2_STACK) \
		--no-prompts

# SSM tunnel
tunnel:
	aws ssm start-session \
		--profile $(PROFILE) \
		--region $(REGION) \
		--target $(P_EC2_INSTANCE_ID) \
		--document-name AWS-StartPortForwardingSessionToRemoteHost \
		--parameters '{"host":["$(P_RDS_PROXY_ENDPOINT)"],"portNumber":["$(P_RDS_PORT)"],"localPortNumber":["$(P_RDS_PORT)"]}'

# Manual testing targets
curl.health:
	curl -s $(BASE_URL)/health | jq

curl.agents.register:
	curl -s -X POST $(BASE_URL)/api/agents \
		-H "Content-Type: application/json" \
		-d '{"arn": "$(AGENT_ARN)"}' | jq

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
		-d '{"name": "$(MEMORY_NAME)", "event_expiry_duration": $(MEMORY_EVENT_EXPIRY_DURATION), "memory_strategies": [{"strategy_type": "semantic", "name": "default_semantic"}]}' | jq

curl.memories.list:
	curl -s $(BASE_URL)/api/memories | jq

curl.memories.get:
	curl -s $(BASE_URL)/api/memories/$(MEMORY_ID) | jq

curl.memories.refresh:
	curl -s -X POST $(BASE_URL)/api/memories/$(MEMORY_ID)/refresh | jq

curl.memories.delete:
	curl -s -X DELETE $(BASE_URL)/api/memories/$(MEMORY_ID) -w "\nHTTP %{http_code}\n"
