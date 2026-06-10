import { Router } from 'express';
import Database from 'better-sqlite3';
import { syncBalances } from '../odoo/sync-balances';
import { createOdooClient } from '../odoo/client';
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

  // Full sync â pulls everything from Odoo
  router.post('/full', async (_req, res) => {
    _req.socket.setTimeout(300000); // 5 minutes
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
    req.socket.setTimeout(900000); // 15 minutes
    try {
      const result = await runJournalSync(db, {
        dateFrom: req.body.date_from,
        dateTo: req.body.date_to,
        limit: req.body.limit,
        offset: req.body.offset,
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
      console.log('[sync/test] Fetching Odoo version...');
      const version = await odoo.version();
      console.log('[sync/test] Odoo version:', version.server_version);
      console.log('[sync/test] Authenticating...');
      const uid = await odoo.authenticate();
      console.log('[sync/test] Authenticated, UID:', uid);
      res.json({
        status: 'connected',
        odoo_version: version.server_version,
        uid,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[sync/test] Error:', message);
      res.status(500).json({ status: 'error', error: message });
    }
  });

  // Sync account balances using Odoo data as of today (journal line aggregation)
  router.post('/balances', async (_req, res) => {
    try {
      const odoo = createOdooClient();
      await odoo.authenticate();
      const result = await syncBalances(odoo, db, new Date().toISOString().slice(0, 10));
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Sync balances for a specific historical date (Odoo data date)
  router.post('/balances/historical', async (req, res) => {
    try {
      const asOfDate = req.body.as_of_date;
      if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
        return res.status(400).json({ error: 'as_of_date required (YYYY-MM-DD)' });
      }
      // Reject far-future dates â sentinel values like 9999-01-01 caused
      // Odoo to return aggregate-since-beginning data that polluted snapshots.
      const maxFuture = new Date();
      maxFuture.setDate(maxFuture.getDate() + 30);
      if (new Date(asOfDate) > maxFuture) {
        return res.status(400).json({ error: 'as_of_date too far in the future' });
      }
      const odoo = createOdooClient();
      await odoo.authenticate();
      const result = await syncBalances(odoo, db, asOfDate);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  
// List all companies from Odoo (res.company)
router.get('/companies', async (_req, res) => {
  try {
    const odoo = createOdooClient();
    await odoo.authenticate();
    const companies = await odoo.searchRead(
      'res.company',
      [],
      ['id', 'name'],
      { order: 'id asc', limit: 200 }
    );
    res.json(companies);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

    // Clear all account_balances (full wipe for re-import)
    router.delete('/clear-snapshots', (_req, res) => {
          try {
                  const result = db.prepare('DELETE FROM account_balances').run();
                  res.json({ deleted: result.changes });
          } catch (err: unknown) {
                  const message = err instanceof Error ? err.message : 'Unknown error';
                  res.status(500).json({ error: message });
          }
    });

    // Import TB rows from external source (bulk insert/replace)
    router.post('/import-tb', (req, res) => {
          try {
                  const rows: Array<{
                            company_id: number;
                            company_name: string;
                            account_code: string;
                            account_name: string;
                            account_type: string;
                            currency: string;
                            balance: number;
                            snapshot_date: string;
                  }> = req.body;
                  if (!Array.isArray(rows)) {
                            return res.status(400).json({ error: 'Body must be an array of TB rows' });
                  }
                  const stmt = db.prepare(`
                          INSERT OR REPLACE INTO account_balances
                                    (company_id, company_name, account_code, account_name, account_type, currency, balance, snapshot_date)
                                            VALUES
                                                      (@company_id, @company_name, @account_code, @account_name, @account_type, @currency, @balance, @snapshot_date)
                                                            `);
                  const insertMany = db.transaction((items: typeof rows) => {
                            for (const row of items) stmt.run(row);
                  });
                  insertMany(rows);
                  res.json({ inserted: rows.length });
          } catch (err: unknown) {
                  const message = err instanceof Error ? err.message : 'Unknown error';
                  res.status(500).json({ error: message });
          }
    });

return router;
}
