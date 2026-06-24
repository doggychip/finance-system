import { Router } from 'express';
import Database from 'better-sqlite3';
import { ENTITY_GROUPS, BS_LINES, EntityGroup, BSLineItem } from '../config/entity-groups';

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

    // Current year net income
    const currentYear = new Date().getFullYear().toString();
    const plRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN a.odoo_type IN ('income','income_other') THEN li.credit - li.debit ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN a.odoo_type IN ('expense','expense_direct_cost') THEN li.debit - li.credit ELSE 0 END), 0) as expenses
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted' AND je.date >= ?
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type IN ('income','income_other','expense','expense_direct_cost')
    `).get(currentYear + '-01-01') as any;

    res.json({
      accounts: accountCount,
      journal_entries: journalCount,
      posted_entries: postedCount,
      invoices: invoiceCount,
      payments: paymentCount,
      last_sync: lastSync || null,
      current_year_revenue: plRow?.revenue || 0,
      current_year_expenses: plRow?.expenses || 0,
      current_year_net_income: (plRow?.revenue || 0) - (plRow?.expenses || 0),
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

  // Cash & bank account balances ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ categorized
// ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ /cash-balances ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
router.get('/cash-balances', (req, res) => {
  const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

  // JE-based: get all active cash accounts with their cumulative balances
  const rows = db.prepare(`
    SELECT
      je.company_id,
      je.company_name,
      a.code,
      a.name,
      a.odoo_type,
      COALESCE(MAX(li.currency), 'USD') as currency,
      COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
    FROM accounts a
    INNER JOIN line_items li ON li.account_id = a.id
    INNER JOIN journal_entries je ON je.id = li.journal_entry_id
      AND je.status = 'posted'
      AND je.date <= ?
    WHERE a.odoo_type = 'asset_cash' AND a.is_active = 1
    GROUP BY je.company_id, a.code, a.name, a.odoo_type
    HAVING ABS(balance) > 0.01
    ORDER BY je.company_name, a.code
  `).all(asOfDate) as any[];

  // Also get Xterio Foundation cash from manual_balances
  const foundationPeriod = (() => {
    const d = new Date(asOfDate + 'T00:00:00Z');
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  })();
  const foundationRows = db.prepare(`
    SELECT
      'Xterio Foundation' as company_name,
      22 as company_id,
      account_code as code,
      account_name as name,
      'asset_cash' as odoo_type,
      'USD' as currency,
      ROUND(SUM(amount_local * exchange_rate), 2) as balance
    FROM manual_balances
    WHERE entity = 'Xterio Foundation'
      AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
      AND period = ?
    GROUP BY account_code, account_name
    HAVING ABS(balance) > 0.01
  `).all(foundationPeriod) as any[];

  // If no data for requested period, try latest available
  let foundRows = foundationRows;
  if (!foundRows.length) {
    const latestPeriod = (db.prepare(`SELECT period FROM manual_balances WHERE entity = 'Xterio Foundation' ORDER BY period DESC LIMIT 1`).get() as any)?.period;
    if (latestPeriod) {
      foundRows = db.prepare(`
        SELECT
          'Xterio Foundation' as company_name,
          22 as company_id,
          account_code as code,
          account_name as name,
          'asset_cash' as odoo_type,
          'USD' as currency,
          ROUND(SUM(amount_local * exchange_rate), 2) as balance
        FROM manual_balances
        WHERE entity = 'Xterio Foundation'
          AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
          AND period = ?
        GROUP BY account_code, account_name
        HAVING ABS(balance) > 0.01
      `).all(latestPeriod) as any[];
    }
  }

  // Map company_id to entity group name
  const OW_IDS = new Set([15, 16]);
  const REACH_IDS = new Set([30]);
  const KEYSTONE_IDS = new Set([28]);
  const ROUGHHOUSE_IDS = new Set([31]);

  function getGroup(companyId: number): string {
    if (OW_IDS.has(companyId)) return 'OW';
    if (REACH_IDS.has(companyId)) return 'Reach';
    if (KEYSTONE_IDS.has(companyId)) return 'Keystone';
    if (ROUGHHOUSE_IDS.has(companyId)) return 'Rough house';
    return 'Xterio';
  }

  const allRows = [...rows, ...foundRows];
  const accounts = allRows.map(row => ({
    company_id: row.company_id,
    company_name: row.company_name,
    account_code: row.code,
    account_name: row.name,
    account_type: row.odoo_type,
    currency: row.currency,
    balance: row.balance,
    group: getGroup(row.company_id),
  }));

  res.json({
    as_of_date: asOfDate,
    accounts,
  });
});
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

    const cashFilter = `(a.odoo_type = 'asset_cash')`;

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

    const cashFilter = `(a.odoo_type = 'asset_cash')`;

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

  // Revenue vs Expenses monthly ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ all time
  router.get('/revenue-vs-expenses', (_req, res) => {
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', je.date) as month,
        a.odoo_type,
        SUM(li.debit) as total_debit,
        SUM(li.credit) as total_credit
      FROM journal_entries je
      INNER JOIN line_items li ON li.journal_entry_id = je.id
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE je.status = 'posted'
        AND a.odoo_type IN ('income', 'income_other', 'expense', 'expense_direct_cost')
      GROUP BY strftime('%Y-%m', je.date), a.odoo_type
      ORDER BY month ASC
    `).all() as any[];

    // Reshape into monthly buckets
    // Revenue = credit - debit on income accounts (credit-normal)
    // Expenses = debit - credit on expense accounts (debit-normal)
    const months: Record<string, { month: string; revenue: number; expenses: number }> = {};
    for (const row of rows) {
      if (!months[row.month]) months[row.month] = { month: row.month, revenue: 0, expenses: 0 };
      if (row.odoo_type === 'income' || row.odoo_type === 'income_other') {
        months[row.month].revenue += (row.total_credit - row.total_debit);
      } else if (row.odoo_type === 'expense' || row.odoo_type === 'expense_direct_cost') {
        months[row.month].expenses += (row.total_debit - row.total_credit);
      }
    }

    const result = Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
    res.json(result);
  });

  // Sync history
  router.get('/sync-history', (_req, res) => {
    const logs = db.prepare('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 20').all();
    res.json(logs);
  });

  // List of companies from journal entries
  router.get('/companies', (_req, res) => {
    const companies = db.prepare(`
      SELECT DISTINCT company_id, company_name
      FROM journal_entries
      WHERE company_id IS NOT NULL AND company_name != ''
      ORDER BY company_name
    `).all();
    res.json(companies);
  });

  // Per-company balance sheet
  router.get('/balance-sheet', (req, res) => {
    const companyId = req.query.company_id as string | undefined;

    // Odoo account type categories for balance sheet
    const categories: Record<string, string[]> = {
      'bank_cash':        ['asset_cash'],
      'receivable':       ['asset_receivable'],
      'current_assets':   ['asset_current'],
      'prepayments':      ['asset_prepayments'],
      'fixed_assets':     ['asset_fixed'],
      'non_current_assets': ['asset_non_current'],
      'current_liabilities': ['liability_current', 'liability_credit_card'],
      'payable':          ['liability_payable'],
      'non_current_liabilities': ['liability_non_current'],
      'equity':           ['equity'],
      'equity_unaffected': ['equity_unaffected'],
    };

    let companyFilter = '';
    const params: any[] = [];
    if (companyId) {
      companyFilter = 'AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)';
      params.push(parseInt(companyId));
    }

    const rows = db.prepare(`
      SELECT
        a.id, a.name, a.code, a.type, a.odoo_type,
        COALESCE(SUM(li.debit), 0) as total_debits,
        COALESCE(SUM(li.credit), 0) as total_credits,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM accounts a
      LEFT JOIN line_items li ON li.account_id = a.id
        AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted' ${companyId ? 'AND company_id = ?' : ''})
      WHERE a.is_active = 1
      GROUP BY a.id
      HAVING total_debits != 0 OR total_credits != 0
      ORDER BY a.code
    `).all(...(companyId ? [parseInt(companyId)] : [])) as any[];

    // Group accounts by category
    function categorize(accs: any[]) {
      const result: Record<string, { accounts: any[]; total: number }> = {};
      for (const [cat, types] of Object.entries(categories)) {
        const matched = accs.filter(a => types.includes(a.odoo_type));
        result[cat] = {
          accounts: matched,
          total: matched.reduce((s: number, a: any) => s + a.balance, 0),
        };
      }
      return result;
    }

    const cats = categorize(rows);

    // Compute section totals
    const totalCurrentAssets =
      cats.bank_cash.total + cats.receivable.total + cats.current_assets.total + cats.prepayments.total;
    const totalAssets = totalCurrentAssets + cats.fixed_assets.total + cats.non_current_assets.total;

    const totalCurrentLiabilities = cats.current_liabilities.total + cats.payable.total;
    const totalLiabilities = totalCurrentLiabilities + cats.non_current_liabilities.total;

    const totalEquity = cats.equity.total + cats.equity_unaffected.total;
    const liabilitiesPlusEquity = totalLiabilities + totalEquity;

    res.json({
      categories: cats,
      totals: {
        current_assets: totalCurrentAssets,
        total_assets: totalAssets,
        current_liabilities: totalCurrentLiabilities,
        total_liabilities: totalLiabilities,
        total_equity: totalEquity,
        liabilities_plus_equity: liabilitiesPlusEquity,
      },
    });
  });

  // Multi-company balance sheet summary (all companies side by side)
// ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ /balance-sheet-all ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
router.get('/balance-sheet-all', (req, res) => {
  const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

  // Get all companies
  const companies = db.prepare(`SELECT DISTINCT company_id, company_name FROM journal_entries WHERE status = 'posted' ORDER BY company_name`).all() as any[];

  if (companies.length === 0) return res.json({ as_of_date: asOfDate, companies: [] });

  const results = companies.map(company => {
    const companyId = company.company_id;
    const currentYear = new Date().getFullYear().toString();

    // All-time balances per odoo_type
    const allTimeRows = db.prepare(`
      SELECT a.odoo_type,
             COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted'
        AND je.company_id = ?
        AND je.date <= ?
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type != ''
      GROUP BY a.odoo_type
    `).all(companyId, asOfDate) as any[];

    const byTypeAll: Record<string, number> = {};
    for (const row of allTimeRows) byTypeAll[row.odoo_type] = row.balance;

    // Current year P&L types
    const cyRows = db.prepare(`
      SELECT a.odoo_type,
             COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted'
        AND je.company_id = ?
        AND je.date > ?
        AND je.date <= ?
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type IN ('income', 'income_other', 'expense', 'expense_depreciation', 'expense_direct_cost')
      GROUP BY a.odoo_type
    `).all(companyId, currentYear + '-01-01', asOfDate) as any[];

    const byTypeCY: Record<string, number> = {};
    for (const row of cyRows) byTypeCY[row.odoo_type] = row.balance;

    // Compute standard BS fields
    const cash = byTypeAll['asset_cash'] || 0;
    const receivable = byTypeAll['asset_receivable'] || 0;
    const currentAssets = byTypeAll['asset_current'] || 0;
    const fixedAssets = byTypeAll['asset_fixed'] || 0;
    const nonCurrentAssets = byTypeAll['asset_non_current'] || 0;
    const payable = byTypeAll['liability_payable'] || 0;
    const currentLiabilities = byTypeAll['liability_current'] || 0;
    const nonCurrentLiabilities = byTypeAll['liability_non_current'] || 0;
    const equity = byTypeAll['equity'] || 0;

    // Net income = revenue - expenses (current year)
    const revenue = (byTypeCY['income'] || 0) + (byTypeCY['income_other'] || 0);
    const expenses = (byTypeCY['expense'] || 0) + (byTypeCY['expense_depreciation'] || 0) + (byTypeCY['expense_direct_cost'] || 0);
    const netIncome = -(revenue - expenses); // debit = expense positive, credit = revenue negative in JE

    const totalAssets = cash + receivable + currentAssets + fixedAssets + nonCurrentAssets;
    const totalLiabilities = payable + currentLiabilities + nonCurrentLiabilities;
    const totalEquity = equity + netIncome;

    return {
      company_id: companyId,
      company_name: company.company_name,
      cash,
      receivable,
      current_assets: currentAssets,
      fixed_assets: fixedAssets,
      non_current_assets: nonCurrentAssets,
      total_assets: totalAssets,
      payable,
      current_liabilities: currentLiabilities,
      non_current_liabilities: nonCurrentLiabilities,
      total_liabilities: totalLiabilities,
      equity,
      net_income: netIncome,
      total_equity: totalEquity,
    };
  });

  res.json({ as_of_date: asOfDate, companies: results });
});
  router.get('/cash-flow-statement', (req, res) => {
    const companyIds = req.query.companies
      ? (req.query.companies as string).split(',').map(Number)
      : undefined;

    // The standard account codes from the spreadsheet
    const accountCodes = [
      '800010', '800020',  // Interest Income, Grant Income
      '101000', '101010',  // Accounts Receivable, Other Receivable
      '107010',            // GST Control
      '202000',            // Deposits
      '300050',            // Other Payables - Fiat to/from Crypto
      '303010', '303011', '303020', '303021', '303041', '303050', '303061',
      '303080', '303180',  // Intercompany amounts
      '700800',            // Control Account - R&D
      '701010', '701020', '701030', '701060', '701070',
      '701110', '701203', '701208', '701217',  // Expenses
      '902000', '902010',  // Exchange Difference
      '903010',            // Unrealized Gain or Loss
    ];

    // Get companies
    let companies: any[];
    if (companyIds) {
      const placeholders = companyIds.map(() => '?').join(',');
      companies = db.prepare(`
        SELECT DISTINCT company_id, company_name
        FROM journal_entries
        WHERE company_id IN (${placeholders})
        ORDER BY company_name
      `).all(...companyIds);
    } else {
      companies = db.prepare(`
        SELECT DISTINCT company_id, company_name
        FROM journal_entries
        WHERE company_id IS NOT NULL AND company_name != ''
        ORDER BY company_name
      `).all();
    }

    const result: any[] = [];

    for (const company of companies as any[]) {
      // Get cash account balances (opening = all posted entries)
      const cashBalance = db.prepare(`
        SELECT
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
        FROM line_items li
        INNER JOIN journal_entries je ON je.id = li.journal_entry_id
          AND je.status = 'posted' AND je.company_id = ?
        INNER JOIN accounts a ON a.id = li.account_id
        WHERE a.odoo_type = 'asset_cash'
      `).get(company.company_id) as any;

      // Get all account movements for this company
      const movements = db.prepare(`
        SELECT
          a.code,
          a.name,
          COALESCE(SUM(li.debit), 0) as total_debit,
          COALESCE(SUM(li.credit), 0) as total_credit,
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as net
        FROM line_items li
        INNER JOIN journal_entries je ON je.id = li.journal_entry_id
          AND je.status = 'posted' AND je.company_id = ?
        INNER JOIN accounts a ON a.id = li.account_id
        WHERE a.odoo_type != 'asset_cash'
        GROUP BY a.code, a.name
        HAVING net != 0
        ORDER BY a.code
      `).all(company.company_id) as any[];

      // Get cash accounts with balances
      const cashAccounts = db.prepare(`
        SELECT
          a.code, a.name,
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
        FROM line_items li
        INNER JOIN journal_entries je ON je.id = li.journal_entry_id
          AND je.status = 'posted' AND je.company_id = ?
        INNER JOIN accounts a ON a.id = li.account_id
        WHERE a.odoo_type = 'asset_cash'
        GROUP BY a.code, a.name
        HAVING balance != 0
        ORDER BY a.code
      `).all(company.company_id) as any[];

      // Compute cash in / cash out from movements
      const cashIn = movements.filter((m: any) => m.net > 0).reduce((s: number, m: any) => s + m.net, 0);
      const cashOut = movements.filter((m: any) => m.net < 0).reduce((s: number, m: any) => s + m.net, 0);

      result.push({
        company_id: company.company_id,
        company_name: company.company_name,
        cash_balance: cashBalance?.balance || 0,
        cash_in: cashIn,
        cash_out: cashOut,
        movements,
        cash_accounts: cashAccounts,
      });
    }

    res.json(result);
  });

  // Consolidated balance sheet with entity groupings
// ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ /consolidated-bs ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
router.get('/consolidated-bs', (req, res) => {
  // Use tb_snapshots (admin TB kanban) as primary data source
  try {
    const snapshotDate = (req.query.as_of_date as string) ||
      new Date().toISOString().slice(0, 10);
    // Convert date to period (YYYY-MM)
    const period = snapshotDate.slice(0, 7);

    // Load all TB rows for this period
    const tbRows = db.prepare(`
      SELECT company_id, account_code, account_type, balance
      FROM tb_snapshots
      WHERE period = ?
    `).all(period) as { company_id: number; account_code: string; account_type: string; balance: number }[];

    // Index by company_id
    const tbByCompany: Record<number, { byType: Record<string, number>; byCode: Record<string, number> }> = {};
    for (const row of tbRows) {
      if (!tbByCompany[row.company_id]) {
        tbByCompany[row.company_id] = { byType: {}, byCode: {} };
      }
      const c = tbByCompany[row.company_id];
      c.byType[row.account_type] = (c.byType[row.account_type] || 0) + row.balance;
      c.byCode[row.account_code] = (c.byCode[row.account_code] || 0) + row.balance;
    }

    // Helper: sum a BS line for a set of company_ids
    function computeLineForGroup(companyIds: number[], line: BSLineItem): number {
      let total = 0;
      for (const cid of companyIds) {
        const c = tbByCompany[cid];
        if (!c) continue;
        if (line.odoo_types && line.odoo_types.length > 0) {
          for (const t of line.odoo_types) {
            total += c.byType[t] || 0;
          }
        } else if (line.account_codes && line.account_codes.length > 0) {
          for (const code of line.account_codes) {
            total += c.byCode[code] || 0;
          }
        } else if (line.account_codes_prefix) {
          for (const [code, val] of Object.entries(c.byCode)) {
            if (code.startsWith(line.account_codes_prefix)) total += val as number;
          }
        }
      }
      return total;
    }

    // Build balances per group per BS line
    const groupBalances: Record<string, Record<string, number>> = {};

    for (const group of ENTITY_GROUPS) {
      if (group.is_subtotal) continue;

            if (group.is_manual) {
        // Use manual_bs_lines for Xterio Foundation, Keystone etc. (per BS line)
        const bsLineRows = db.prepare(`
          SELECT line_code, amount_usd
          FROM manual_bs_lines
          WHERE entity = ? AND period = ?
        `).all(group.name, period) as { line_code: string; amount_usd: number }[];
        const bsLineMap: Record<string, number> = {};
        for (const r of bsLineRows) bsLineMap[r.line_code] = r.amount_usd;

        const bals: Record<string, number> = {};
        // Set leaf values from manual entries
        for (const line of BS_LINES) {
          if (line.computed_from) continue;
          if (line.is_section || (line as any).is_total) continue; // skip aggregate rows
          bals[line.code] = bsLineMap[line.code] ?? 0;
        }
        // Compute aggregate rows from leaves (odoo_types-based parents)
        const assetLeafs = ['BANK_CASH','CASH','DIGITAL_TOKEN','RECEIVABLES','A_107010','A_101000','A_101010','CURRENT_ASSETS_OTHER','PREPAYMENTS','FIXED_ASSETS','NON_CURRENT_ASSETS','A_200000','A_202000'];
        const curAssetLeafs = ['BANK_CASH','CASH','DIGITAL_TOKEN','RECEIVABLES','A_107010','A_101000','A_101010','CURRENT_ASSETS_OTHER','PREPAYMENTS'];
        const liabLeafs = ['A_303010','A_303011','A_303020','A_303021','A_303031','A_303040','A_303041','A_303050','A_303051','A_303060','A_303061','A_303070','A_303071','A_303080','A_303081','A_303090','A_303091','A_303100','A_303110','A_303120','A_303150','A_303160','A_303170','A_303171','A_303180','A_303181','A_301000','A_302010','PAYABLES','A_300000','A_300030','NON_CURRENT_LIABILITIES','A_300040','A_300050','A_303030'];
        const equityLeafs = ['EQUITY_RETAINED','A_RETAINED_EARNINGS','A_SHARE_CAPITALS','A_CAPITAL_IN_WALLET','CURRENT_YEAR_PL'];
        bals['CURRENT_ASSETS'] = curAssetLeafs.reduce((s: number, c: string) => s + (bals[c] || 0), 0);
        bals['ASSETS'] = assetLeafs.reduce((s: number, c: string) => s + (bals[c] || 0), 0);
        bals['LIABILITIES'] = liabLeafs.reduce((s: number, c: string) => s + (bals[c] || 0), 0);
        bals['EQUITY'] = equityLeafs.reduce((s: number, c: string) => s + (bals[c] || 0), 0);
        // computed_from (LIAB_EQUITY)
        for (const line of BS_LINES) {
          if (!line.computed_from) continue;
          bals[line.code] = (line.computed_from as string[]).reduce((s: number, src: string) => s + (bals[src] || 0), 0);
        }
        groupBalances[group.name] = bals;
        continue;
      }

      // TB-based group
      const bals: Record<string, number> = {};
      for (const line of BS_LINES) {
        if (line.computed_from) continue;
        bals[line.code] = computeLineForGroup(group.company_ids, line);
      }
      for (const line of BS_LINES) {
        if (!line.computed_from) continue;
        if (line.code in bals) continue;
        bals[line.code] = (line.computed_from as string[]).reduce((s: number, src: string) => s + (bals[src] || 0), 0);
      }
      groupBalances[group.name] = bals;
    }

    // Step 2: Compute subtotals
    for (const group of ENTITY_GROUPS) {
      if (!group.is_subtotal) continue;
      const bals: Record<string, number> = {};
      for (const line of BS_LINES) {
        bals[line.code] = (group.subtotal_groups || []).reduce((s: number, sg: string) => {
          return s + ((groupBalances[sg] || {})[line.code] || 0);
        }, 0);
      }
      groupBalances[group.name] = bals;
    }

    // Step 3: IC Elimination (zero in TB-based approach)
    const icBals: Record<string, number> = {};
    for (const line of BS_LINES) icBals[line.code] = 0;

    // Step 4: Consolidated = Total
    const totalBals = groupBalances['Total'] || {};
    const consolBals: Record<string, number> = {};
    for (const line of BS_LINES) {
      consolBals[line.code] = totalBals[line.code] || 0;
    }

    // Step 5: Build response
    const columns = [
      ...ENTITY_GROUPS.map(g => ({
        name: g.name,
        is_subtotal: g.is_subtotal || false,
        is_elimination: false,
        is_consolidated: false,
      })),
      { name: 'IC Elimination', is_subtotal: false, is_elimination: true, is_consolidated: false },
      { name: 'Consolidated', is_subtotal: false, is_elimination: false, is_consolidated: true },
    ];

    const rows = BS_LINES.map(line => {
      const values = [
        ...ENTITY_GROUPS.map(g => (groupBalances[g.name] || {})[line.code] || 0),
        icBals[line.code] || 0,
        consolBals[line.code] || 0,
      ];
      return {
        code: line.code,
        label: line.label,
        indent: line.indent,
        is_total: line.is_total || false,
        is_section: line.is_section || false,
        values,
      };
    });

    res.json({ columns, rows });
  } catch (err: any) {
    console.error('[consolidated-bs] tb error:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});
router.get('/bank-accounts', (req, res) => {
  const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

  // Compute prior month end date
  const priorDate = (() => {
    const d = new Date(asOfDate + 'T00:00:00Z');
    d.setDate(0); // last day of prior month
    return d.toISOString().slice(0, 10);
  })();

  const rows = db.prepare(`
    SELECT
      je.company_id,
      je.company_name,
      a.code,
      a.name,
      a.odoo_type,
      COALESCE(MAX(li.currency), 'USD') as currency,
      COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
    FROM accounts a
    INNER JOIN line_items li ON li.account_id = a.id
    INNER JOIN journal_entries je ON je.id = li.journal_entry_id
      AND je.status = 'posted'
      AND je.date <= ?
    WHERE a.odoo_type = 'asset_cash' AND a.is_active = 1
    GROUP BY je.company_id, a.code, a.name, a.odoo_type
    HAVING ABS(balance) > 0.01
    ORDER BY je.company_name, a.code
  `).all(asOfDate) as any[];

  const priorRows = db.prepare(`
    SELECT
      je.company_id,
      a.code,
      COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
    FROM accounts a
    INNER JOIN line_items li ON li.account_id = a.id
    INNER JOIN journal_entries je ON je.id = li.journal_entry_id
      AND je.status = 'posted'
      AND je.date <= ?
    WHERE a.odoo_type = 'asset_cash' AND a.is_active = 1
    GROUP BY je.company_id, a.code
    HAVING ABS(balance) > 0.01
  `).all(priorDate) as any[];

  const priorMap: Record<string, number> = {};
  for (const r of priorRows) priorMap[`${r.company_id}:${r.code}`] = r.balance;

  // Map company_id to group
  const OW_IDS = new Set([15, 16, 28, 30, 31]);
  function getGroup(companyId: number): string {
    return OW_IDS.has(companyId) ? 'OW' : 'Xterio';
  }

  // Include Foundation manual balances
  const foundationPeriod = (() => {
    const d = new Date(asOfDate + 'T00:00:00Z');
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  })();
  let foundRows = db.prepare(`
    SELECT account_code as code, account_name as name,
           ROUND(SUM(amount_local * exchange_rate), 2) as balance
    FROM manual_balances
    WHERE entity = 'Xterio Foundation'
      AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
      AND period = ?
    GROUP BY account_code
    HAVING ABS(balance) > 0.01
  `).all(foundationPeriod) as any[];

  if (!foundRows.length) {
    const latestP = (db.prepare(`SELECT period FROM manual_balances WHERE entity='Xterio Foundation' ORDER BY period DESC LIMIT 1`).get() as any)?.period;
    if (latestP) foundRows = db.prepare(`
      SELECT account_code as code, account_name as name,
             ROUND(SUM(amount_local * exchange_rate), 2) as balance
      FROM manual_balances
      WHERE entity = 'Xterio Foundation'
        AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
        AND period = ?
      GROUP BY account_code
      HAVING ABS(balance) > 0.01
    `).all(latestP) as any[];
  }

  const foundationAccounts = foundRows.map((r: any) => ({
    company_id: 22,
    company_name: 'Xterio Foundation',
    account_code: r.code,
    account_name: r.name,
    account_type: 'asset_cash',
    currency: 'USD',
    balance: r.balance,
    prior_balance: null,
    change: null,
    group: 'Xterio',
  }));

  const accounts = rows.map(row => ({
    company_id: row.company_id,
    company_name: row.company_name,
    account_code: row.code,
    account_name: row.name,
    account_type: row.odoo_type,
    currency: row.currency,
    balance: row.balance,
    prior_balance: priorMap[`${row.company_id}:${row.code}`] ?? null,
    change: priorMap[`${row.company_id}:${row.code}`] != null
      ? row.balance - priorMap[`${row.company_id}:${row.code}`]
      : null,
    group: getGroup(row.company_id),
  }));

  // Build groups format for frontend display (by entity group)
  const allBankAccounts = [...accounts, ...foundationAccounts];
  const bankByGroup: Record<string, any[]> = {};
  for (const a of allBankAccounts) {
    const gName = a.group || 'Other';
    if (!bankByGroup[gName]) bankByGroup[gName] = [];
    bankByGroup[gName].push({
      code: a.account_code,
      name: a.account_name,
      current_balance: a.balance,
      prior_balance: a.prior_balance,
      change: a.change,
      asset_type: a.code.startsWith('10W') ? 'Crypto' : 'Cash',
      currency: a.currency,
      company_name: a.company_name,
      company_id: a.company_id,
    });
  }
  const bankGroups = Object.entries(bankByGroup).map(([name, accs]) => ({
    name,
    accounts: accs,
    total_current: accs.reduce((s: number, a: any) => s + (a.current_balance || 0), 0),
    total_cash_current: accs.filter((a: any) => a.asset_type !== 'Crypto').reduce((s: number, a: any) => s + (a.current_balance || 0), 0),
    total_crypto_current: accs.filter((a: any) => a.asset_type === 'Crypto').reduce((s: number, a: any) => s + (a.current_balance || 0), 0),
  }));
  res.json({
    as_of_date: asOfDate,
    prior_date: priorDate,
    accounts: allBankAccounts,
    groups: bankGroups,
  });
});
  router.get('/xterio-foundation', (_req, res) => {
    const rows = db.prepare(`
      SELECT entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category
      FROM manual_balances
      WHERE entity = 'Xterio Foundation' AND account_code != 'FOUNDATION_IC'
      ORDER BY category, account_code, period
    `).all() as any[];

    // Group by period for totals
    const periods = [...new Set(rows.map(r => r.period))].sort();
    const byPeriod: Record<string, any> = {};

    for (const p of periods) {
      const periodRows = rows.filter(r => r.period === p);
      const corpPremium = periodRows.filter(r => r.category === 'Corporate Premium');
      const liqOpt = periodRows.filter(r => r.category === 'Liquidity Optimizer');
      const fxFwd = periodRows.filter(r => r.category === 'FX Forward');

      byPeriod[p] = {
        period: p,
        exchange_rate: periodRows[0]?.exchange_rate || 1.25,
        corporate_premium_chf: corpPremium.reduce((s: number, r: any) => s + r.amount_local, 0),
        corporate_premium_usd: corpPremium.reduce((s: number, r: any) => s + r.amount_usd, 0),
        liquidity_optimizer_chf: liqOpt.reduce((s: number, r: any) => s + r.amount_local, 0),
        liquidity_optimizer_usd: liqOpt.reduce((s: number, r: any) => s + r.amount_usd, 0),
        fx_forward_chf: fxFwd.reduce((s: number, r: any) => s + r.amount_local, 0),
        fx_forward_usd: fxFwd.reduce((s: number, r: any) => s + r.amount_usd, 0),
        total_chf: periodRows.reduce((s: number, r: any) => s + r.amount_local, 0),
        total_usd: periodRows.reduce((s: number, r: any) => s + r.amount_usd, 0),
      };
    }

    res.json({
      entity: 'Xterio Foundation',
      currency: 'CHF',
      periods: Object.values(byPeriod),
      accounts: rows,
      latest_total_usd: byPeriod[periods[periods.length - 1]]?.total_usd || 0,
    });
  });


  // ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ Foundation Manual Balances: GET all rows for a period ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
  router.get('/foundation-balances', (req, res) => {
    try {
      const period = (req.query.period as string) || '';
      let rows: any[];
      if (period) {
        rows = db.prepare(`SELECT id, account_code, account_name, category, amount_local, currency, exchange_rate, amount_usd, period FROM manual_balances WHERE entity = 'Xterio Foundation' AND account_code != 'FOUNDATION_IC' AND period = ? ORDER BY category, account_code`).all(period) as any[];
      } else {
        rows = db.prepare(`SELECT id, account_code, account_name, category, amount_local, currency, exchange_rate, amount_usd, period FROM manual_balances WHERE entity = 'Xterio Foundation' AND account_code != 'FOUNDATION_IC' ORDER BY period DESC, category, account_code`).all() as any[];
      }
      const periods = [...new Set((db.prepare("SELECT DISTINCT period FROM manual_balances WHERE entity = 'Xterio Foundation' AND account_code != 'FOUNDATION_IC' ORDER BY period DESC").all() as any[]).map((r: any) => r.period))];
      res.json({ rows, periods });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ Foundation Manual Balances: PATCH a single row ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
  router.patch('/foundation-balances/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { amount_local, exchange_rate } = req.body as { amount_local: number; exchange_rate: number };
      const amount_usd = amount_local * exchange_rate;
      db.prepare(`UPDATE manual_balances SET amount_local = ?, exchange_rate = ?, amount_usd = ? WHERE id = ? AND entity = 'Xterio Foundation'`).run(amount_local, exchange_rate, amount_usd, id);
      res.json({ ok: true, id, amount_local, exchange_rate, amount_usd });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ Foundation Manual Balances: POST new period rows ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
  router.post('/foundation-balances', (req, res) => {
    try {
      const { period, rows } = req.body as { period: string; rows: Array<{ account_code: string; account_name: string; category: string; amount_local: number; currency: string; exchange_rate: number }> };
      if (!period || !rows || !rows.length) return res.status(400).json({ error: 'period and rows required' }) as any;
      const insert = db.prepare(`INSERT INTO manual_balances (entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category) VALUES ('Xterio Foundation', ?, ?, ?, ?, ?, ?, ?, ?)`);
      const tx = db.transaction(() => {
        for (const r of rows) {
          insert.run(r.account_code, r.account_name, period, r.amount_local, r.currency || 'CHF', r.exchange_rate, r.amount_local * r.exchange_rate, r.category);
        }
      });
      tx();
      res.json({ ok: true, period, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ Generic manual-balances API (entity param) ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
  router.get('/manual-balances', (req, res) => {
    try {
      const entity = (req.query.entity as string) || '';
      const period = (req.query.period as string) || '';
      if (!entity) return res.status(400).json({ error: 'entity required' }) as any;
      let rows: any[];
      if (period) {
        rows = db.prepare(`SELECT id, account_code, account_name, category, amount_local, currency, exchange_rate, amount_usd, period FROM manual_balances WHERE entity = ? AND period = ? ORDER BY category, account_code`).all(entity, period) as any[];
      } else {
        rows = db.prepare(`SELECT id, account_code, account_name, category, amount_local, currency, exchange_rate, amount_usd, period FROM manual_balances WHERE entity = ? ORDER BY period DESC, category, account_code`).all(entity) as any[];
      }
      const periods = [...new Set((db.prepare('SELECT DISTINCT period FROM manual_balances WHERE entity = ? ORDER BY period DESC').all(entity) as any[]).map((r: any) => r.period))];
      res.json({ rows, periods });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/manual-balances/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { amount_local, exchange_rate, entity } = req.body as { amount_local: number; exchange_rate: number; entity: string };
      const amount_usd = amount_local * exchange_rate;
      db.prepare(`UPDATE manual_balances SET amount_local = ?, exchange_rate = ?, amount_usd = ? WHERE id = ? AND entity = ?`).run(amount_local, exchange_rate, amount_usd, id, entity || '');
      res.json({ ok: true, id, amount_local, exchange_rate, amount_usd });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/manual-balances', (req, res) => {
    try {
      const { entity, period, rows } = req.body as { entity: string; period: string; rows: Array<{ account_code: string; account_name: string; category: string; amount_local: number; currency: string; exchange_rate: number }> };
      if (!entity || !period || !rows?.length) return res.status(400).json({ error: 'entity, period and rows required' }) as any;
      const insert = db.prepare(`INSERT INTO manual_balances (entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const tx = db.transaction(() => { for (const r of rows) insert.run(entity, r.account_code, r.account_name, period, r.amount_local, r.currency || 'USD', r.exchange_rate, r.amount_local * r.exchange_rate, r.category); });
      tx();
      res.json({ ok: true, entity, period, count: rows.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── /manual-bs-lines GET ─────────────────────────────────────────────────
  router.get('/manual-bs-lines', (req, res) => {
    try {
      const entity = (req.query.entity as string) || '';
      const period = (req.query.period as string) || '';
      if (!entity) return res.status(400).json({ error: 'entity required' }) as any;
      let rows: any[];
      if (period) {
        rows = db.prepare('SELECT line_code, amount_usd FROM manual_bs_lines WHERE entity = ? AND period = ?').all(entity, period) as any[];
      } else {
        rows = db.prepare('SELECT line_code, amount_usd, period FROM manual_bs_lines WHERE entity = ? ORDER BY period DESC').all(entity) as any[];
      }
      const periods = [...new Set((db.prepare('SELECT DISTINCT period FROM manual_bs_lines WHERE entity = ? ORDER BY period DESC').all(entity) as any[]).map((r: any) => r.period))];
      const lineMap: Record<string, number> = {};
      for (const r of rows as any[]) lineMap[r.line_code] = r.amount_usd;
      res.json({ lines: lineMap, periods });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── /manual-bs-lines POST (upsert) ───────────────────────────────────────
  router.post('/manual-bs-lines', (req, res) => {
    try {
      const { entity, period, lines } = req.body as { entity: string; period: string; lines: Record<string, number> };
      if (!entity || !period || !lines) return res.status(400).json({ error: 'entity, period and lines required' }) as any;
      const upsert = db.prepare('INSERT INTO manual_bs_lines (entity, period, line_code, amount_usd, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\')) ON CONFLICT(entity, period, line_code) DO UPDATE SET amount_usd = excluded.amount_usd, updated_at = excluded.updated_at');
      const tx = db.transaction(() => {
        for (const [code, amount] of Object.entries(lines)) {
          upsert.run(entity, period, code, Number(amount) || 0);
        }
      });
      tx();
      res.json({ ok: true, entity, period, count: Object.keys(lines).length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // List available balance snapshots
// ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ /snapshots ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
// List available balance snapshots (from Odoo confirmed tb_snapshots)
router.get('/snapshots', (_req, res) => {
  // Use Odoo accounting periods (tb_snapshots) as authoritative time definition
  const rows = db.prepare(`
    SELECT
      period as month,
      date(period || '-01', '+1 month', '-1 day') as snapshot_date,
      COUNT(DISTINCT company_id) as account_count
    FROM tb_snapshots
    WHERE confirmed_at IS NOT NULL
    GROUP BY period
    ORDER BY period DESC
  `).all() as any[];

  // Return raw array for backward compatibility with cash.html
  res.json(rows);
});
// ─── /executive-summary ──────────────────────────────────────────────────────
router.get('/executive-summary', (req, res) => {
  try {
    const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
    const priorDate = (() => { const d = new Date(asOfDate + 'T00:00:00Z'); d.setDate(0); return d.toISOString().slice(0, 10); })();
    const allGroups = ENTITY_GROUPS.filter((g: any) => !g.is_subtotal && !g.is_manual);
    const xterioNames = ['LTECH', 'AOD', 'XLABS', 'PRIVILEGE HK', 'Xterio'];
    const owNames = ['OW', 'Reach', 'Rough house', 'Keystone'];
    const holdingsNames = ['CS', 'Palios', 'LHOLDINGS', 'PLAY ALGORITHM', 'QUANTUMMIND'];
    const XTERIO_IDS: number[] = allGroups.filter((g: any) => xterioNames.some(n => g.name.includes(n))).flatMap((g: any) => g.company_ids || []);
    const OW_IDS: number[] = allGroups.filter((g: any) => owNames.some(n => g.name.includes(n))).flatMap((g: any) => g.company_ids || []);
    const HOLDINGS_IDS: number[] = allGroups.filter((g: any) => holdingsNames.some(n => g.name.includes(n))).flatMap((g: any) => g.company_ids || []);
    const ALL_IDS: number[] = allGroups.flatMap((g: any) => g.company_ids || []);
    const foundationPeriod = (() => { const d = new Date(asOfDate + 'T00:00:00Z'); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
    const priorFoundPeriod = (() => { const d = new Date(priorDate + 'T00:00:00Z'); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
    function getFoundation(period: string) {
      // Read from manual_bs_lines: sum all asset rows = net_assets, BANK_CASH = cash_usd
      const NOT_ASSET = new Set(['TRADE_PAY','ACCRUED_EXP','DEFERRED_REV','VAT_PAY','OTHER_CURR_LIAB','LONG_TERM_DEBT','DEFER_TAX_LIAB','OTHER_NON_CURR_LIAB','IC_PAY_CURR','IC_PAY_LONG','SHARE_CAP','RETAINED','CURR_PROFIT','OTHER_EQUITY','NONCTRL_INT']);
      const getRow = (p: string) => {
        const rows = db.prepare(`SELECT line_code, amount_usd FROM manual_bs_lines WHERE entity='Xterio Foundation' AND period=?`).all(p) as any[];
        let na = 0, ca = 0;
        for (const row of rows) {
          if (!NOT_ASSET.has(row.line_code)) na += (row.amount_usd || 0);
          if (row.line_code === 'BANK_CASH') ca = (row.amount_usd || 0);
        }
        return { na, ca };
      };
      let r = getRow(period);
      if (!r.na) {
        const lp = (db.prepare(`SELECT period FROM manual_bs_lines WHERE entity='Xterio Foundation' AND period <= ? ORDER BY period DESC LIMIT 1`).get(period) as any)?.period
          || (db.prepare(`SELECT period FROM manual_bs_lines WHERE entity='Xterio Foundation' ORDER BY period DESC LIMIT 1`).get() as any)?.period;
        if (lp) r = getRow(lp);
      }
      return { net_assets: r.na || 0, cash_usd: r.ca || 0 };
    }
    function getNetAssets(ids: number[], asOf: string, excludeFixedAssets = false): number {
      if (!ids.length) return 0;
      const ph = ids.map(() => '?').join(',');
      const period = asOf.slice(0, 7);
      const noFixed = excludeFixedAssets
        ? "AND account_type NOT IN ('asset_fixed','asset_non_current')"
        : '';
      const row = db.prepare(`
        SELECT COALESCE(SUM(balance), 0) as net_assets
        FROM tb_snapshots
        WHERE period = ?
          AND company_id IN (${ph})
          AND account_type IN (
            'asset_cash','asset_receivable','asset_current','asset_prepayments',
            'asset_fixed','asset_non_current',
            'liability_payable','liability_current','liability_non_current','liability_credit_card'
          )
          AND account_code != '300040'
          ${noFixed}
      `).get(period, ...ids) as any;
      return row?.net_assets ?? 0;
    }
    function getCash(ids: number[], asOf: string): { fiat: number; crypto: number } {
      if (!ids.length) return { fiat: 0, crypto: 0 };
      const ph = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT a.code as code, COALESCE(MAX(li.currency),'USD') as currency, COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as bal FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date<=? AND je.company_id IN (${ph}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.odoo_type='asset_cash' GROUP BY a.id`).all(asOf, ...ids) as any[];
      const cr = new Set(['USDT','ETH','BTC','USDC']); let fiat = 0, crypto = 0;
      for (const r of rows) { if (cr.has(r.currency)) crypto += r.bal; else fiat += r.bal; }
      return { fiat, crypto };
    }
    const fn = getFoundation(foundationPeriod), fp = getFoundation(priorFoundPeriod);
    const xNA = getNetAssets(XTERIO_IDS, asOfDate), xNAp = getNetAssets(XTERIO_IDS, priorDate);
    const oNA = getNetAssets(OW_IDS, asOfDate, true), oNAp = getNetAssets(OW_IDS, priorDate, true);
    const ksPeriod = asOfDate.slice(0, 7), ksPriorPeriod = priorDate.slice(0, 7);
    const keystoneRow = db.prepare("SELECT SUM(amount_usd) as total FROM manual_balances WHERE entity='Keystone Foundation' AND period=?").get(ksPeriod) as any;
    const keystonePriorRow = db.prepare("SELECT SUM(amount_usd) as total FROM manual_balances WHERE entity='Keystone Foundation' AND period=?").get(ksPriorPeriod) as any;
    const keystoneNA = (keystoneRow?.total ?? 0) as number;
    const keystoneNAp = (keystonePriorRow?.total ?? 0) as number;
    const hNA = getNetAssets(HOLDINGS_IDS, asOfDate), hNAp = getNetAssets(HOLDINGS_IDS, priorDate);
    const xC = getCash(XTERIO_IDS, asOfDate), oC = getCash(OW_IDS, asOfDate);
    const hC = getCash(HOLDINGS_IDS, asOfDate);
    const tbTotals = (db.prepare(`SELECT COALESCE(SUM(CASE WHEN account_code LIKE '100%' THEN balance ELSE 0 END),0) as fi, COALESCE(SUM(CASE WHEN account_code LIKE '10W%' THEN balance ELSE 0 END),0) as cr FROM tb_snapshots WHERE period=? AND account_type='asset_cash'`).get(ksPeriod) as any)||{fi:0,cr:0}; const total_cash_fiat = tbTotals.fi + fn.cash_usd, total_cash_crypto = tbTotals.cr;
    const total_cash_all = total_cash_fiat + total_cash_crypto;
    // Per-group waterfall: Net Assets breakdown into components
    function buildWFBreakdown(ids: number[]): any {
      if (!ids.length) return { adj_300040: 0, receivable: 0, payable: 0, intercompany: 0, deposit: 0, cash_fiat: 0, cash_crypto: 0 };
      const ph = ids.map(() => '?').join(',');
      const cryptoCurrencies = new Set(['USDT','ETH','BTC','USDC','BNB','XTR','UST','WBN','USC','SHI','SPE']);
      const q = (w: string) => (db.prepare(`SELECT COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as t FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date<=? AND je.company_id IN (${ph}) INNER JOIN accounts a ON a.id=li.account_id WHERE ${w}`).get(asOfDate, ...ids) as any)?.t || 0;
      const cashRows = db.prepare(`SELECT COALESCE(MAX(li.currency),'USD') as currency, COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as bal FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date<=? AND je.company_id IN (${ph}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.odoo_type='asset_cash' GROUP BY a.id`).all(asOfDate, ...ids) as any[];
      let cash_fiat = 0, cash_crypto = 0;
      for (const r of cashRows) { if (r.code && r.code.startsWith('10W')) cash_crypto += r.bal; else cash_fiat += r.bal; }
      return {
        adj_300040: q(`a.code='300040'`),
        receivable: q(`a.odoo_type='asset_receivable'`),
        payable: q(`a.odoo_type IN ('liability_payable','liability_current') AND a.code NOT LIKE '303%'`),
        intercompany: q(`a.code LIKE '303%'`),
        deposit: q(`a.code='202000'`),
        cash_fiat,
        cash_crypto,
      };
    }
    const wfXterio = buildWFBreakdown(XTERIO_IDS);
    const wfHoldings = buildWFBreakdown(HOLDINGS_IDS);
    const wfOW = buildWFBreakdown(OW_IDS);
    const wfFoundation = { adj_300040: 0, receivable: 0, payable: 0, intercompany: -(fn.net_assets - fn.cash_usd), deposit: 0, cash_fiat: fn.cash_usd, cash_crypto: 0 };
    const waterfall = {
      foundation: { net_assets: fn.net_assets, ...wfFoundation },
      xterio: { net_assets: xNA, ...wfXterio },
      holdings: { net_assets: hNA, ...wfHoldings },
      ow: { net_assets: oNA + keystoneNA, ...wfOW },
    };
    let monthly_burn = 0;
    if (ALL_IDS.length > 0) {
      const tma = (() => { const d = new Date(asOfDate + 'T00:00:00Z'); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); })();
      const bPh = ALL_IDS.map(() => '?').join(',');
      const bRow = db.prepare(`SELECT COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as te FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date>? AND je.date<=? AND je.company_id IN (${bPh}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.odoo_type IN ('expense','expense_direct_cost','expense_depreciation')`).get(tma, asOfDate, ...ALL_IDS) as any;
      monthly_burn = (bRow?.te || 0) / 3;
    }
    const runway_months = monthly_burn > 0 ? total_cash_all / monthly_burn : null;
    let cash_trend: any[] = [];
    if (ALL_IDS.length > 0) {
      const tPh = ALL_IDS.map(() => '?').join(',');
      const NON_OW_IDS = [...XTERIO_IDS, ...HOLDINGS_IDS];
      const nowPh = NON_OW_IDS.length > 0 ? NON_OW_IDS.map(() => '?').join(',') : '0';
      const owTrendPh = OW_IDS.length > 0 ? OW_IDS.map(() => '?').join(',') : '0';
      const nowTrendRows = NON_OW_IDS.length > 0 ? db.prepare(`SELECT strftime('%Y-%m',je.date) as month, COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as delta FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.company_id IN (${nowPh}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.odoo_type='asset_cash' GROUP BY month ORDER BY month`).all(...NON_OW_IDS) as any[] : [];
      const owTrendRows = OW_IDS.length > 0 ? db.prepare(`SELECT strftime('%Y-%m',je.date) as month, COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as delta FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.company_id IN (${owTrendPh}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.odoo_type='asset_cash' GROUP BY month ORDER BY month`).all(...OW_IDS) as any[] : [];
      const nowMap: Record<string,number> = {}; let nowCum = 0;
      for (const r of nowTrendRows) { nowCum += r.delta; nowMap[r.month] = nowCum; }
      const owMap: Record<string,number> = {}; let owCum = 0;
      for (const r of owTrendRows) { owCum += r.delta; owMap[r.month] = owCum; }
      const allTrendMonths = [...new Set([...Object.keys(nowMap),...Object.keys(owMap)])].sort();
      let lastNow = 0, lastOw = 0;
      cash_trend = allTrendMonths.map(month => {
        if (nowMap[month] !== undefined) lastNow = nowMap[month];
        if (owMap[month] !== undefined) lastOw = owMap[month];
        return { date: month + '-30', non_ow: lastNow + fn.cash_usd, ow: lastOw };
      }).slice(-24);
    }
    let entity_cash: any[] = [{ company_id: 22, company_name: 'Xterio Foundation', cash_fiat: fn.cash_usd, cash_crypto: 0 }];
    if (ALL_IDS.length > 0) {
      const ePh = ALL_IDS.map(() => '?').join(',');
      const eRows = db.prepare(`SELECT company_id, company_name, COALESCE(SUM(CASE WHEN account_code LIKE '100%' THEN balance ELSE 0 END),0) as fi, COALESCE(SUM(CASE WHEN account_code LIKE '10W%' THEN balance ELSE 0 END),0) as cr FROM tb_snapshots WHERE period=? AND account_type='asset_cash' AND company_id IN (${ePh}) GROUP BY company_id, company_name ORDER BY company_name`).all(ksPeriod, ...ALL_IDS) as any[];
      entity_cash = [...eRows.map(r => ({ company_id: r.company_id, company_name: r.company_name, cash_fiat: r.fi, cash_crypto: r.cr })), { company_id: 22, company_name: 'Xterio Foundation', cash_fiat: fn.cash_usd, cash_crypto: 0 }];
    }
    let alerts: any[] = [], ic_imbalances: any[] = [];
    if (ALL_IDS.length > 0) {
      const aPh = ALL_IDS.map(() => '?').join(',');
      const aRows = db.prepare(`SELECT je.company_name, a.code, a.name, COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as balance FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date<=? AND je.company_id IN (${aPh}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.odoo_type='asset_cash' GROUP BY je.company_id, a.code HAVING balance<-0.01 ORDER BY balance`).all(asOfDate, ...ALL_IDS) as any[];
      alerts = aRows.map(r => ({ company_name: r.company_name, account_code: r.code, account_name: r.name, balance: r.balance }));
      const icPh = ALL_IDS.map(() => '?').join(',');
      const icRows = db.prepare(`SELECT je.company_name, COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as ic_balance FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date<=? AND je.company_id IN (${icPh}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.code LIKE '303%' GROUP BY je.company_id, je.company_name HAVING ABS(ic_balance)>100 ORDER BY ABS(ic_balance) DESC`).all(asOfDate, ...ALL_IDS) as any[];
      ic_imbalances = icRows.map(r => ({ company_name: r.company_name, ic_balance: r.ic_balance }));
    }
    res.json({ snapshot_date: asOfDate, _v: 2, prior_date: priorDate, xterio_net_assets: xNA, xterio_net_assets_prior: xNAp, foundation_net_assets: fn.net_assets, foundation_net_assets_prior: fp.net_assets, holdings_net_assets: hNA, holdings_net_assets_prior: hNAp, ow_net_assets: oNA + keystoneNA, ow_net_assets_prior: oNAp + keystoneNAp, total_group_net_assets: xNA + fn.net_assets + hNA + oNA + keystoneNA, waterfall, total_cash_fiat, total_cash_crypto, total_cash_all, non_ow_cash: xC.fiat + xC.crypto + hC.fiat + hC.crypto + fn.cash_usd, ow_cash: oC.fiat + oC.crypto, monthly_burn, runway_months, entity_cash, cash_trend, alerts, ic_imbalances });
  } catch (err: any) {
    console.error('executive-summary error:', err);
    res.status(500).json({ error: err?.message || 'Unknown error', stack: err?.stack });
  }
});




// ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ /ow-accounts ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
router.get('/ow-accounts', (req, res) => {
  const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

  // OW group includes: OW[15,16], Reach[30], Rough house[31], Keystone/Play Algorithm[28]
  const owCompanyIds = ENTITY_GROUPS
    .filter((g: any) => !g.is_subtotal && !g.is_manual &&
      ['OW', 'Reach', 'Rough house', 'Keystone'].includes(g.name))
    .flatMap((g: any) => g.company_ids as number[]);

  if (!owCompanyIds.length) return res.json({ as_of_date: asOfDate, accounts: [] });

  const ph = owCompanyIds.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT
      je.company_id,
      je.company_name,
      a.code,
      a.name,
      a.odoo_type,
      COALESCE(MAX(li.currency), 'USD') as currency,
      COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
    FROM accounts a
    INNER JOIN line_items li ON li.account_id = a.id
    INNER JOIN journal_entries je ON je.id = li.journal_entry_id
      AND je.status = 'posted'
      AND je.date <= ?
      AND je.company_id IN (${ph})
    WHERE a.is_active = 1
      AND (a.odoo_type LIKE 'asset_%' OR a.odoo_type LIKE 'liability_%')
      AND a.odoo_type NOT IN ('asset_fixed', 'asset_non_current')
    GROUP BY je.company_id, a.code, a.name, a.odoo_type
    HAVING ABS(balance) > 0.01
    ORDER BY je.company_name, a.code
  `).all(asOfDate, ...owCompanyIds) as any[];

  const accounts = rows.map(row => ({
    company_id: row.company_id,
    company_name: row.company_name,
    account_code: row.code,
    account_name: row.name,
    account_type: row.odoo_type,
    currency: row.currency,
    balance: row.balance,
  }));

  res.json({ as_of_date: asOfDate, accounts });
});
// ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ /ow-closing ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
router.get('/ow-closing', (req, res) => {
  const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);
  const owCompanyIds = ENTITY_GROUPS
    .filter((g: any) => !g.is_subtotal && !g.is_manual &&
      ['OW', 'Reach', 'Rough house', 'Keystone'].includes(g.name))
    .flatMap((g: any) => g.company_ids as number[]);
  if (!owCompanyIds.length) return res.json({ as_of_date: asOfDate, months: [], snapshots: [], summary: { available_balance: 0, monthly_burn: 0, runway_months: null } });
  const ph = owCompanyIds.map(() => '?').join(',');
  const monthsRows = db.prepare(`SELECT DISTINCT strftime('%Y-%m', date) as month FROM journal_entries WHERE status='posted' AND company_id IN (${ph}) AND date<=? ORDER BY month DESC LIMIT 24`).all(...owCompanyIds, asOfDate) as any[];
  const months = monthsRows.map((r: any) => r.month).reverse();
  const snapshots = months.map(month => {
    const lastDayRow = db.prepare(`SELECT MAX(date) as ld FROM journal_entries WHERE status='posted' AND date LIKE ? AND company_id IN (${ph})`).get(month + '%', ...owCompanyIds) as any;
    const lastDay = lastDayRow?.ld || (month + '-01');
    const acctRows = db.prepare(`SELECT a.code, a.odoo_type, COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as balance FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date<=? AND je.company_id IN (${ph}) INNER JOIN accounts a ON a.id=li.account_id GROUP BY a.id, a.code, a.odoo_type HAVING ABS(balance)>0.01`).all(lastDay, ...owCompanyIds) as any[];
    let cash = 0, orFromXterio = 0, ar = 0, noteReceivable = 0, payables = 0, accrualExp = 0, thrackle = 0;
    for (const r of acctRows) {
      const code = r.code as string; const bal = r.balance as number;
      if (r.odoo_type === 'asset_cash') { cash += bal; }
      else if (code.startsWith('303')) { orFromXterio += bal; }
      else if (code === '101000') { ar += bal; }
      else if (code === '101010' || r.odoo_type === 'asset_hcurrent' || r.odoo_type === 'asset_prepayments') { noteReceivable += bal; }
      else if (code === '300030' || code === '300000') { payables += bal; }
      else if (code === '301000' || code === '302010') { accrualExp += bal; }
      else if (code === '300040' || code === '300050') { thrackle += bal; }
    }
    const total = cash + orFromXterio + ar + noteReceivable + payables + accrualExp + thrackle;
    return { date: lastDay, cash, or_from_xterio: orFromXterio, ar, note_receivable: noteReceivable, payables, accrual_exp: accrualExp, thrackle_loan: thrackle, total };
  });
  const latestTotal = snapshots.length > 0 ? snapshots[snapshots.length - 1].total : 0;
  const tma = (() => { const d = new Date(asOfDate + 'T00:00:00Z'); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); })();
  const burnRow = db.prepare(`SELECT COALESCE(SUM(li.debit),0)-COALESCE(SUM(li.credit),0) as te FROM line_items li INNER JOIN journal_entries je ON je.id=li.journal_entry_id AND je.status='posted' AND je.date>? AND je.date<=? AND je.company_id IN (${ph}) INNER JOIN accounts a ON a.id=li.account_id WHERE a.odoo_type IN ('expense','expense_direct_cost')`).get(tma, asOfDate, ...owCompanyIds) as any;
  const monthlyBurn = (burnRow?.te || 0) / 3;
  const runwayMonths = monthlyBurn > 0 ? Math.round(latestTotal / monthlyBurn) : null;
  const legacyMonths = snapshots.map(s => ({ month: s.date.substring(0,7), last_day: s.date, cash: s.cash, assets: s.cash + s.ar + s.note_receivable + s.or_from_xterio, liabilities: s.payables + s.accrual_exp + s.thrackle_loan, net_assets: s.total }));
  res.json({ as_of_date: asOfDate, months: legacyMonths, snapshots, summary: { available_balance: latestTotal, monthly_burn: monthlyBurn, runway_months: runwayMonths }, snapshot_date: snapshots.length > 0 ? snapshots[snapshots.length-1].date : asOfDate });
});
router.get('/card-detail-csv', (req, res) => {
  const card = (req.query.card as string) || '';
  const asOfDate = (req.query.as_of_date as string) || new Date().toISOString().slice(0, 10);

  // ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ Foundation: manual_balances ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
  if (card === 'foundation') {
    const foundationPeriod = (() => {
      const d = new Date(asOfDate + 'T00:00:00Z');
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    })();

    let foundRows = db.prepare(`
      SELECT entity AS "Company", account_code AS "Account Code",
             account_name AS "Account Name", period AS "Period",
             amount_local AS "Amount Local", exchange_rate AS "Exchange Rate",
             ROUND(amount_local * exchange_rate, 2) AS "Balance USD"
      FROM manual_balances
      WHERE entity = 'Xterio Foundation' AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
        AND period = ?
      ORDER BY account_code
    `).all(foundationPeriod) as any[];

    if (!foundRows.length) {
      const latestPeriod = (db.prepare(`SELECT period FROM manual_balances WHERE entity = 'Xterio Foundation' ORDER BY period DESC LIMIT 1`).get() as any)?.period;
      if (latestPeriod) {
        foundRows = db.prepare(`
          SELECT entity AS "Company", account_code AS "Account Code",
                 account_name AS "Account Name", period AS "Period",
                 amount_local AS "Amount Local", exchange_rate AS "Exchange Rate",
                 ROUND(amount_local * exchange_rate, 2) AS "Balance USD"
          FROM manual_balances
          WHERE entity = 'Xterio Foundation' AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
            AND period = ?
          ORDER BY account_code
        `).all(latestPeriod) as any[];
      }
    }

    const hdrs = foundRows.length ? Object.keys(foundRows[0]) : ['Company', 'Account Code', 'Account Name', 'Period', 'Amount Local', 'Exchange Rate', 'Balance USD'];
    const csvLines = [hdrs.map(h => `"${h}"`).join(','), ...foundRows.map(r =>
      hdrs.map((h: string) => { const v = (r as any)[h]; return typeof v === 'number' ? v : `"${String(v ?? '').replace(/"/g, '""')}"`; }).join(',')
    )];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="foundation-detail.csv"');
    return res.send('\uFEFF' + csvLines.join('\n'));
  }

  // ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ All other cards: JE-based ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ
  const holdingsNames = ['CS', 'Palios', 'LHOLDINGS', 'PLAY ALGORITHM', 'QUANTUMMIND'];
  const owNames = ['OW', 'Reach', 'Rough house', 'Keystone'];
  const getIds = (names: string[]) => ENTITY_GROUPS.filter(g => names.includes(g.name)).flatMap((g: any) => g.company_ids as number[]);
  const allIds = ENTITY_GROUPS.filter((g: any) => !g.is_subtotal).flatMap((g: any) => g.company_ids as number[]);
  let companyIds: number[] = [];
  let label = '';
  let typeFilter = '';

  if (card === 'total_group') { companyIds = allIds; label = 'Total-Group'; }
  else if (card === 'xterio') { companyIds = getIds(['LTECH, LTECH W3', 'AOD', 'XLABS, XLAB W3', 'PRIVILEGE HK']); label = 'Xterio-ExclFoundation'; }
  else if (card === 'holdings') { companyIds = getIds(holdingsNames); label = 'Holdings'; }
  else if (card === 'ow') {
    companyIds = getIds(owNames); label = 'OW';
          typeFilter = `AND ab.account_type NOT IN ('asset_fixed', 'asset_non_current')`;
  }
  else if (card === 'cash_fiat') {
    companyIds = allIds; label = 'Cash-Fiat';
          typeFilter = `AND ab.account_type = 'asset_cash' AND ab.account_code NOT LIKE '10W%'`;
  }
  else if (card === 'cash_crypto') {
    companyIds = allIds; label = 'Cash-Crypto';
          typeFilter = `AND ab.account_type = 'asset_cash' AND ab.account_code LIKE '10W%'`;
  }
  else return res.status(400).json({ error: 'Unknown card: ' + card });

  if (!companyIds.length) return res.status(404).json({ error: 'No companies for card: ' + card });

  const ph = companyIds.map(() => '?').join(',');
  const _asOfD = new Date(asOfDate + 'T00:00:00Z'); const _endOfMonth = new Date(_asOfD.getFullYear(), _asOfD.getMonth() + 1, 0).toISOString().slice(0, 10); const dateStr = _endOfMonth.replace(/'/g, '');

          const baseTypeFilter = typeFilter || `AND (ab.account_type LIKE 'asset_%' OR ab.account_type LIKE 'liability_%') AND ab.account_code != '300040'`;

          const rows = db.prepare(`
                    SELECT ab.company_name AS "Company",
                                     ab.account_odoo_id AS "Odoo Account ID",
                                                      ab.account_code AS "Account Code",
                                                                       ab.account_name AS "Account Name",
                                                                                        ab.account_type AS "Account Type",
                                                                                                         ab.currency AS "Currency",
                                                                                                                          ab.balance AS "Balance USD",
                                                                                                                                           ab.snapshot_date AS "Snapshot Date"
                                                                                                                                                     FROM account_balances ab
                                                                                                                                                               INNER JOIN (
                                                                                                                                                                           SELECT company_id, account_odoo_id, MAX(snapshot_date) as max_date
                                                                                                                                                                                       FROM account_balances
                                                                                                                                                                                                   WHERE snapshot_date <= '${dateStr}' AND company_id IN (${ph})
                                                                                                                                                                                                               GROUP BY company_id, account_odoo_id
                                                                                                                                                                                                                         ) latest ON ab.company_id = latest.company_id
                                                                                                                                                                                                                                     AND ab.account_odoo_id = latest.account_odoo_id
                                                                                                                                                                                                                                                 AND ab.snapshot_date = latest.max_date
                                                                                                                                                                                                                                                           WHERE 1=1 ${baseTypeFilter}
                                                                                                                                                                                                                                                                     AND ABS(ab.balance) > 0.01
                                                                                                                                                                                                                                                                               ORDER BY ab.company_name, ab.account_code
                                                                                                                                                                                                                                                                                       `).all(...companyIds) as any[];

  const hdrs2 = rows.length ? Object.keys(rows[0]) : ['Company', 'Odoo Account ID', 'Account Code', 'Account Name', 'Account Type', 'Currency', 'Balance USD', 'Snapshot Date'];
  const csvLines2 = [hdrs2.map(h => `"${h}"`).join(','), ...rows.map((r: any) =>
    hdrs2.map((h: string) => { const v = r[h]; return typeof v === 'number' ? v : `"${String(v ?? '').replace(/"/g, '""')}"`; }).join(',')
  )];

  // For cash_fiat: also include Foundation fiat cash from manual_balances
  if (card === 'cash_fiat') {
    const foundationPeriod2 = (() => {
      const d = new Date(asOfDate + 'T00:00:00Z');
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    })();

    let foundRows2 = db.prepare(`
      SELECT entity AS "Company", NULL AS "Odoo Account ID",
             account_code AS "Account Code", account_name AS "Account Name",
             'asset_cash' AS "Account Type",
             'USD' AS "Currency",
             ROUND(amount_local * exchange_rate, 2) AS "Balance USD",
             ? AS "Snapshot Date"
      FROM manual_balances
      WHERE entity = 'Xterio Foundation' AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
        AND period = ?
      ORDER BY account_code
    `).all(dateStr, foundationPeriod2) as any[];

    if (!foundRows2.length) {
      const latestPeriod2 = (db.prepare(`SELECT period FROM manual_balances WHERE entity = 'Xterio Foundation' AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET') ORDER BY period DESC LIMIT 1`).get() as any)?.period;
      if (latestPeriod2) {
        foundRows2 = db.prepare(`
          SELECT entity AS "Company", NULL AS "Odoo Account ID",
                 account_code AS "Account Code", account_name AS "Account Name",
                 'asset_cash' AS "Account Type",
                 'USD' AS "Currency",
                 ROUND(amount_local * exchange_rate, 2) AS "Balance USD",
                 ? AS "Snapshot Date"
          FROM manual_balances
          WHERE entity = 'Xterio Foundation' AND account_code NOT IN ('FOUNDATION_IC', 'FOUNDATION_NET')
            AND period = ?
          ORDER BY account_code
        `).all(dateStr, latestPeriod2) as any[];
      }
    }

    foundRows2.forEach((r: any) => {
      csvLines2.push(hdrs2.map((h: string) => { const v = r[h]; return typeof v === 'number' ? v : `"${String(v ?? '').replace(/"/g, '""')}"`; }).join(','));
    });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${label}-detail.csv"`);
  res.send('\uFEFF' + csvLines2.join('\n'));
});

  return router;
}
