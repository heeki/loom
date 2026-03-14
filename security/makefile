include etc/environment.sh

# role
role: role.package role.deploy
role.package:
	sam package \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(ROLE_TEMPLATE) \
		--output-template-file $(ROLE_OUTPUT) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_ROLE_STACK)

role.deploy:
	sam deploy \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(ROLE_OUTPUT) \
		--stack-name $(P_ROLE_STACK) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_ROLE_STACK) \
		--parameter-overrides \
			pAgentName=$(P_AGENT_NAME) \
			pRoleSuffix=$(P_AGENT_NAME_SANITIZED) \
			pBedrockModelArns=$(P_BEDROCK_MODEL_ARNS) \
			pAgentCoreRegions=$(P_AGENTCORE_REGIONS) \
			pLogsRegion=$(P_LOGS_REGION) \
			pTagApplication=$(P_TAG_APPLICATION) \
			pTagGroup=$(P_TAG_GROUP) \
			pTagOwner=$(P_TAG_OWNER) \
		--capabilities CAPABILITY_NAMED_IAM \
		--no-confirm-changeset

role.delete:
	sam delete \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_ROLE_STACK) \
		--no-prompts

# cognito
cognito: cognito.package cognito.deploy
cognito.package:
	sam package \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(COGNITO_TEMPLATE) \
		--output-template-file $(COGNITO_OUTPUT) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_COGNITO_STACK)

cognito.deploy:
	sam deploy \
		--profile $(PROFILE) \
		--region $(REGION) \
		--template-file $(COGNITO_OUTPUT) \
		--stack-name $(P_COGNITO_STACK) \
		--s3-bucket $(BUCKET) \
		--s3-prefix $(P_COGNITO_STACK) \
		--parameter-overrides \
			pPoolName=$(P_COGNITO_POOL_NAME) \
			pDomain=$(P_COGNITO_DOMAIN) \
			pResourceServerIdentifier=$(P_COGNITO_RESOURCE_SERVER) \
			pScopes=$(P_COGNITO_SCOPES) \
			pCallbackUrls=$(P_COGNITO_CALLBACK_URLS) \
			pTagApplication=$(P_TAG_APPLICATION) \
			pTagGroup=$(P_TAG_GROUP) \
			pTagOwner=$(P_TAG_OWNER) \
		--capabilities CAPABILITY_NAMED_IAM \
		--no-confirm-changeset

cognito.delete:
	sam delete \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_COGNITO_STACK) \
		--no-prompts

# cognito user management
cognito.set-passwords:
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username admin --password '$(P_COGNITO_PERMANENT_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username secadmin --password '$(P_COGNITO_PERMANENT_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username datasteward --password '$(P_COGNITO_PERMANENT_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username builder --password '$(P_COGNITO_PERMANENT_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username operator --password '$(P_COGNITO_PERMANENT_PASSWORD)' --permanent

