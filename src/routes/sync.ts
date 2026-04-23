import { Router } from 'express';
import Database from 'better-sqlite3';
import { syncBalances } from '../odoo/sync-balances';
import { syncHistoricalBalances } from '../odoo/sync-historical-balances';
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

  // Full sync — pulls everything from Odoo
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

  // Sync account balances — uses historical method for accurate per-company data
  // Accepts as_of_date in body OR query string
  // IMPORTANT: 2026-02-28 is protected - uses verified spreadsheet seed data only
  router.post('/balances', async (req, res) => {
    try {
      const odoo = createOdooClient();
      await odoo.authenticate();
      const asOfDate = (req.body && req.body.as_of_date) || req.query.as_of_date || new Date().toISOString().slice(0, 10);
      console.log(`[sync /balances] Syncing for as_of_date=${asOfDate}`);

      // Protected date - use seed data, don't overwrite with potentially wrong Odoo data
      if (asOfDate === '2026-02-28') {
        return res.status(400).json({
          error: '2026-02-28 is protected (uses verified spreadsheet data). Sync a different date or use /balances/force-sync to override.',
          snapshot_date: asOfDate,
        });
      }

      const result = await syncHistoricalBalances(odoo, db, asOfDate as string);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Force sync — bypasses protection for 2026-02-28 (dangerous)
  router.post('/balances/force-sync', async (req, res) => {
    try {
      const odoo = createOdooClient();
      await odoo.authenticate();
      const asOfDate = (req.body && req.body.as_of_date) || req.query.as_of_date || new Date().toISOString().slice(0, 10);
      console.log(`[sync /force-sync] FORCE syncing for as_of_date=${asOfDate}`);
      const result = await syncHistoricalBalances(odoo, db, asOfDate as string);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Sync historical balances for a specific date using Odoo's read_group
  router.post('/balances/historical', async (req, res) => {
    try {
      const asOfDate = req.body.as_of_date;
      if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
        return res.status(400).json({ error: 'as_of_date required (YYYY-MM-DD)' });
      }
      const odoo = createOdooClient();
      await odoo.authenticate();
      const result = await syncHistoricalBalances(odoo, db, asOfDate);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Direct import of balance data (bypasses Odoo API)
  // Accepts array of {company_id, company_name, account_code, account_name, account_type, balance}
  router.post('/balances/import', (req, res) => {
    try {
      const { snapshot_date, accounts } = req.body;
      if (!snapshot_date || !accounts || !Array.isArray(accounts)) {
        return res.status(400).json({ error: 'Required: snapshot_date (YYYY-MM-DD) and accounts array' });
      }

      // Delete old data for this snapshot
      db.prepare('DELETE FROM account_balances WHERE snapshot_date = ?').run(snapshot_date);

      const upsert = db.prepare(`
        INSERT INTO account_balances (company_id, company_name, account_odoo_id, account_code, account_name, account_type, balance, snapshot_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let imported = 0;
      const tx = db.transaction(() => {
        for (const a of accounts) {
          if (Math.abs(a.balance || 0) < 0.01) continue;
          upsert.run(
            a.company_id, a.company_name || '',
            a.account_odoo_id || 0, a.account_code || '', a.account_name || '', a.account_type || '',
            a.balance, snapshot_date
          );
          imported++;
        }
      });
      tx();

      res.json({ imported, snapshot_date });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // Re-sync ALL existing snapshots with the fixed per-company method
  router.post('/balances/resync-all', async (req, res) => {
    req.socket.setTimeout(600000); // 10 minutes
    try {
      const odoo = createOdooClient();
      await odoo.authenticate();

      // Get all existing snapshot dates
      const snapshots = db.prepare(
        'SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date'
      ).all() as any[];

      const results: any[] = [];
      for (const snap of snapshots) {
        console.log(`[resync-all] Re-syncing snapshot ${snap.snapshot_date}...`);
        // Delete old data for this snapshot
        db.prepare('DELETE FROM account_balances WHERE snapshot_date = ?').run(snap.snapshot_date);
        // Re-sync with corrected method
        const result = await syncHistoricalBalances(odoo, db, snap.snapshot_date);
        results.push({ date: snap.snapshot_date, ...result });
      }

      res.json({ snapshots_resynced: results.length, results });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
