# Zone C targets.
.PHONY: c-test c-web c-insights

c-test: ## Zone C: typecheck web and insights
	cd apps/web && npm ci --silent && npm run typecheck
	cd services/insights && npm ci --silent && npm run typecheck

c-web: ## Zone C: Vite dev server on :5173, proxied to the running gateway
	cd apps/web && npm install --silent && npm run dev

c-insights: ## Zone C: rebuild and restart insights
	docker compose up -d --build --wait insights
