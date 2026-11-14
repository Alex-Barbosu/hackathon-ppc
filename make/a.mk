# Zone A targets.
.PHONY: a-test a-run a-logs a-tus-check a-doc-check a-audit-check a-fallback-check a-policy-check a-policy-check

a-test: ## Zone A: unit tests for filegrid-api
	cd services/filegrid-api && mvn -q -B test

a-run: ## Zone A: rebuild and restart only filegrid-api
	docker compose up -d --build --wait filegrid-api

a-logs: ## Zone A: follow filegrid-api logs
	docker compose logs -f --tail=100 filegrid-api

a-tus-check: ## Zone A: resumable upload proof (MIB=1024 DROP=20): drop the link mid-chunk, resume, compare SHA-256, print API heap
	python3 services/filegrid-api/scripts/tus_check.py $(or $(MIB),1024) $(or $(DROP),20)

a-doc-check: ## Zone A: document proof (TAMPER=1 adds the audit tamper demo): ciphertext in Postgres, 422 on a flipped bit, audit chain
	python3 services/filegrid-api/scripts/doc_check.py $(if $(TAMPER),--tamper-demo)

a-audit-check: ## Zone A: re-compute the audit_log hash chain from the database (exit 1 if broken)
	python3 services/filegrid-api/scripts/audit_check.py

a-fallback-check: ## Zone A: STOPS then restarts seaweedfs and postgres (SKIP_DB=1 keeps postgres): fallback, spool drain, circuit, meter spool
	python3 services/filegrid-api/scripts/fallback_check.py $(if $(SKIP_DB),--skip-db)

a-policy-check: ## Zone A: policy changes with no restart (NO_FILE=1 skips the config/policy.yaml edit, NO_RESTART=1 skips the restart)
	python3 services/filegrid-api/scripts/policy_check.py
