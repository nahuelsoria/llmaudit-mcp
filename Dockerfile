# Image for directory checks (Glama and the like): builds the xmcp server and
# serves it over HTTP on $PORT (default 3001). Without SUPABASE_* the run store
# is in memory, which is enough to start and answer introspection; do not run
# it like this in production.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Leidos por xmcp.config.ts al compilar, no en runtime.
ENV HOST=0.0.0.0 PORT=3001
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/http.js"]
