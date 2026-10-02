# syntax=docker/dockerfile:1
# Images for `docker compose up --build` (see docker-compose.yml):
#   --target frontend   nginx serving the built web app, forwarding /api to the backend
#   --target backend    the Kairon API (Fastify on Node.js)
# Competition data is never copied into an image; compose mounts ./data at runtime.

ARG NODE_IMAGE=node:22-alpine

# ---------- Web app build (also type-checks the shared core) ----------
FROM ${NODE_IMAGE} AS web-build
WORKDIR /app
COPY core ./core
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix web
COPY web ./web
# true adds the judges' demo tools: one-tap demo sign-in, the Demo pill and /states.
ARG VITE_DEMO_MODE=false
RUN cd web && VITE_DEMO_MODE=$VITE_DEMO_MODE npm run build

# ---------- Frontend ----------
FROM nginx:1.29-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -q --spider http://127.0.0.1/ || exit 1

# ---------- Backend ----------
FROM ${NODE_IMAGE} AS backend
ENV NODE_ENV=production
WORKDIR /app
COPY core ./core
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --omit=dev && npm cache clean --force
COPY server ./server
WORKDIR /app/server
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node_modules/.bin/tsx", "src/index.ts"]

# AWS: one non-root container serves the API and the production web build on the same origin.
# This does not use the demo nginx/compose stack. Build with --target production.
FROM backend AS production
COPY --from=web-build --chown=node:node /app/web/dist /app/web/dist
# Use the loader directly: the tsx CLI creates an IPC socket in /tmp, which is read-only on ECS.
CMD ["node", "--import", "tsx", "src/index.ts"]
