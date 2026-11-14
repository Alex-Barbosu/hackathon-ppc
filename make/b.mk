# Zone B targets.
.PHONY: b-test b-sim b-chaos b-rate b-profile b-token

b-test: ## Zone B: typecheck and test the simulator and chaos-control
	cd services/meter-simulator && npm ci --silent && npm run typecheck && npm test
	cd services/chaos-control && npm ci --silent && npm run typecheck && npm test

b-sim: ## Zone B: rebuild and restart the meter simulator
	docker compose up -d --build --wait meter-simulator

b-chaos: ## Zone B: rebuild and restart chaos-control
	docker compose up -d --build --wait chaos-control
b-rate: ## Zone B: set meter readings per second live: make b-rate R=20
	@docker compose exec -T meter-simulator wget -qO- --post-data='{"readingsPerSec":$(or $(R),1)}' --header='content-type: application/json' http://127.0.0.1:9100/rate; echo
b-profile: ## Zone B: switch the meter day profile live: make b-profile P=peak (10x) or P=normal
	@docker compose exec -T meter-simulator wget -qO- --post-data='{"profile":"$(or $(P),normal)"}' --header='content-type: application/json' http://127.0.0.1:9100/rate; echo
b-token: ## Zone B: print an admin JWT for /chaos and /api (8 h): TOKEN=$$(make -s b-token)
	@docker compose exec -T chaos-control node dist/token.js
