# ── Stage 1: Build the TypeScript backend ────────────────────────────────────
FROM node:20-bookworm-slim AS backend-build
WORKDIR /app

ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /root/.npmrc

# Build tools needed only for keccak native module in Stage 1
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
# Install all deps (skip nfc-pcsc hardware scripts), rebuild keccak native module
RUN npm --prefix backend install --no-audit --no-fund --ignore-scripts \
 && npm --prefix backend rebuild keccak

RUN rm -f /root/.npmrc

COPY backend ./backend
RUN npm --prefix backend run build

# Build the React frontend during the image build so Render always deploys the
# current client instead of relying on a stale checked-in client/dist folder.
COPY client/package*.json ./client/
RUN npm --prefix client install --no-audit --no-fund
COPY client ./client
RUN npm --prefix client run build

# ── Stage 2: Production runtime ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000

ARG NPM_TOKEN

# sql.js is pure WebAssembly — NO build tools needed at all
# Only runtime libs for nfc-pcsc (libpcsclite) kept for completeness
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpcsclite1 \
    && rm -rf /var/lib/apt/lists/*

RUN if [ -n "$NPM_TOKEN" ]; then echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /root/.npmrc; fi
COPY backend/package*.json ./backend/

# Install prod deps — skip nfc-pcsc scripts, rebuild keccak only
RUN npm --prefix backend install --omit=dev --no-audit --no-fund --ignore-scripts \
 && npm --prefix backend rebuild keccak

RUN rm -f /root/.npmrc

# Copy compiled backend from Stage 1
COPY --from=backend-build /app/backend/dist ./backend/dist

# Copy the freshly built React client
COPY --from=backend-build /app/client/dist ./backend/dist/public

# Writable directories for SQLite database
RUN mkdir -p /app/data /app/backend/data && chown -R node:node /app/data /app/backend/data

USER node

EXPOSE 10000
CMD ["node", "/app/backend/dist/server.js"]
