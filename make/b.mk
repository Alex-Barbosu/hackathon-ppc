# Zone B targets.
.PHONY: b-test b-sim b-chaos b-rate b-profile b-token

b-test: ## Zone B: typecheck and test the simulator and chaos-control
	cd services/meter-simulator && npm ci --silent && npm run typecheck && npm test
	cd services/chaos-control && npm ci --silent && npm run typecheck && npm test

b-sim: ## Zone B: rebuild and restart the meter simulator
	docker compose up -d --build --wait meter-simulator

.PHONY: b-load
b-load: ## Zone B: run a k6 scenario: make b-load S=baseline|storm-outage|video-lossy [DURATION=2m] [MULTIPLIER=10]
	@test -f loadtest/$(or $(S),baseline).js || { echo "no loadtest/$(S).js"; exit 1; }
	docker compose --profile load run --rm $(if $(filter video-lossy,$(S)),k6-slowlane,k6) run \
	  -o experimental-prometheus-rw --tag testid=$(or $(S),baseline)-$$(date +%H%M%S) \
	  $(foreach v,DURATION MULTIPLIER OUTAGE_PER_SEC OUTAGE_MB DOCUMENT_PER_SEC VIDEO_MB CHUNK_MB LOSS_PCT LATENCY_MS JITTER_MS BANDWIDTH_KBPS,$(if $($(v)),-e $(v)=$($(v)))) \
	  $(or $(S),baseline).js
.PHONY: b-dashboards
b-dashboards: ## Zone B: regenerate Grafana dashboard JSON from infra/grafana/src (Grafana reloads it within 30 s)
	docker run --rm -v "$(CURDIR)/infra/grafana:/g" -w /g node:22-alpine node src/overview.mjs
.PHONY: b-rules
b-rules: ## Zone B: check and unit-test the Prometheus alert rules (promtool, in Docker)
	docker run --rm -v "$(CURDIR)/infra/prometheus:/etc/prometheus:ro" --entrypoint promtool prom/prometheus:v3.1.0 check config /etc/prometheus/prometheus.yml
	docker run --rm -v "$(CURDIR)/infra/prometheus:/etc/prometheus:ro" -w /etc/prometheus/tests --entrypoint promtool prom/prometheus:v3.1.0 test rules filegrid.test.yml
b-chaos: ## Zone B: rebuild and restart chaos-control
	docker compose up -d --build --wait chaos-control
b-rate: ## Zone B: set meter readings per second live: make b-rate R=20
	@docker compose exec -T meter-simulator wget -qO- --post-data='{"readingsPerSec":$(or $(R),1)}' --header='content-type: application/json' http://127.0.0.1:9100/rate; echo
b-profile: ## Zone B: switch the meter day profile live: make b-profile P=peak (10x) or P=normal
	@docker compose exec -T meter-simulator wget -qO- --post-data='{"profile":"$(or $(P),normal)"}' --header='content-type: application/json' http://127.0.0.1:9100/rate; echo
b-token: ## Zone B: print an admin JWT for /chaos and /api (8 h): TOKEN=$$(make -s b-token)
	@docker compose exec -T chaos-control node dist/token.js

.PHONY: b-alert-check
b-alert-check: ## Zone B: fire and resolve StorageDown, MeterReadingLossRisk, IntegrityFailure; check insights got both (~12 min)
	@./scripts/alert-check.sh
.PHONY: b-trace
b-trace: ## Zone B: upload one file, check its trace gateway → API → storage in Tempo and its log in Loki, print the Grafana link
	@./scripts/trace-check.sh
.PHONY: tunnel tunnel-down
tunnel: ## Public HTTPS link (Cloudflare quick tunnel, random trycloudflare URL) to share the demo
	@./scripts/tunnel.sh
tunnel-down: ## Close the public link
	docker compose --profile tunnel rm -sf cloudflared
