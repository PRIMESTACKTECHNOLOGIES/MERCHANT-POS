FROM node:20-alpine AS build
WORKDIR /app

# ── NPM_TOKEN build-arg: pass at build time, never stored in the final image.
#    Example:  docker build --build-arg NPM_TOKEN=npm_xxxx .
ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /root/.npmrc; fi

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install --no-audit --no-fund
# Destroy the build-time npmrc before COPYing source.
RUN rm -f /root/.npmrc
COPY . .
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# Do NOT carry forward NPM_TOKEN into the production runtime.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
EXPOSE 3000
CMD ["node","dist/app.js"]
