# Zone A targets.
.PHONY: a-test a-run a-logs a-tus-check

a-test: ## Zone A: unit tests for filegrid-api
	cd services/filegrid-api && mvn -q -B test

a-run: ## Zone A: rebuild and restart only filegrid-api
	docker compose up -d --build --wait filegrid-api

a-logs: ## Zone A: follow filegrid-api logs
	docker compose logs -f --tail=100 filegrid-api

a-tus-check: ## Zone A: resumable upload proof (MIB=1024 DROP=20): drop the link mid-chunk, resume, compare SHA-256, print API heap
	python3 services/filegrid-api/scripts/tus_check.py $(or $(MIB),1024) $(or $(DROP),20)
