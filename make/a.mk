# Zone A targets.
.PHONY: a-test a-run a-logs a-tus-check a-doc-check a-audit-check a-fallback-check a-policy-check a-bulkhead-check a-trace-check a-download-check a-ops-check a-slowlane-check a-meter-check a-comtrade-check

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

a-bulkhead-check: ## Zone A: outage storm with tight limits (via PUT /policy, restored after); meter and documents keep working
	python3 services/filegrid-api/scripts/bulkhead_check.py

a-trace-check: ## Zone A: one request followed in Tempo and Loki (NO_CHAOS=1 skips the seaweedfs stop for the fallback trace)
	python3 services/filegrid-api/scripts/trace_check.py

a-download-check: ## Zone A: large download read once (MIB_SMALL=48 MIB_LARGE=96): first byte at once, identical bytes, corrupt file cut short
	python3 services/filegrid-api/scripts/download_check.py

a-ops-check: ## Zone A: DELETE /files/{id}, storages behind Toxiproxy (adds then removes latency toxics), /storages/health with a hung S3
	python3 services/filegrid-api/scripts/ops_check.py

a-slowlane-check: ## Zone A: big video over the slow lane (MIB=1024 LATENCY=300 LOSS=10): link breaks, upload resumes, hash equal. Clears the lane at the end
	python3 services/filegrid-api/scripts/slowlane_check.py $(or $(MIB),1024) $(or $(LATENCY),300) $(or $(LOSS),10)

a-meter-check: ## Zone A: meter reading -> meter_intervals, retries never duplicate, outage region kept (removes the rows it makes)
	python3 services/filegrid-api/scripts/meter_check.py

a-comtrade-check: ## Zone A: an outage .cfg is read at upload (station, fault time) into files.metadata; other files get none (removes what it makes)
	python3 services/filegrid-api/scripts/comtrade_check.py
