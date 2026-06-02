import 'dotenv/config';
import express from 'express';
import path from 'path';
import { initDb } from './db';
import { accountRoutes } from './routes/accounts';
import { journalRoutes } from './routes/journal';
import { reportRoutes } from './routes/reports';
import { syncRoutes } from './routes/sync';
import { invoiceRoutes } from './routes/invoices';
import { dashboardRoutes } from './routes/dashboard';
import { reportingRoutes } from './routes/reporting';
import { chatRoutes } from './routes/chat';
import { taskRoutes } from './routes/tasks';
import { alertsTasksRoutes } from './routes/alerts-tasks';
import { startSyncScheduler } from './odoo/sync-orchestrator';
import { seedXterioFoundation } from './data/xterio-seed';
import { seedKeystoneFoundation } from './data/keystone-seed';
import { seedFoundationIC } from './data/foundation-ic-seed';
import { migrateHistoricalCash } from './db/migrate-historical-cash';
import { seedHistoricalCash } from './db/seed-historical-cash';
import { historicalCashRoutes } from './routes/historical-cash';
import { mountMcp } from './mcp/mount';
import { createOAuthProvider } from './mcp/oauth';

const app = express();

// Health check before any middleware
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// OAuth 2.1 authorization server for /mcp (claude.ai web + native Desktop/Code
// connectors, which can't use static bearer tokens). Mounted BEFORE Basic auth
// so /authorize, /token, /register, /.well-known/* and the login page are
// reachable without the dashboard password. /mcp itself accepts OAuth tokens OR
// the static MCP_BEARER_TOKENS during migration (see mountMcp below).
const oauth = createOAuthProvider((m) => console.log(`[oauth] ${new Date().toISOString()} ${m}`));
app.use(
  oauth.mcpAuthRouter({
    provider: oauth.provider,
    issuerUrl: oauth.issuerUrl,
    resourceServerUrl: oauth.resourceUrl,
    scopesSupported: ['mcp'],
    resourceName: 'Xterio Finance MCP',
    // The SDK's default DCR limit is 20/hour, and since we don't set Express
    // "trust proxy", express-rate-limit keys every request on the single Zeabur
    // ingress IP — making it effectively GLOBAL. That let claude.ai's connect
    // attempts hit 429 ("Couldn't register"). Raise it; registration is harmless
    // here (every client is still gated by the shared-password /authorize login).
    clientRegistrationOptions: {
      rateLimit: { windowMs: 60 * 60 * 1000, max: 200 },
    },
  })
);
app.post('/oauth/login', express.urlencoded({ extended: false }), oauth.loginHandler);

// Basic auth protection (set AUTH_USER and AUTH_PASS env vars to enable).
// Probe endpoints (/health, /mcp/health) are exempt so uptime monitors don't 401.
const authUser = process.env.AUTH_USER;
const authPass = process.env.AUTH_PASS;
if (authUser && authPass) {
  app.use((req, res, next) => {
    // /health + the MCP surface are exempt from Basic auth: probes don't 401,
    // and /mcp is gated by its own bearer-token check (see mountMcp). OAuth
    // discovery paths are exempt too so MCP clients get a clean JSON 404 there
    // (not the Basic-auth HTML), avoiding a misleading client-side OAuth error.
    if (
      req.path === '/health' ||
      req.path === '/mcp' ||
      req.path.startsWith('/mcp/') ||
      req.path.startsWith('/.well-known/') ||
      req.path === '/register'
    ) {
      return next();
    }
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Finance Dashboard"');
      return res.status(401).send('Authentication required');
    }
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === authUser && pass === authPass) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Finance Dashboard"');
    res.status(401).send('Invalid credentials');
  });
}

app.use(express.json());

// Serve dashboard — check dist/public (production) and public/ (dev)
// Disable caching for HTML files
const publicDir = path.join(__dirname, 'public');
const devPublicDir = path.join(process.cwd(), 'public');
const staticOpts = { etag: false, lastModified: false, setHeaders: (res: any) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); res.setHeader('Pragma', 'no-cache'); } };
app.use(express.static(publicDir, staticOpts));
app.use(express.static(devPublicDir, staticOpts));

// Use persistent volume path in production, local file in dev
const dbPath = process.env.DB_PATH || 'finance.db';
const db = initDb(dbPath);
seedXterioFoundation(db);
seedKeystoneFoundation(db);
seedFoundationIC(db);
migrateHistoricalCash(db);
seedHistoricalCash(db);

app.use('/api/accounts', accountRoutes(db));
app.use('/api/journal', journalRoutes(db));
app.use('/api/reports', reportRoutes(db));
app.use('/api/sync', syncRoutes(db));
app.use('/api/invoices', invoiceRoutes(db));
app.use('/api/dashboard', dashboardRoutes(db));
app.use('/api/reporting', reportingRoutes(db));
app.use('/api/chat', chatRoutes(db));
app.use('/api/tasks', taskRoutes(db));
app.use('/api/alerts-tasks', alertsTasksRoutes(db));
app.use('/api/historical-cash', historicalCashRoutes(db));

mountMcp(app, {
  dbPath,
  verifyOAuthToken: (t) => oauth.provider.verifyAccessToken(t),
  resourceMetadataUrl: oauth.resourceMetadataUrl,
});

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Finance system running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);

  // Auto-start sync scheduler if Odoo is configured
  if (process.env.ODOO_URL && process.env.ODOO_DB) {
    const interval = parseInt(process.env.ODOO_SYNC_INTERVAL || '30');
    startSyncScheduler(db, interval);
  }
});

export { app };
