# syntax=docker/dockerfile:1
# One image runs the whole product: the API serves the built web app on the same origin.

# ---------- Build the web app (type-checks the shared core too) ----------
FROM node:22-alpine AS web
WORKDIR /app
COPY core ./core
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
# The web app always talks to the API. VITE_DEMO_MODE=true adds the judges' demo tools (docker-compose.yml sets it).
ARG VITE_DEMO_MODE=false
RUN cd web && VITE_DEMO_MODE=$VITE_DEMO_MODE npm run build

# ---------- API ----------
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY core ./core
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY data ./data
COPY --from=web /app/web/dist ./web/dist
WORKDIR /app/server
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node_modules/.bin/tsx", "src/index.ts"]
