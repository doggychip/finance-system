import path from 'path';
import { timingSafeEqual } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { buildServer } from './tools';
import { healthProbe, dbPath, setDbPath } from './db';
import { computeFreshness } from './freshness';

/** Short git SHA of the running build (Zeabur injects it), for /healthz. Best-effort. */
const GIT_SHA: string | null =
  (process.env.ZEABUR_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? process.env.SOURCE_COMMIT)?.slice(
    0,
    12
  ) ?? null;

/*
 * Same reason as tools.ts: load via require() to avoid TypeScript's
 * infinite type instantiation on the SDK's Zod-compat generics, AND to
 * bypass the "./*" exports wildcard that doubles the dist/cjs prefix.
 */
interface Transport {
  close(): void | Promise<void>;
  handleRequest(req: Request, res: Response, body?: unknown): Promise<void>;
}
/* eslint-disable @typescript-eslint/no-require-imports */
// Use explicit "./server" export (physically exists at dist/cjs/server/index.js).
// The "." export points to dist/cjs/index.js which does NOT exist in the package.
// Two dirname() calls: dist/cjs/server/index.js → dist/cjs/server/ → dist/cjs/
const _sdkCjsDir = path.dirname(path.dirname(require.resolve('@modelcontextprotocol/sdk/server')));
const { StreamableHTTPServerTransport: StreamableHTTPServerTransportClass } = require(
  path.join(_sdkCjsDir, 'server/streamableHttp.js')
) as {
  StreamableHTTPServerTransport: new (opts: {
    sessionIdGenerator: undefined;
    enableJsonResponse: boolean;
  }) => Transport;
};
/* eslint-enable @typescript-eslint/no-require-imports */

interface MountOptions {
  /** Path to finance.db. If given, overrides the DB_PATH env var. */
  dbPath?: string;
  /** Logger; defaults to console.log with an [mcp] prefix. */
  log?: (msg: string) => void;
  /**
   * Optional OAuth access-token verifier. When provided, /mcp accepts EITHER a
   * static MCP_BEARER_TOKENS token OR a valid OAuth token (verified here), so
   * the two coexist during migration. Rejecting (throw) = invalid token.
   */
  verifyOAuthToken?: (token: string) => Promise<unknown>;
  /** OAuth protected-resource metadata URL, advertised in 401 WWW-Authenticate. */
  resourceMetadataUrl?: string;
}

/**
 * Attach the MCP endpoint to the existing Express app.
 *
 * Call once, after the app is created and before app.listen():
 *
 *   import { mountMcp } from './mcp/mount';
 *   mountMcp(app, { dbPath: dbPath });
 *
 * Adds:
 *   POST /mcp          -> MCP streamable-HTTP endpoint (stateless)
 *   GET  /mcp          -> 405 (probe-friendly)
 *   GET  /mcp/health   -> { status, db, latest_snapshot }
 */
export function mountMcp(app: Express, opts: MountOptions = {}): void {
  const log = opts.log ?? ((m: string) => console.log(`[mcp] ${new Date().toISOString()} ${m}`));
  if (opts.dbPath) setDbPath(opts.dbPath);

  try {
    const h = healthProbe();
    log(`mounted on /mcp; DB=${dbPath()} latest snapshot=${h.latest_snapshot ?? '(none)'}`);
    if (h.latest_snapshot) {
      const ageDays = Math.floor((Date.now() - new Date(h.latest_snapshot).getTime()) / 86_400_000);
      if (ageDays > 14) log(`WARN: latest snapshot is ${ageDays} days old — snapshot writer may be stalled`);
    }
  } catch (err) {
    log(`WARN: DB probe failed at mount (route still attached): ${(err as Error).message}`);
  }

  // Bearer auth for /mcp. Tokens come from MCP_BEARER_TOKENS (comma-separated).
  // Fails closed: with no tokens configured, every /mcp request is rejected.
  const bearerTokens = (process.env.MCP_BEARER_TOKENS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (bearerTokens.length === 0) {
    log('WARN: MCP_BEARER_TOKENS is empty — /mcp will reject all requests (fail closed)');
  }
  const tokenMatches = (presented: string): boolean => {
    const a = Buffer.from(presented);
    return bearerTokens.some((t) => {
      const b = Buffer.from(t);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  };
  const wwwAuth = opts.resourceMetadataUrl
    ? `Bearer realm="xterio-cfo-mcp", resource_metadata="${opts.resourceMetadataUrl}"`
    : 'Bearer realm="xterio-cfo-mcp"';
  const requireBearer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const match = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '');
    const token = match?.[1].trim();
    if (token) {
      if (tokenMatches(token)) return next(); // static MCP_BEARER_TOKENS
      if (opts.verifyOAuthToken) {
        try {
          await opts.verifyOAuthToken(token); // OAuth access token
          return next();
        } catch {
          /* fall through to 401 */
        }
      }
    }
    res.setHeader('WWW-Authenticate', wwwAuth);
    res.status(401).json({ error: 'Missing or invalid bearer token' });
  };

  // Route-level JSON parser so this works regardless of the app's global middleware setup.
  const json = express.json({ limit: '4mb' });

  app.post('/mcp', requireBearer, json, async (req: Request, res: Response) => {
    // Force a fresh TCP connection per request (no HTTP/1.1 keep-alive reuse).
    // Some tunnels/proxies (e.g. mihomo TUN) silently drop idle keep-alive
    // sockets, and undici (mcp-remote's client) then reuses the dead socket and
    // fails the follow-up request with "other side closed". Connection: close
    // makes the client open a new connection each time, which survives the tunnel.
    res.setHeader('Connection', 'close');
    const server = buildServer();
    const transport = new StreamableHTTPServerTransportClass({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body as unknown);
    } catch (err) {
      log(`request error: ${(err as Error).message}`);
      if (!res.headersSent) res.status(500).json({ error: 'internal error' });
    }
  });

  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'Use POST for MCP requests' });
  });

  app.get('/mcp/health', (_req: Request, res: Response) => {
    try {
      const h = healthProbe();
      res.json({ status: 'ok', db: dbPath(), latest_snapshot: h.latest_snapshot });
    } catch (err) {
      res.status(503).json({ status: 'error', error: (err as Error).message });
    }
  });

  // Richer, unauthenticated freshness probe. Reports build identity and data
  // freshness so a monitor can alert on a stalled upstream Odoo sync (stale=true)
  // without a bearer token. Unlike /mcp/health (which reports the latest snapshot
  // date), this uses the canonical last successful data write — a failed sync
  // bumps the file mtime but must NOT clear staleness. Never throws.
  // (index.ts exempts /healthz from the dashboard Basic-auth gate.)
  app.get('/healthz', (_req: Request, res: Response) => {
    try {
      const f = computeFreshness();
      res.json({
        status: f.error ? 'degraded' : f.stale ? 'stale' : 'ok',
        git_sha: GIT_SHA,
        last_data_timestamp: f.last_data_timestamp,
        data_age_hours: f.data_age_hours,
        stale: f.stale,
        stale_threshold_hours: f.stale_threshold_hours,
      });
    } catch (err) {
      res.status(200).json({
        status: 'error',
        git_sha: GIT_SHA,
        last_data_timestamp: null,
        error: (err as Error).message,
      });
    }
  });
  // (The OAuth discovery endpoints /.well-known/oauth-* + /register are now
  //  served for real by mcpAuthRouter, mounted in index.ts.)
}
