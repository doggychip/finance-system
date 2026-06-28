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

  // Monthly Balance Sheet — aggregated from tb_snapshots
  router.get('/monthly-bs', (_req, res) => {
        try {
                const rows = db.prepare(`
                        SELECT
                                  period,
                                            SUM(CASE WHEN account_type LIKE 'asset%' THEN balance ELSE 0 END)     AS total_assets,
                                                      SUM(CASE WHEN account_type LIKE 'liability%' THEN balance ELSE 0 END)  AS total_liabilities,
                                                                SUM(CASE WHEN account_type IN ('equity','equity_unaffected') THEN balance ELSE 0 END) AS total_equity,
                                                                          SUM(CASE WHEN account_type LIKE 'asset_cash%' OR account_type = 'asset_cash' THEN balance ELSE 0 END) AS cash_and_bank,
                                                                                    SUM(CASE WHEN account_type = 'asset_receivable' THEN balance ELSE 0 END) AS receivables,
                                                                                              SUM(CASE WHEN account_type = 'liability_payable' THEN balance ELSE 0 END) AS payables,
                                                                                                        SUM(CASE WHEN account_type IN ('liability_current','liability_credit_card') THEN balance ELSE 0 END) AS current_liabilities
                                                                                                                FROM tb_snapshots
                                                                                                                        GROUP BY period
                                                                                                                                ORDER BY period ASC
                                                                                                                                      `).all();
                res.json(rows);
        } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                res.status(500).json({ error: message });
        }
  });

  // Monthly P&L — aggregated from tb_snapshots
  router.get('/pl', (_req, res) => {
        try {
                const rows = db.prepare(`
                        SELECT
                                  period,
                                            SUM(CASE WHEN account_type IN ('income','income_other') THEN balance ELSE 0 END)          AS revenue,
                                                      SUM(CASE WHEN account_type IN ('expense','expense_direct_cost') THEN balance ELSE 0 END)   AS expenses,
                                                                SUM(CASE WHEN account_type IN ('income','income_other') THEN balance ELSE 0 END)
                                                                            - SUM(CASE WHEN account_type IN ('expense','expense_direct_cost') THEN balance ELSE 0 END) AS net_profit
                                                                                    FROM tb_snapshots
                                                                                            GROUP BY period
                                                                                                    ORDER BY period ASC
                                                                                                          `).all() as any[];

          const totalRevenue    = rows.reduce((s, r) => s + (r.revenue   || 0), 0);
                const totalExpenses   = rows.reduce((s, r) => s + (r.expenses  || 0), 0);
                const totalNetProfit  = rows.reduce((s, r) => s + (r.net_profit || 0), 0);

          res.json({
                    monthly: rows,
                    annual: {
                                total_revenue:    totalRevenue,
                                total_expenses:   totalExpenses,
                                total_net_profit: totalNetProfit,
                    },
          });
        } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                res.status(500).json({ error: message });
        }
  });

  router.get('/deposits', (_req, res) => {
        try {
                const fiat   = db.prepare('SELECT * FROM historical_fiat_deposits   ORDER BY snapshot_date DESC LIMIT 1').get();
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

          // Monthly BS from tb_snapshots
          const monthlyBs = db.prepare(`
                  SELECT
                            period,
                                      SUM(CASE WHEN account_type LIKE 'asset%' THEN balance ELSE 0 END)     AS total_assets,
                                                SUM(CASE WHEN account_type LIKE 'liability%' THEN balance ELSE 0 END)  AS total_liabilities,
                                                          SUM(CASE WHEN account_type IN ('equity','equity_unaffected') THEN balance ELSE 0 END) AS total_equity,
                                                                    SUM(CASE WHEN account_type LIKE 'asset_cash%' OR account_type = 'asset_cash' THEN balance ELSE 0 END) AS cash_and_bank,
                                                                              SUM(CASE WHEN account_type = 'asset_receivable' THEN balance ELSE 0 END) AS receivables,
                                                                                        SUM(CASE WHEN account_type = 'liability_payable' THEN balance ELSE 0 END) AS payables,
                                                                                                  SUM(CASE WHEN account_type IN ('liability_current','liability_credit_card') THEN balance ELSE 0 END) AS current_liabilities
                                                                                                          FROM tb_snapshots
                                                                                                                  GROUP BY period
                                                                                                                          ORDER BY period ASC
                                                                                                                                `).all();

          // Monthly P&L from tb_snapshots
          const plRows = db.prepare(`
                  SELECT
                            period,
                                      SUM(CASE WHEN account_type IN ('income','income_other') THEN balance ELSE 0 END)          AS revenue,
                                                SUM(CASE WHEN account_type IN ('expense','expense_direct_cost') THEN balance ELSE 0 END)   AS expenses,
                                                          SUM(CASE WHEN account_type IN ('income','income_other') THEN balance ELSE 0 END)
                                                                      - SUM(CASE WHEN account_type IN ('expense','expense_direct_cost') THEN balance ELSE 0 END) AS net_profit
                                                                              FROM tb_snapshots
                                                                                      GROUP BY period
                                                                                              ORDER BY period ASC
                                                                                                    `).all() as any[];

          const fiat   = db.prepare('SELECT * FROM historical_fiat_deposits   ORDER BY snapshot_date DESC LIMIT 1').get() as any;
                const crypto = db.prepare('SELECT * FROM historical_crypto_deposits ORDER BY snapshot_date DESC LIMIT 1').get() as any;

          const totalRevenue   = plRows.reduce((s, r) => s + (r.revenue   || 0), 0);
                const totalExpenses  = plRows.reduce((s, r) => s + (r.expenses  || 0), 0);
                const totalNetProfit = plRows.reduce((s, r) => s + (r.net_profit || 0), 0);

          const current  = weekly.length > 0 ? weekly[weekly.length - 1] : null;
                const previous = weekly.length > 1 ? weekly[weekly.length - 2] : null;
                const peakTotal = weekly.reduce((max, r) => Math.max(max, r.grand_total), 0);

          res.json({
                    weekly,
                    monthly_bs: monthlyBs,
                    pl: {
                                monthly: plRows,
                                annual: {
                                              total_revenue:    totalRevenue,
                                              total_expenses:   totalExpenses,
                                              total_net_profit: totalNetProfit,
                                },
                    },
                    deposits: { fiat, crypto },
                    kpis: {
                                current_total: current  ? current.grand_total  : 0,
                                current_date:  current  ? current.snapshot_date : null,
                                peak_total:    peakTotal,
                                wow_change:    current && previous ? current.grand_total - previous.grand_total : 0,
                                from_peak:     current  ? current.grand_total - peakTotal : 0,
                                fiat_total:    fiat     ? fiat.fiat_total   : 0,
                                crypto_total:  crypto   ? crypto.total_fixed : 0,
                    },
          });
        } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                res.status(500).json({ error: message });
        }
  });

  return router;
}
