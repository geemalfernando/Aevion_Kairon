# syntax=docker/dockerfile:1
# Build targets:
#   frontend  nginx serving the built web app and proxying /api to the backend (docker compose up)
#   api       the Fastify API only (docker compose up)
#   app       default: the API serving the built web app on one origin

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

# ---------- Frontend ----------
FROM nginx:1.29-alpine AS frontend
COPY docker/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=web /app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD wget -q --spider http://127.0.0.1/ || exit 1

# ---------- API ----------
FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY core ./core
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY data ./data
WORKDIR /app/server
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node_modules/.bin/tsx", "src/index.ts"]

# ---------- API + web app on one origin (default) ----------
FROM api AS app
COPY --from=web /app/web/dist /app/web/dist
