# syntax=docker/dockerfile:1.7
#
# Single Zeabur service runs two Node processes:
#   - finance-system        :8080  (Odoo sync + dashboard, writes finance.db)
#   - xterio-cfo-mcp        :3000  (read-only MCP server over the same finance.db)
#
# Both share the container filesystem, which is the only way to share finance.db
# on Zeabur (volumes can't span services). xterio-cfo-mcp is cloned at build
# time from a private GitHub repo using a fine-grained PAT passed as a Docker
# build arg (configured in Zeabur as a build-time variable named MCP_PAT).

FROM node:20-slim

WORKDIR /app

# ---------- finance-system build (existing) ----------
COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ src/
COPY public/ public/

RUN npm run build

# ---------- xterio-cfo-mcp clone + build (new) ----------
ARG MCP_PAT
ARG MCP_REF=main
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# All in one RUN so the PAT-bearing .git/config never lands in a persisted layer.
RUN test -n "$MCP_PAT" \
      || (echo 'ERROR: build arg MCP_PAT is required (fine-grained PAT, read-only on doggychip/xterio-cfo-mcp). In Zeabur, add it as a build-time variable.' >&2 && exit 1) \
 && git clone --depth 1 --branch "$MCP_REF" \
      "https://x-access-token:${MCP_PAT}@github.com/doggychip/xterio-cfo-mcp.git" /app/mcp \
 && cd /app/mcp \
 && npm ci \
 && npm run build \
 && npm prune --omit=dev \
 && rm -rf .git /root/.npm /tmp/*

# ---------- runtime ----------
COPY start.sh ./
RUN chmod +x start.sh

ENV NODE_ENV=production
ENV PORT=8080
ENV MCP_PORT=3000

EXPOSE 8080 3000

CMD ["./start.sh"]
