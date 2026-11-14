# Zone B targets.
.PHONY: b-test b-sim b-chaos

b-test: ## Zone B: typecheck simulator and chaos-control
	cd services/meter-simulator && npm ci --silent && npm run typecheck
	cd services/chaos-control && npm ci --silent && npm run typecheck

b-sim: ## Zone B: rebuild and restart the meter simulator
	docker compose up -d --build --wait meter-simulator

b-chaos: ## Zone B: rebuild and restart chaos-control
	docker compose up -d --build --wait chaos-control
