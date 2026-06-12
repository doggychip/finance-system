import { Router } from 'express';
import Database from 'better-sqlite3';
import { createOdooClient } from '../odoo/client';
import { syncBalances } from '../odoo/sync-balances';

export function adminTbRoutes(db: Database.Database): Router {
  const router = Router();

  // Ensure tb_snapshots table exists (idempotent migration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tb_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      period          TEXT NOT NULL,
      company_id      INTEGER NOT NULL,
      company_name    TEXT NOT NULL,
      account_odoo_id INTEGER NOT NULL DEFAULT 0,
      account_code    TEXT NOT NULL,
      account_name    TEXT NOT NULL,
      account_type    TEXT NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'USD',
      balance         REAL NOT NULL DEFAULT 0,
      source          TEXT NOT NULL DEFAULT 'odoo',
      confirmed_at    TEXT,
      confirmed_by    TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(period, company_id, account_code)
    );
    CREATE INDEX IF NOT EXISTS idx_tbs_period ON tb_snapshots(period);
    CREATE INDEX IF NOT EXISTS idx_tbs_period_confirmed ON tb_snapshots(period, confirmed_at);
  `);

  // GET /api/admin/tb?period=2026-06
  router.get('/', (req, res) => {
    try {
      const period = (req.query.period as string) || new Date().toISOString().slice(0, 7);
      const rows = db.prepare(`
        SELECT id, period, company_id, company_name, account_code, account_name,
               account_type, currency, balance, source, confirmed_at, confirmed_by, updated_at
        FROM tb_snapshots WHERE period = ?
        ORDER BY company_name, account_code
      `).all(period);

      const confirmedAt = rows.length > 0 ? (rows[0] as any).confirmed_at : null;
      const status = confirmedAt ? 'confirmed' : (rows.length > 0 ? 'draft' : 'empty');
      const periods = (db.prepare(`
        SELECT DISTINCT period FROM tb_snapshots ORDER BY period DESC LIMIT 24
      `).all() as any[]).map((r: any) => r.period);

      res.json({ period, status, confirmed_at: confirmedAt, row_count: rows.length, periods, rows });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // GET /api/admin/tb/summary  – returns per-period metadata (no row detail)
  router.get('/summary', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT
          period,
          COUNT(*) AS row_count,
          MAX(updated_at) AS last_sync_at,
          MAX(confirmed_at) AS confirmed_at,
          CASE WHEN MAX(confirmed_at) IS NOT NULL THEN 'confirmed' ELSE 'draft' END AS status
        FROM tb_snapshots
        GROUP BY period
        ORDER BY period DESC
      `).all() as any[];
      res.json({ periods: rows });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });


  // POST /api/admin/tb/import  { period: '2026-06' }
  router.post('/import', async (req, res) => {
    try {
      const period = (req.body?.period as string) || new Date().toISOString().slice(0, 7);
      const [y, m] = period.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

      const odoo = createOdooClient();
      await odoo.authenticate();
      const syncResult = await syncBalances(odoo, db, lastDay);

      const rows = db.prepare(`
        SELECT company_id, company_name, account_odoo_id, account_code, account_name,
               account_type, currency, balance
        FROM account_balances WHERE snapshot_date = ?
      `).all(lastDay) as any[];

      const upsert = db.prepare(`
        INSERT INTO tb_snapshots
          (period, company_id, company_name, account_odoo_id, account_code, account_name,
           account_type, currency, balance, source, confirmed_at, confirmed_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'odoo', NULL, NULL, datetime('now'))
        ON CONFLICT(period, company_id, account_code)
        DO UPDATE SET
          account_name   = excluded.account_name,
          account_type   = excluded.account_type,
          currency       = excluded.currency,
          balance        = excluded.balance,
          source         = 'odoo',
          confirmed_at   = NULL,
          confirmed_by   = NULL,
          updated_at     = datetime('now')
      `);

      const insertMany = db.transaction((items: any[]) => {
        for (const row of items) {
          upsert.run(period, row.company_id, row.company_name, row.account_odoo_id || 0,
            row.account_code, row.account_name, row.account_type, row.currency, row.balance);
        }
      });
      insertMany(rows);

      res.json({ period, last_day: lastDay, odoo_sync: syncResult, imported: rows.length, status: 'draft' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // PATCH /api/admin/tb/confirm  { period, confirmed_by }
  router.patch('/confirm', (req, res) => {
    try {
      const period = req.body?.period as string;
      if (!period) return res.status(400).json({ error: 'period required' });
      const confirmedBy = (req.body?.confirmed_by as string) || 'admin';
      const result = db.prepare(`
        UPDATE tb_snapshots
        SET confirmed_at = datetime('now'), confirmed_by = ?, updated_at = datetime('now')
        WHERE period = ? AND confirmed_at IS NULL
      `).run(confirmedBy, period);
      if (result.changes === 0) return res.status(404).json({ error: `No draft found for period ${period}` });
      res.json({ period, confirmed_by: confirmedBy, rows_confirmed: result.changes });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // PATCH /api/admin/tb/unconfirm  { period }
  router.patch('/unconfirm', (req, res) => {
    try {
      const period = req.body?.period as string;
      if (!period) return res.status(400).json({ error: 'period required' });
      db.prepare(`
        UPDATE tb_snapshots SET confirmed_at = NULL, confirmed_by = NULL, updated_at = datetime('now')
        WHERE period = ?
      `).run(period);
      res.json({ period, status: 'draft' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/admin/tb/:id  { balance }  — manual edit, reverts to draft
  router.put('/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const balance = Number(req.body?.balance);
      if (isNaN(id) || isNaN(balance)) return res.status(400).json({ error: 'id and balance required' });
      const row = db.prepare('SELECT period FROM tb_snapshots WHERE id = ?').get(id) as any;
      if (!row) return res.status(404).json({ error: 'row not found' });
      db.prepare(`
        UPDATE tb_snapshots
        SET balance = ?, source = 'manual', confirmed_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(balance, id);
      res.json({ id, balance, period: row.period, status: 'draft' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/admin/tb/period  { period }
  router.delete('/period', (req, res) => {
    try {
      const period = req.body?.period as string;
      if (!period) return res.status(400).json({ error: 'period required' });
      const result = db.prepare('DELETE FROM tb_snapshots WHERE period = ?').run(period);
      res.json({ period, deleted: result.changes });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
