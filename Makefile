ENV_FILE ?= .env

ifneq (,$(wildcard $(ENV_FILE)))
include $(ENV_FILE)
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' $(ENV_FILE))
endif

.PHONY: deploy ensure-backend ensure-plugins login ensure-stack set-config ensure-kms logs logs-follow _require-env

STACK ?= $(or $(PULUMI_STACK),dev)
AWS_REGION ?= $(shell aws configure get region 2>/dev/null)
AWS_REGION ?= us-east-1
PULUMI_BUCKET ?= $(or $(PULUMI_BACKEND_BUCKET),cafe-bot-pulumi-state)
PULUMI_STATE_PREFIX ?= $(STACK)
PULUMI_KMS_ALIAS ?= $(or $(PULUMI_SECRETS_ALIAS),alias/cafe-bot-pulumi)
export AWS_REGION
export PULUMI_BUCKET
export PULUMI_STATE_PREFIX
export PULUMI_KMS_ALIAS
export PULUMI_YES=1

deploy: ensure-backend ensure-plugins login ensure-kms ensure-stack set-config
	@echo "Deploying Pulumi stack $(STACK)"
	@pulumi up --yes --stack "$(STACK)"
	@echo "Forcing ECS service to use latest image..."
	@CLUSTER_ARN=$$(aws ecs list-clusters --query "clusterArns[?contains(@, 'botCluster')]" --output text 2>/dev/null | head -1); \
	if [ -n "$$CLUSTER_ARN" ]; then \
		CLUSTER_NAME=$$(echo "$$CLUSTER_ARN" | awk -F'/' '{print $$NF}'); \
		echo "Found cluster: $$CLUSTER_NAME"; \
		aws ecs update-service --cluster "$$CLUSTER_NAME" --service "$(STACK)-cafe-bot" --force-new-deployment >/dev/null 2>&1 && \
		echo "✓ Service $(STACK)-cafe-bot redeployed with latest image" || \
		echo "✗ Failed to redeploy service (may not exist yet)"; \
	else \
		echo "✗ No ECS cluster found"; \
	fi

logs: _require-env
	@echo "Showing logs from running services for $(STACK)-cafe-bot..."
	@TASK_ID=$$(aws ecs list-tasks --cluster botCluster-a9352a5 --service-name $(STACK)-cafe-bot --desired-status RUNNING --query 'taskArns[0]' --output text 2>/dev/null | awk -F'/' '{print $$NF}'); \
	if [ -n "$$TASK_ID" ] && [ "$$TASK_ID" != "None" ]; then \
		echo "Current task: $$TASK_ID"; \
		aws logs get-log-events --log-group-name /aws/ecs/$(STACK)-cafe-bot --log-stream-name "cafe-bot/cafe-bot/$$TASK_ID" --limit 100 --query 'events[]' --output json | jq -r '.[] | "\((.timestamp / 1000) | strftime("%Y-%m-%d %H:%M:%S")) \(.message)"'; \
	else \
		echo "No running tasks found, showing all recent logs..."; \
		aws logs tail /aws/ecs/$(STACK)-cafe-bot --since 24h --format short | tail -100; \
	fi

logs-follow: _require-env
	@echo "Following logs for $(STACK)-cafe-bot (Ctrl+C to stop)..."
	@aws logs tail /aws/ecs/$(STACK)-cafe-bot --follow --format short

ensure-backend: _require-env
	@if aws s3api head-bucket --bucket "$(PULUMI_BUCKET)" 2>/dev/null; then \
		echo "Pulumi backend bucket $(PULUMI_BUCKET) already exists"; \
	else \
		echo "Creating Pulumi backend bucket $(PULUMI_BUCKET)"; \
		if [ "$(AWS_REGION)" = "us-east-1" ] || [ -z "$(AWS_REGION)" ]; then \
			aws s3api create-bucket --bucket "$(PULUMI_BUCKET)" --region "$(AWS_REGION)"; \
		else \
			aws s3api create-bucket --bucket "$(PULUMI_BUCKET)" --region "$(AWS_REGION)" --create-bucket-configuration LocationConstraint="$(AWS_REGION)"; \
		fi; \
	fi
	@aws s3api put-bucket-versioning --bucket "$(PULUMI_BUCKET)" --versioning-configuration Status=Enabled >/dev/null
	@aws s3api put-public-access-block --bucket "$(PULUMI_BUCKET)" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null

login:
	@pulumi login "s3://$(PULUMI_BUCKET)/$(PULUMI_STATE_PREFIX)"

ensure-plugins:
	@pulumi plugin install resource aws >/dev/null 2>&1 || pulumi plugin install resource aws
	@pulumi plugin install resource docker >/dev/null 2>&1 || pulumi plugin install resource docker

ensure-kms: _require-env
	@if aws kms describe-key --key-id "$(PULUMI_KMS_ALIAS)" >/dev/null 2>&1; then \
		echo "Pulumi KMS key $(PULUMI_KMS_ALIAS) already exists"; \
	else \
		echo "Creating Pulumi KMS key $(PULUMI_KMS_ALIAS)"; \
		KEY_ID=$$(aws kms create-key --description "Pulumi secrets for cafe-bot" --tags TagKey=Project,TagValue=cafe-bot --query KeyMetadata.KeyId --output text); \
		aws kms create-alias --alias-name "$(PULUMI_KMS_ALIAS)" --target-key-id "$$KEY_ID"; \
		aws kms enable-key-rotation --key-id "$$KEY_ID" >/dev/null; \
	fi

ensure-stack:
	@if pulumi stack select --stack "$(STACK)" >/dev/null 2>&1; then \
		tmpfile=$$(mktemp); \
		pulumi stack export --stack "$(STACK)" > "$$tmpfile"; \
		CURRENT_PROVIDER=$$(python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); print(data.get("deployment",{}).get("secrets_providers",{}).get("type",""))' "$$tmpfile"); \
		CURRENT_ALIAS=$$(python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); print(data.get("deployment",{}).get("secrets_providers",{}).get("state",{}).get("kmsKeyAlias",""))' "$$tmpfile"); \
		rm -f "$$tmpfile"; \
		if [ "$$CURRENT_PROVIDER" != "awskms" ] || [ "$$CURRENT_ALIAS" != "$(PULUMI_KMS_ALIAS)" ]; then \
			echo "Updating secrets provider to awskms://$(PULUMI_KMS_ALIAS)"; \
			pulumi stack change-secrets-provider --stack "$(STACK)" "awskms://$(PULUMI_KMS_ALIAS)"; \
		fi; \
	else \
		pulumi stack init "$(STACK)" --secrets-provider "awskms://$(PULUMI_KMS_ALIAS)"; \
	fi

set-config: _require-env
	@if [ -z "$(DISCORD_TOKEN)" ]; then echo "DISCORD_TOKEN must be set in $(ENV_FILE)"; exit 1; fi
	@if [ -z "$(CLIENT_ID)" ]; then echo "CLIENT_ID must be set in $(ENV_FILE)"; exit 1; fi
	@pulumi config set --secret discordToken "$(DISCORD_TOKEN)" --stack "$(STACK)"
	@pulumi config set --secret clientId "$(CLIENT_ID)" --stack "$(STACK)"
	@pulumi config set aws:region "$(AWS_REGION)" --stack "$(STACK)"

_require-env:
	@if [ -z "$(AWS_REGION)" ]; then echo "AWS_REGION is not configured; set in $(ENV_FILE) or AWS config"; exit 1; fi
