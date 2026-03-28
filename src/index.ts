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
import { startSyncScheduler } from './odoo/sync-orchestrator';
import { seedXterioFoundation } from './data/xterio-seed';

const app = express();

// Health check before any middleware
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Basic auth protection (set AUTH_USER and AUTH_PASS env vars to enable)
const authUser = process.env.AUTH_USER;
const authPass = process.env.AUTH_PASS;
if (authUser && authPass) {
  app.use((req, res, next) => {
    if (req.path === '/health') return next();
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

app.use('/api/accounts', accountRoutes(db));
app.use('/api/journal', journalRoutes(db));
app.use('/api/reports', reportRoutes(db));
app.use('/api/sync', syncRoutes(db));
app.use('/api/invoices', invoiceRoutes(db));
app.use('/api/dashboard', dashboardRoutes(db));
app.use('/api/reporting', reportingRoutes(db));
app.use('/api/chat', chatRoutes(db));
app.use('/api/tasks', taskRoutes(db));

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
