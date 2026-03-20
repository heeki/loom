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
			pMemoryArn=${P_MEMORY_ARN} \
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
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username security-admin --password '$(P_COGNITO_PERMANENT_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username integration-admin --password '$(P_COGNITO_PERMANENT_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-1 --password '$(P_COGNITO_DEMO_USER_1_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-1 --password '$(P_COGNITO_DEMO_USER_1_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-2 --password '$(P_COGNITO_DEMO_USER_2_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-2 --password '$(P_COGNITO_DEMO_USER_2_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-3 --password '$(P_COGNITO_DEMO_USER_3_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-3 --password '$(P_COGNITO_DEMO_USER_3_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-4 --password '$(P_COGNITO_DEMO_USER_4_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-4 --password '$(P_COGNITO_DEMO_USER_4_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-5 --password '$(P_COGNITO_DEMO_USER_5_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-5 --password '$(P_COGNITO_DEMO_USER_5_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-6 --password '$(P_COGNITO_DEMO_USER_6_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-6 --password '$(P_COGNITO_DEMO_USER_6_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-7 --password '$(P_COGNITO_DEMO_USER_7_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-7 --password '$(P_COGNITO_DEMO_USER_7_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-8 --password '$(P_COGNITO_DEMO_USER_8_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-8 --password '$(P_COGNITO_DEMO_USER_8_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-user-9 --password '$(P_COGNITO_DEMO_USER_9_PASSWORD)' --permanent
	aws cognito-idp admin-set-user-password --profile $(PROFILE) --region $(REGION) --user-pool-id $(P_COGNITO_USER_POOL_ID) --username demo-admin-9 --password '$(P_COGNITO_DEMO_USER_9_PASSWORD)' --permanent

cognito.get-client-id:
	@aws cloudformation describe-stacks \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_COGNITO_STACK) \
		--query 'Stacks[0].Outputs[?OutputKey==`oUserClientId`].OutputValue' \
		--output text

cognito.get-tokens:
	@echo "Getting tokens for admin user..."
	@CLIENT_ID=$$(aws cloudformation describe-stacks \
		--profile $(PROFILE) \
		--region $(REGION) \
		--stack-name $(P_COGNITO_STACK) \
		--query 'Stacks[0].Outputs[?OutputKey==`oUserClientId`].OutputValue' \
		--output text); \
	echo "Using client ID: $$CLIENT_ID"; \
	aws cognito-idp admin-initiate-auth \
		--profile $(PROFILE) \
		--region $(REGION) \
		--user-pool-id $(P_COGNITO_USER_POOL_ID) \
		--client-id $$CLIENT_ID \
		--auth-flow ADMIN_NO_SRP_AUTH \
		--auth-parameters USERNAME=admin,PASSWORD='$(P_COGNITO_PERMANENT_PASSWORD)' \
		--output json | jq -r '.AuthenticationResult | "=== Cognito Tokens ===\n\nIdToken:\n\(.IdToken)\n\nAccessToken:\n\(.AccessToken)\n\nRefreshToken:\n\(.RefreshToken)\n\nExpires in: \(.ExpiresIn) seconds"'

