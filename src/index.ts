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
import { startSyncScheduler } from './odoo/sync-orchestrator';

const app = express();

// Health check before any middleware
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(express.json());

// Serve dashboard
app.use(express.static(path.join(process.cwd(), 'public')));

const db = initDb();

app.use('/api/accounts', accountRoutes(db));
app.use('/api/journal', journalRoutes(db));
app.use('/api/reports', reportRoutes(db));
app.use('/api/sync', syncRoutes(db));
app.use('/api/invoices', invoiceRoutes(db));
app.use('/api/dashboard', dashboardRoutes(db));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Finance system running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);

  // Auto-start sync scheduler if Odoo is configured
  if (process.env.ODOO_URL && process.env.ODOO_DB) {
    const interval = parseInt(process.env.ODOO_SYNC_INTERVAL || '30');
    startSyncScheduler(db, interval);
  }
});

export { app };
