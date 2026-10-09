# syntax=docker/dockerfile:1.7
# Build the SPA, then serve it (and reverse-proxy the API) with Caddy — automatic HTTPS.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Optional build secret `ca`: extra CA bundle for builds behind a TLS-intercepting proxy.
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /src/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
