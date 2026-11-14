# Multi-stage: compile TypeScript, then ship only dist + production deps.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
FROM node:22-alpine
ENV NODE_ENV=production
# su-exec drops from root to `node` after the entrypoint joins the socket's group.
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
EXPOSE 8090
ENTRYPOINT ["/bin/sh", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
