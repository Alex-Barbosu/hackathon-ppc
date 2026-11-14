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
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The state volume inherits this ownership on first mount, so the non-root user can write it.
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 9100
CMD ["node", "dist/index.js"]
