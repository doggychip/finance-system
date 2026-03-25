import { Router } from 'express';
import Database from 'better-sqlite3';

export function dashboardRoutes(db: Database.Database): Router {
  const router = Router();

  // Overview stats
  router.get('/stats', (_req, res) => {
    const accountCount = (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE is_active = 1').get() as any).count;
    const journalCount = (db.prepare('SELECT COUNT(*) as count FROM journal_entries').get() as any).count;
    const postedCount = (db.prepare("SELECT COUNT(*) as count FROM journal_entries WHERE status = 'posted'").get() as any).count;
    const invoiceCount = (db.prepare('SELECT COUNT(*) as count FROM invoices').get() as any).count;
    const paymentCount = (db.prepare('SELECT COUNT(*) as count FROM payments').get() as any).count;

    const lastSync = db.prepare('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1').get() as any;

    res.json({
      accounts: accountCount,
      journal_entries: journalCount,
      posted_entries: postedCount,
      invoices: invoiceCount,
      payments: paymentCount,
      last_sync: lastSync || null,
    });
  });

  // Balance summary by account type
  router.get('/balances', (_req, res) => {
    const rows = db.prepare(`
      SELECT
        a.type as account_type,
        COUNT(DISTINCT a.id) as account_count,
        COALESCE(SUM(li.debit), 0) as total_debits,
        COALESCE(SUM(li.credit), 0) as total_credits,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as net_balance
      FROM accounts a
      LEFT JOIN line_items li ON li.account_id = a.id
        AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted')
      WHERE a.is_active = 1
      GROUP BY a.type
      ORDER BY a.type
    `).all();
    res.json(rows);
  });

  // Top accounts by balance
  router.get('/top-accounts', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string | undefined;

    let query = `
      SELECT
        a.id, a.name, a.code, a.type,
        COALESCE(SUM(li.debit), 0) as total_debits,
        COALESCE(SUM(li.credit), 0) as total_credits,
        ABS(COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0)) as abs_balance,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM accounts a
      LEFT JOIN line_items li ON li.account_id = a.id
        AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted')
      WHERE a.is_active = 1`;

    const params: any[] = [];
    if (type) {
      query += ' AND a.type = ?';
      params.push(type);
    }

    query += `
      GROUP BY a.id
      HAVING abs_balance > 0
      ORDER BY abs_balance DESC
      LIMIT ?`;
    params.push(limit);

    res.json(db.prepare(query).all(...params));
  });

  // Recent journal entries
  router.get('/recent-entries', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const entries = db.prepare(`
      SELECT je.*,
        (SELECT COUNT(*) FROM line_items WHERE journal_entry_id = je.id) as line_count,
        (SELECT SUM(debit) FROM line_items WHERE journal_entry_id = je.id) as total_amount
      FROM journal_entries je
      ORDER BY je.date DESC, je.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(entries);
  });

  // Monthly totals for charts
  router.get('/monthly-totals', (_req, res) => {
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', je.date) as month,
        SUM(li.debit) as total_debits,
        SUM(li.credit) as total_credits,
        COUNT(DISTINCT je.id) as entry_count
      FROM journal_entries je
      INNER JOIN line_items li ON li.journal_entry_id = je.id
      WHERE je.status = 'posted'
      GROUP BY strftime('%Y-%m', je.date)
      ORDER BY month DESC
      LIMIT 12
    `).all();
    res.json(rows.reverse());
  });

  // Cash & bank account balances
  router.get('/cash-balances', (_req, res) => {
    const rows = db.prepare(`
      SELECT
        a.id, a.name, a.code, a.odoo_type,
        COALESCE(SUM(li.debit), 0) as total_debits,
        COALESCE(SUM(li.credit), 0) as total_credits,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM accounts a
      LEFT JOIN line_items li ON li.account_id = a.id
        AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted')
      WHERE a.is_active = 1
        AND (a.odoo_type IN ('asset_cash', 'asset_current') OR a.odoo_type LIKE '%cash%' OR a.odoo_type LIKE '%bank%')
      GROUP BY a.id
      HAVING balance != 0
      ORDER BY balance DESC
    `).all();

    const totalCash = (rows as any[]).reduce((sum, r) => sum + r.balance, 0);
    res.json({ accounts: rows, total: totalCash });
  });

  // Cash balances over time — supports daily, weekly, monthly periods
  router.get('/cash-history', (req, res) => {
    const period = (req.query.period as string) || 'monthly';
    const limit = parseInt(req.query.limit as string) || 90;

    let groupExpr: string;
    let labelExpr: string;
    switch (period) {
      case 'daily':
        groupExpr = "je.date";
        labelExpr = "je.date";
        break;
      case 'weekly':
        // ISO week: group by year + week number
        groupExpr = "strftime('%Y-W%W', je.date)";
        labelExpr = "strftime('%Y-W%W', je.date)";
        break;
      case 'monthly':
      default:
        groupExpr = "strftime('%Y-%m', je.date)";
        labelExpr = "strftime('%Y-%m', je.date)";
        break;
    }

    const cashFilter = `(a.odoo_type IN ('asset_cash', 'asset_current') OR a.odoo_type LIKE '%cash%' OR a.odoo_type LIKE '%bank%')`;

    const rows = db.prepare(`
      SELECT
        ${labelExpr} as period,
        SUM(li.debit) as inflows,
        SUM(li.credit) as outflows,
        SUM(li.debit) - SUM(li.credit) as net_flow
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id AND je.status = 'posted'
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE ${cashFilter}
      GROUP BY ${groupExpr}
      ORDER BY period DESC
      LIMIT ?
    `).all(limit) as any[];

    // Calculate running balance from oldest to newest
    const reversed = rows.reverse();
    let runningBalance = 0;
    const withBalance = reversed.map(r => {
      runningBalance += r.net_flow;
      return {
        period: r.period,
        inflows: r.inflows,
        outflows: r.outflows,
        net_flow: r.net_flow,
        balance: runningBalance,
      };
    });

    res.json(withBalance);
  });

  // Per-account cash history over time
  router.get('/cash-account-history', (req, res) => {
    const period = (req.query.period as string) || 'monthly';
    const limit = parseInt(req.query.limit as string) || 90;

    let groupExpr: string;
    switch (period) {
      case 'daily': groupExpr = "je.date"; break;
      case 'weekly': groupExpr = "strftime('%Y-W%W', je.date)"; break;
      case 'monthly': default: groupExpr = "strftime('%Y-%m', je.date)"; break;
    }

    const cashFilter = `(a.odoo_type IN ('asset_cash', 'asset_current') OR a.odoo_type LIKE '%cash%' OR a.odoo_type LIKE '%bank%')`;

    const rows = db.prepare(`
      SELECT
        ${groupExpr} as period,
        a.id as account_id,
        a.name as account_name,
        a.code as account_code,
        SUM(li.debit) as inflows,
        SUM(li.credit) as outflows,
        SUM(li.debit) - SUM(li.credit) as net_flow
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id AND je.status = 'posted'
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE ${cashFilter}
      GROUP BY ${groupExpr}, a.id
      ORDER BY period DESC
      LIMIT ?
    `).all(limit * 50) as any[]; // more rows since grouped by account

    // Group by account, compute running balances
    const byAccount: Record<string, { name: string; code: string; periods: any[] }> = {};
    for (const r of rows) {
      if (!byAccount[r.account_id]) {
        byAccount[r.account_id] = { name: r.account_name, code: r.account_code, periods: [] };
      }
      byAccount[r.account_id].periods.push(r);
    }

    // Reverse and compute running balance per account
    const result = Object.entries(byAccount).map(([id, data]) => {
      const sorted = data.periods.sort((a: any, b: any) => a.period.localeCompare(b.period));
      let balance = 0;
      const periods = sorted.map((p: any) => {
        balance += p.net_flow;
        return { period: p.period, inflows: p.inflows, outflows: p.outflows, net_flow: p.net_flow, balance };
      });
      return { account_id: id, name: data.name, code: data.code, periods, current_balance: balance };
    });

    result.sort((a, b) => Math.abs(b.current_balance) - Math.abs(a.current_balance));
    res.json(result);
  });

  // Keep old endpoint for backward compat
  router.get('/cash-flow', (_req, res) => {
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', je.date) as month,
        SUM(li.debit) as inflows,
        SUM(li.credit) as outflows,
        SUM(li.debit) - SUM(li.credit) as net_flow
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id AND je.status = 'posted'
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type IN ('asset_cash', 'asset_current') OR a.odoo_type LIKE '%cash%' OR a.odoo_type LIKE '%bank%'
      GROUP BY strftime('%Y-%m', je.date)
      ORDER BY month DESC
      LIMIT 12
    `).all();

    // Calculate running balance
    let runningBalance = 0;
    const reversed = (rows as any[]).reverse();
    const withBalance = reversed.map(r => {
      runningBalance += r.net_flow;
      return { ...r, running_balance: runningBalance };
    });

    res.json(withBalance);
  });

  // Revenue vs Expenses monthly
  router.get('/revenue-vs-expenses', (_req, res) => {
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', je.date) as month,
        a.type as account_type,
        ABS(SUM(li.debit) - SUM(li.credit)) as amount
      FROM journal_entries je
      INNER JOIN line_items li ON li.journal_entry_id = je.id
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE je.status = 'posted' AND a.type IN ('revenue', 'expense')
      GROUP BY strftime('%Y-%m', je.date), a.type
      ORDER BY month DESC
      LIMIT 24
    `).all();

    // Reshape into monthly buckets
    const months: Record<string, { month: string; revenue: number; expenses: number }> = {};
    for (const row of rows as any[]) {
      if (!months[row.month]) months[row.month] = { month: row.month, revenue: 0, expenses: 0 };
      if (row.account_type === 'revenue') months[row.month].revenue = row.amount;
      if (row.account_type === 'expense') months[row.month].expenses = row.amount;
    }

    const result = Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    res.json(result);
  });

  // Sync history
  router.get('/sync-history', (_req, res) => {
    const logs = db.prepare('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 20').all();
    res.json(logs);
  });

  return router;
}
