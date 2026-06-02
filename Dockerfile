# syntax=docker/dockerfile:1.7
#
# Single Zeabur service, single Node process: finance-system serves the
# dashboard, the Odoo sync scheduler, AND the read-only MCP endpoint at /mcp
# (mounted in-process via src/mcp/mount.ts — bearer-auth gated). Binds $PORT
# (default 8080). No separate MCP process / clone is needed anymore.

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ src/
COPY public/ public/

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
