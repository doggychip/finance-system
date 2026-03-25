import express from 'express';
import { initDb } from './db';
import { accountRoutes } from './routes/accounts';
import { journalRoutes } from './routes/journal';
import { reportRoutes } from './routes/reports';
import { syncRoutes } from './routes/sync';
import { invoiceRoutes } from './routes/invoices';
import { startSyncScheduler } from './odoo/sync-orchestrator';

const app = express();
app.use(express.json());

const db = initDb();

app.use('/api/accounts', accountRoutes(db));
app.use('/api/journal', journalRoutes(db));
app.use('/api/reports', reportRoutes(db));
app.use('/api/sync', syncRoutes(db));
app.use('/api/invoices', invoiceRoutes(db));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Finance system running on port ${PORT}`);

  // Auto-start sync scheduler if Odoo is configured
  if (process.env.ODOO_URL && process.env.ODOO_DB) {
    const interval = parseInt(process.env.ODOO_SYNC_INTERVAL || '30');
    startSyncScheduler(db, interval);
  }
});

export { app };
