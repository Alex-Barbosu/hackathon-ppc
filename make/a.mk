# Zone A targets.
.PHONY: a-test a-run a-logs

a-test: ## Zone A: unit tests for filegrid-api
	cd services/filegrid-api && mvn -q -B test

a-run: ## Zone A: rebuild and restart only filegrid-api
	docker compose up -d --build --wait filegrid-api

a-logs: ## Zone A: follow filegrid-api logs
	docker compose logs -f --tail=100 filegrid-api
