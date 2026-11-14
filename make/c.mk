# Zone C targets.
.PHONY: c-test c-web c-insights

c-test: ## Zone C: typecheck and unit-test web and insights
	cd apps/web && npm ci --silent && npm run typecheck && npm test
	cd services/insights && npm ci --silent && npm run typecheck && npm test

c-web: ## Zone C: Vite dev server on :5173, proxied to the running gateway
	cd apps/web && npm install --silent && npm run dev

c-insights: ## Zone C: rebuild and restart insights
	docker compose up -d --build --wait insights
