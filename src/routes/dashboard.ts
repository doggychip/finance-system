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
