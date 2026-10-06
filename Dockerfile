# ── Stage 1: Build the TypeScript backend ────────────────────────────────────
FROM node:20-bookworm-slim AS backend-build
WORKDIR /app

ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /root/.npmrc

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
RUN npm --prefix backend install --no-audit --no-fund --ignore-scripts \
 && npm --prefix backend rebuild keccak

RUN rm -f /root/.npmrc

COPY backend ./backend
RUN npm --prefix backend run build

# ── Stage 2: Build the React frontend (client) ────────────────────────────────
FROM node:20-bookworm-slim AS client-build
WORKDIR /app

ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /root/.npmrc; fi

COPY client/package*.json ./client/
RUN npm --prefix client install --no-audit --no-fund

RUN rm -f /root/.npmrc

COPY client ./client
ARG VITE_API_URL
RUN npm --prefix client run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV SERVE_FRONTEND=true

ARG NPM_TOKEN

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpcsclite1 \
    && rm -rf /var/lib/apt/lists/*

RUN if [ -n "$NPM_TOKEN" ]; then echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /root/.npmrc; fi
COPY backend/package*.json ./backend/

RUN npm --prefix backend install --omit=dev --no-audit --no-fund --ignore-scripts \
 && npm --prefix backend rebuild keccak

RUN rm -f /root/.npmrc

# Copy compiled backend
COPY --from=backend-build /app/backend/dist ./backend/dist
# Copy backend public assets (coin logos, etc.)
COPY backend/public ./backend/public
# Copy compiled frontend (client/dist) into backend/dist so it can be served
COPY --from=client-build /app/client/dist ./backend/dist/client

# Writable directories for SQLite database
RUN mkdir -p /app/data /app/backend/data && chown -R node:node /app/data /app/backend/data

USER node

EXPOSE 10000
CMD ["node", "/app/backend/dist/server.js"]
