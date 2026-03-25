import { Router } from 'express';
import Database from 'better-sqlite3';
import {
  runFullSync,
  runAccountSync,
  runJournalSync,
  runInvoiceSync,
  startSyncScheduler,
  stopSyncScheduler,
} from '../odoo/sync-orchestrator';

export function syncRoutes(db: Database.Database): Router {
  const router = Router();

  // Full sync — pulls everything from Odoo
  router.post('/full', async (_req, res) => {
    try {
      const result = await runFullSync(db, {
        dateFrom: _req.body.date_from,
        dateTo: _req.body.date_to,
        limit: _req.body.limit,
      });
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Sync only accounts
  router.post('/accounts', async (_req, res) => {
    try {
      const result = await runAccountSync(db);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Sync only journal entries
  router.post('/journal', async (req, res) => {
    try {
      const result = await runJournalSync(db, {
        dateFrom: req.body.date_from,
        dateTo: req.body.date_to,
        limit: req.body.limit,
      });
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Sync only invoices & payments
  router.post('/invoices', async (req, res) => {
    try {
      const result = await runInvoiceSync(db, {
        dateFrom: req.body.date_from,
        dateTo: req.body.date_to,
        limit: req.body.limit,
      });
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Scheduler control
  router.post('/scheduler/start', (req, res) => {
    const interval = req.body.interval_minutes || 30;
    startSyncScheduler(db, interval);
    res.json({ status: 'started', interval_minutes: interval });
  });

  router.post('/scheduler/stop', (_req, res) => {
    stopSyncScheduler();
    res.json({ status: 'stopped' });
  });

  // Sync log
  router.get('/log', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = db.prepare(
      'SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?'
    ).all(limit);
    res.json(logs);
  });

  // Connection test
  router.get('/test', async (_req, res) => {
    try {
      const { createOdooClient } = await import('../odoo/client');
      const odoo = createOdooClient();
      const version = await odoo.version();
      const uid = await odoo.authenticate();
      res.json({
        status: 'connected',
        odoo_version: version.server_version,
        uid,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ status: 'error', error: message });
    }
  });

  return router;
}
