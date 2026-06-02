/**
 * OAuth 2.1 authorization server for the in-process MCP endpoint.
 *
 * Lets OAuth-only clients (claude.ai web, and the native connectors in Claude
 * Desktop / Claude Code) authenticate to /mcp — which static bearer tokens can't
 * do. Built on the MCP SDK's auth framework (mcpAuthRouter + OAuthServerProvider
 * + requireBearerAuth), so we don't hand-roll the protocol.
 *
 * Identity model (per CFO decision): a single SHARED PASSWORD entered at the
 * login screen (OAUTH_SHARED_PASSWORD). PKCE is required. Tokens are opaque,
 * stored hashed in a dedicated oauth.db so they're revocable and survive
 * redeploys.
 *
 * Loaded via require() like mount.ts/tools.ts to dodge the SDK's "./*" exports
 * wildcard doubling the dist/cjs prefix.
 */
import path from 'path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/* eslint-disable @typescript-eslint/no-require-imports */
const _sdkCjsDir = path.dirname(path.dirname(require.resolve('@modelcontextprotocol/sdk/server')));
const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require(
  path.join(_sdkCjsDir, 'server/auth/router.js')
) as {
  mcpAuthRouter: (opts: unknown) => express.RequestHandler;
  getOAuthProtectedResourceMetadataUrl: (serverUrl: URL) => string;
};
const { requireBearerAuth } = require(
  path.join(_sdkCjsDir, 'server/auth/middleware/bearerAuth.js')
) as { requireBearerAuth: (opts: unknown) => express.RequestHandler };
/* eslint-enable @typescript-eslint/no-require-imports */

// ---- Shapes we hand back to the SDK (matching its Zod schemas) -------------
interface ClientInfo {
  client_id: string;
  client_id_issued_at?: number;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  scope?: string;
  [k: string]: unknown;
}
interface OAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
}

const ACCESS_TTL_SEC = 60 * 60; // 1h
const CODE_TTL_SEC = 5 * 60; // 5m
const now = () => Math.floor(Date.now() / 1000);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const rand = () => randomBytes(32).toString('base64url');

function constantEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function openOAuthDb(): Database.Database {
  const p = process.env.OAUTH_DB ?? path.join(dirname(process.env.DB_PATH ?? 'finance.db'), 'oauth.db');
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      issued_at INTEGER NOT NULL,
      raw       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code           TEXT PRIMARY KEY,
      client_id      TEXT NOT NULL,
      redirect_uri   TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      scopes         TEXT,
      resource       TEXT,
      expires_at     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      access_hash   TEXT PRIMARY KEY,
      refresh_hash  TEXT,
      client_id     TEXT NOT NULL,
      scopes        TEXT,
      resource      TEXT,
      expires_at    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      revoked_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_refresh ON oauth_tokens(refresh_hash);
  `);
  return db;
}

type Log = (m: string) => void;

/**
 * Build the OAuthServerProvider + the helpers index.ts needs to wire it up.
 */
export function createOAuthProvider(log: Log) {
  const db = openOAuthDb();
  const sharedPassword = process.env.OAUTH_SHARED_PASSWORD ?? '';
  if (!sharedPassword) {
    log('WARN: OAUTH_SHARED_PASSWORD is empty — OAuth login will reject everyone (fail closed)');
  }

  const clientsStore = {
    getClient(clientId: string): ClientInfo | undefined {
      const row = db.prepare(`SELECT raw FROM oauth_clients WHERE client_id = ?`).get(clientId) as
        | { raw: string }
        | undefined;
      return row ? (JSON.parse(row.raw) as ClientInfo) : undefined;
    },
    registerClient(client: Record<string, unknown>): ClientInfo {
      const issuedAt = now();
      const full = {
        ...client,
        client_id: `cl_${rand()}`,
        client_id_issued_at: issuedAt,
      } as ClientInfo;
      db.prepare(`INSERT INTO oauth_clients (client_id, issued_at, raw) VALUES (?, ?, ?)`).run(
        full.client_id,
        issuedAt,
        JSON.stringify(full)
      );
      log(`registered OAuth client ${full.client_id} (${String(client.client_name ?? 'unnamed')})`);
      return full;
    },
  };

  // Renders the shared-password page. Used both when the SDK begins authorization
  // (authorize) and to re-prompt on a wrong password (loginHandler), preserving
  // the OAuth params as hidden fields so the flow can continue.
  function renderLogin(
    res: Response,
    f: { clientId: string; redirectUri: string; codeChallenge: string; state: string; scopes: string; resource: string; error?: boolean }
  ): void {
    const hidden = (name: string, value: string) =>
      `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Connection', 'close');
    res.send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Xterio Finance — Sign in</title>
<style>body{font:16px -apple-system,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1e293b;padding:32px;border-radius:12px;width:320px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{font-size:18px;margin:0 0 4px}p{color:#94a3b8;font-size:13px;margin:0 0 20px}
input[type=password]{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;margin-bottom:16px}
button{width:100%;padding:10px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer}
.err{color:#f87171;font-size:13px;margin-bottom:12px}</style></head>
<body><form class="card" method="POST" action="/oauth/login">
<h1>Xterio Finance MCP</h1><p>Enter the access password to connect.</p>
${f.error ? '<div class="err">Incorrect password. Try again.</div>' : ''}
<input type="password" name="password" placeholder="Password" autofocus required>
${hidden('client_id', f.clientId)}
${hidden('redirect_uri', f.redirectUri)}
${hidden('code_challenge', f.codeChallenge)}
${hidden('state', f.state)}
${hidden('scopes', f.scopes)}
${hidden('resource', f.resource)}
<button type="submit">Sign in</button></form></body></html>`);
  }

  // The SDK's authorize handler validates redirect_uri against the client, then
  // calls this. We render the password page; the form POSTs to /oauth/login.
  async function authorize(
    client: ClientInfo,
    params: { state?: string; scopes?: string[]; codeChallenge: string; redirectUri: string; resource?: URL },
    res: Response
  ): Promise<void> {
    renderLogin(res, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? '',
      scopes: (params.scopes ?? []).join(' '),
      resource: params.resource?.toString() ?? '',
    });
  }

  // Mounted by index.ts. Verifies the shared password, mints a one-time code,
  // redirects back to the client. Re-validates redirect_uri to prevent open redirect.
  function loginHandler(req: Request, res: Response): void {
    const { password, client_id, redirect_uri, code_challenge, state, scopes, resource } =
      req.body as Record<string, string>;
    const client = clientsStore.getClient(client_id);
    if (!client || !redirect_uri || !client.redirect_uris.includes(redirect_uri) || !code_challenge) {
      res.status(400).send('Invalid client or redirect_uri.');
      return;
    }
    if (!sharedPassword || !password || !constantEq(password, sharedPassword)) {
      renderLogin(res, {
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        state: state ?? '',
        scopes: scopes ?? '',
        resource: resource ?? '',
        error: true,
      });
      return;
    }
    const code = `ac_${rand()}`;
    db.prepare(
      `INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, scopes, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      code,
      client_id,
      redirect_uri,
      code_challenge,
      scopes || null,
      resource || null,
      now() + CODE_TTL_SEC
    );
    const redirect = new URL(redirect_uri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);
    res.setHeader('Connection', 'close');
    res.redirect(redirect.toString());
  }

  async function challengeForAuthorizationCode(_client: ClientInfo, code: string): Promise<string> {
    const row = db.prepare(`SELECT code_challenge, expires_at FROM oauth_codes WHERE code = ?`).get(code) as
      | { code_challenge: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at < now()) throw new Error('invalid_grant');
    return row.code_challenge;
  }

  function issueTokens(clientId: string, scopes: string[], resource: string | null): OAuthTokens {
    const access = `at_${rand()}`;
    const refresh = `rt_${rand()}`;
    db.prepare(
      `INSERT INTO oauth_tokens (access_hash, refresh_hash, client_id, scopes, resource, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sha(access), sha(refresh), clientId, scopes.join(' '), resource, now() + ACCESS_TTL_SEC, now());
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: ACCESS_TTL_SEC,
      refresh_token: refresh,
      scope: scopes.join(' ') || undefined,
    };
  }

  async function exchangeAuthorizationCode(
    client: ClientInfo,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const row = db
      .prepare(`SELECT client_id, redirect_uri, scopes, resource, expires_at FROM oauth_codes WHERE code = ?`)
      .get(code) as
      | { client_id: string; redirect_uri: string; scopes: string | null; resource: string | null; expires_at: number }
      | undefined;
    if (!row || row.expires_at < now() || row.client_id !== client.client_id) throw new Error('invalid_grant');
    if (redirectUri && redirectUri !== row.redirect_uri) throw new Error('invalid_grant');
    db.prepare(`DELETE FROM oauth_codes WHERE code = ?`).run(code); // one-time use
    return issueTokens(client.client_id, row.scopes ? row.scopes.split(' ') : [], row.resource);
  }

  async function exchangeRefreshToken(
    client: ClientInfo,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const row = db
      .prepare(`SELECT client_id, scopes, resource FROM oauth_tokens WHERE refresh_hash = ? AND revoked_at IS NULL`)
      .get(sha(refreshToken)) as { client_id: string; scopes: string | null; resource: string | null } | undefined;
    if (!row || row.client_id !== client.client_id) throw new Error('invalid_grant');
    return issueTokens(client.client_id, scopes ?? (row.scopes ? row.scopes.split(' ') : []), row.resource);
  }

  async function verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = db
      .prepare(`SELECT client_id, scopes, expires_at, revoked_at FROM oauth_tokens WHERE access_hash = ?`)
      .get(sha(token)) as
      | { client_id: string; scopes: string | null; expires_at: number; revoked_at: number | null }
      | undefined;
    if (!row || row.revoked_at || row.expires_at < now()) throw new Error('invalid_token');
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes ? row.scopes.split(' ') : [],
      expiresAt: row.expires_at,
    };
  }

  async function revokeToken(
    _client: ClientInfo,
    request: { token: string }
  ): Promise<void> {
    const h = sha(request.token);
    db.prepare(`UPDATE oauth_tokens SET revoked_at = ? WHERE access_hash = ? OR refresh_hash = ?`).run(now(), h, h);
  }

  const provider = {
    clientsStore,
    authorize,
    challengeForAuthorizationCode,
    exchangeAuthorizationCode,
    exchangeRefreshToken,
    verifyAccessToken,
    revokeToken,
  };

  const issuerUrl = new URL(publicBaseUrl());
  const resourceUrl = new URL(publicBaseUrl().replace(/\/$/, '') + '/mcp');
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);

  return {
    provider,
    loginHandler,
    requireBearerAuth,
    mcpAuthRouter,
    issuerUrl,
    resourceUrl,
    resourceMetadataUrl,
  };
}

function publicBaseUrl(): string {
  return process.env.OAUTH_ISSUER_URL ?? 'https://xter-finance.zeabur.app';
}
export { publicBaseUrl };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
