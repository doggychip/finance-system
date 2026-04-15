import { Router } from 'express';
import Database from 'better-sqlite3';

export function historicalCashRoutes(db: Database.Database): Router {
  const router = Router();

  router.get('/weekly', (_req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM historical_cash_weekly ORDER BY snapshot_date ASC').all();
      res.json(rows);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  router.get('/monthly-bs', (_req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM historical_bs_monthly ORDER BY month_end ASC').all();
      res.json(rows);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  router.get('/pl', (_req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM historical_pl_monthly ORDER BY month_start ASC').all() as any[];
      const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
      const totalExpenses = rows.reduce((s, r) => s + r.expenses, 0);
      const totalNetProfit = rows.reduce((s, r) => s + r.net_profit, 0);
      res.json({
        monthly: rows,
        annual: { total_revenue: totalRevenue, total_expenses: totalExpenses, total_net_profit: totalNetProfit },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  router.get('/deposits', (_req, res) => {
    try {
      const fiat = db.prepare('SELECT * FROM historical_fiat_deposits ORDER BY snapshot_date DESC LIMIT 1').get();
      const crypto = db.prepare('SELECT * FROM historical_crypto_deposits ORDER BY snapshot_date DESC LIMIT 1').get();
      res.json({ fiat, crypto });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  router.get('/summary', (_req, res) => {
    try {
      const weekly = db.prepare('SELECT * FROM historical_cash_weekly ORDER BY snapshot_date ASC').all() as any[];
      const monthlyBs = db.prepare('SELECT * FROM historical_bs_monthly ORDER BY month_end ASC').all();
      const plRows = db.prepare('SELECT * FROM historical_pl_monthly ORDER BY month_start ASC').all() as any[];
      const fiat = db.prepare('SELECT * FROM historical_fiat_deposits ORDER BY snapshot_date DESC LIMIT 1').get() as any;
      const crypto = db.prepare('SELECT * FROM historical_crypto_deposits ORDER BY snapshot_date DESC LIMIT 1').get() as any;

      const totalRevenue = plRows.reduce((s, r) => s + r.revenue, 0);
      const totalExpenses = plRows.reduce((s, r) => s + r.expenses, 0);
      const totalNetProfit = plRows.reduce((s, r) => s + r.net_profit, 0);

      const current = weekly.length > 0 ? weekly[weekly.length - 1] : null;
      const previous = weekly.length > 1 ? weekly[weekly.length - 2] : null;
      const peakTotal = weekly.reduce((max, r) => Math.max(max, r.grand_total), 0);

      res.json({
        weekly,
        monthly_bs: monthlyBs,
        pl: {
          monthly: plRows,
          annual: { total_revenue: totalRevenue, total_expenses: totalExpenses, total_net_profit: totalNetProfit },
        },
        deposits: { fiat, crypto },
        kpis: {
          current_total: current ? current.grand_total : 0,
          current_date: current ? current.snapshot_date : null,
          peak_total: peakTotal,
          wow_change: current && previous ? current.grand_total - previous.grand_total : 0,
          from_peak: current ? current.grand_total - peakTotal : 0,
          fiat_total: fiat ? fiat.fiat_total : 0,
          crypto_total: crypto ? crypto.total_fixed : 0,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
