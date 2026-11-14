# Zone B. One command to run FileGrid: `make up`.
# Zones add their own targets in make/a.mk, make/b.mk, make/c.mk (no edits here needed).

SHELL := /bin/sh
COMPOSE := docker compose
HOST ?= localhost

.DEFAULT_GOAL := help

include make/a.mk make/b.mk make/c.mk

.PHONY: help up down reset logs ps gen test trust scale check demo demo-scale

help: ## Show every target
	@grep -hE '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

check: ## Verify Docker and Compose are installed
	@command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/"; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2.20+ is required"; exit 1; }

up: check ## Generate secrets if needed, build and start everything, wait until healthy
	@./scripts/init-env.sh
	$(COMPOSE) up -d --build --wait
	@echo ""
	@echo "  FileGrid      https://$(HOST)"
	@echo "  Grafana       https://$(HOST)/grafana   (admin password in .env)"
	@echo "  Mock API      https://$(HOST)/mock/api/v1/health"
	@echo "  Slow lane     https://$(HOST):8443      (through Toxiproxy)"
	@echo ""
	@echo "  First visit shows a certificate warning: run 'make trust' once."

down: ## Stop everything, keep data
	$(COMPOSE) down

reset: ## Stop everything and delete all data volumes
	$(COMPOSE) down -v --remove-orphans

logs: ## Follow logs (one service: make logs s=filegrid-api)
	$(COMPOSE) logs -f --tail=100 $(s)

ps: ## Show service health
	$(COMPOSE) ps

scale: ## Run N replicas of the API behind the gateway: make scale N=3
	$(COMPOSE) up -d --no-recreate --scale filegrid-api=$(or $(N),3) --wait

demo: ## Live demo with pauses: baseline, storm x10, stop S3, bad link, corrupt, reset (DEMO_AUTO=5 = unattended)
	@./scripts/demo.sh
demo-scale: ## Scale to 3 API replicas, k6 storm x10 killing one replica, lossy video upload, scale back
	@./scripts/demo-scale.sh
gen: ## Regenerate API clients from contracts/openapi.yaml
	cd apps/web && npm run gen:api

test: a-test b-test b-rules c-test ## Run every zone's tests

trust: ## Export Caddy's local root certificate so browsers trust https://localhost
	@$(COMPOSE) cp caddy:/data/caddy/pki/authorities/local/root.crt ./filegrid-root.crt
	@echo "Saved ./filegrid-root.crt. Import it into your OS/browser trust store:"
	@echo "  macOS:   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain filegrid-root.crt"
	@echo "  Linux:   sudo cp filegrid-root.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates"
	@echo "  Windows: certutil -addstore -f ROOT filegrid-root.crt"
