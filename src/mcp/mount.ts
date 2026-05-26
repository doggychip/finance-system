import path from 'path';
import express, { type Express, type Request, type Response } from 'express';
import { buildServer } from './tools';
import { healthProbe, dbPath, setDbPath } from './db';

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

  // Route-level JSON parser so this works regardless of the app's global middleware setup.
  const json = express.json({ limit: '4mb' });

  app.post('/mcp', json, async (req: Request, res: Response) => {
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
}
