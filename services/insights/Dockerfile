# Multi-stage: compile TypeScript, then ship only dist + production deps.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
# The analyst's knowledge corpus is read at runtime from /app/corpus (src/knowledge.ts).
COPY corpus ./corpus
USER node
EXPOSE 8070
CMD ["node", "dist/index.js"]
