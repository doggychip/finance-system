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

  // Cash & bank account balances — categorized
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
        AND (a.odoo_type IN ('asset_cash', 'asset_current', 'asset_receivable')
             OR a.odoo_type LIKE '%cash%' OR a.odoo_type LIKE '%bank%')
      GROUP BY a.id
      HAVING balance != 0
      ORDER BY balance DESC
    `).all() as any[];

    // Overworld: codes starting with 10W or specific codes
    const overworldCodes = new Set(['100030', '100031', '100032']);
    const isOverworld = (r: any) => r.code.startsWith('10W') || overworldCodes.has(r.code);

    // Reach Labs: specific codes
    const reachCodes = new Set(['100180', '100190']);
    const isReach = (r: any) => reachCodes.has(r.code);

    const overworld = rows.filter(isOverworld);
    const reach = rows.filter(isReach);
    const remaining = rows.filter(r => !isOverworld(r) && !isReach(r));

    const overdrawn = remaining.filter(r => r.balance < 0);
    const receivable = remaining.filter(r => r.balance > 0 && r.odoo_type === 'asset_receivable');
    const cash = remaining.filter(r => r.balance > 0 && r.odoo_type !== 'asset_receivable');

    const sum = (arr: any[]) => arr.reduce((s: number, r: any) => s + r.balance, 0);

    res.json({
      cash: { accounts: cash, total: sum(cash) },
      receivable: { accounts: receivable, total: sum(receivable) },
      overdrawn: { accounts: overdrawn, total: sum(overdrawn) },
      overworld: { accounts: overworld, total: sum(overworld) },
      reach: { accounts: reach, total: sum(reach) },
      grand_total: sum(remaining),
    });
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
  router.get('/balance-sheet-all', (_req, res) => {
    const companies = db.prepare(`
      SELECT DISTINCT company_id, company_name
      FROM journal_entries
      WHERE company_id IS NOT NULL AND company_name != ''
      ORDER BY company_name
    `).all() as any[];

    const odooTypes = [
      'asset_cash', 'asset_receivable', 'asset_current', 'asset_prepayments',
      'asset_fixed', 'asset_non_current',
      'liability_payable', 'liability_current', 'liability_credit_card', 'liability_non_current',
      'equity', 'equity_unaffected',
    ];

    const result: any[] = [];

    for (const company of companies) {
      const rows = db.prepare(`
        SELECT
          a.odoo_type,
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
        FROM accounts a
        INNER JOIN line_items li ON li.account_id = a.id
          AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted' AND company_id = ?)
        WHERE a.is_active = 1 AND a.odoo_type IN (${odooTypes.map(() => '?').join(',')})
        GROUP BY a.odoo_type
      `).all(company.company_id, ...odooTypes) as any[];

      const byType: Record<string, number> = {};
      for (const r of rows) byType[r.odoo_type] = r.balance;

      const bankCash = byType['asset_cash'] || 0;
      const receivable = byType['asset_receivable'] || 0;
      const currentAssets = byType['asset_current'] || 0;
      const prepayments = byType['asset_prepayments'] || 0;
      const fixedAssets = byType['asset_fixed'] || 0;
      const nonCurrentAssets = byType['asset_non_current'] || 0;

      const payable = byType['liability_payable'] || 0;
      const currentLiab = (byType['liability_current'] || 0) + (byType['liability_credit_card'] || 0);
      const nonCurrentLiab = byType['liability_non_current'] || 0;

      const equity = byType['equity'] || 0;
      const equityUnaffected = byType['equity_unaffected'] || 0;

      const totalCurrentAssets = bankCash + receivable + currentAssets + prepayments;
      const totalAssets = totalCurrentAssets + fixedAssets + nonCurrentAssets;
      const totalCurrentLiabilities = currentLiab + payable;
      const totalLiabilities = totalCurrentLiabilities + nonCurrentLiab;
      const totalEquity = equity + equityUnaffected;

      result.push({
        company_id: company.company_id,
        company_name: company.company_name,
        assets: {
          bank_cash: bankCash,
          receivable,
          current_assets: currentAssets,
          prepayments,
          total_current: totalCurrentAssets,
          fixed_assets: fixedAssets,
          non_current_assets: nonCurrentAssets,
          total: totalAssets,
        },
        liabilities: {
          payable,
          current_liabilities: currentLiab,
          total_current: totalCurrentLiabilities,
          non_current_liabilities: nonCurrentLiab,
          total: totalLiabilities,
        },
        equity: {
          equity,
          equity_unaffected: equityUnaffected,
          total: totalEquity,
        },
        liabilities_plus_equity: totalLiabilities + totalEquity,
      });
    }

    res.json(result);
  });

  // Per-entity cash flow statement
  // Shows cash movements by account code for each company
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
  router.get('/consolidated-bs', (_req, res) => {
    // Step 1: Compute raw balances for non-subtotal groups using ONE query per group
    const groupBalances: Record<string, Record<string, number>> = {};

    for (const group of ENTITY_GROUPS) {
      if (group.is_subtotal) continue;
      if (group.company_ids.length === 0) continue;

      const placeholders = group.company_ids.map(() => '?').join(',');

      // Single query: get balance per odoo_type for this group
      const typeBalances = db.prepare(`
        SELECT a.odoo_type,
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
        FROM line_items li
        INNER JOIN journal_entries je ON je.id = li.journal_entry_id
          AND je.status = 'posted' AND je.company_id IN (${placeholders})
        INNER JOIN accounts a ON a.id = li.account_id
        WHERE a.odoo_type != ''
        GROUP BY a.odoo_type
      `).all(...group.company_ids) as any[];

      const byType: Record<string, number> = {};
      for (const row of typeBalances) byType[row.odoo_type] = row.balance;

      // Map BS_LINES leaf nodes from odoo_types
      const balances: Record<string, number> = {};
      for (const line of BS_LINES) {
        if (line.computed_from) continue;
        if (line.odoo_types) {
          balances[line.code] = line.odoo_types.reduce((s: number, t: string) => s + (byType[t] || 0), 0);
        } else if (line.account_codes) {
          // For specific account codes, need a targeted query
          const codePlaceholders = line.account_codes.map(() => '?').join(',');
          const row = db.prepare(`
            SELECT COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
            FROM line_items li
            INNER JOIN journal_entries je ON je.id = li.journal_entry_id
              AND je.status = 'posted' AND je.company_id IN (${placeholders})
            INNER JOIN accounts a ON a.id = li.account_id
            WHERE a.code IN (${codePlaceholders})
          `).get(...group.company_ids, ...line.account_codes) as any;
          balances[line.code] = row?.balance || 0;
        }
      }

      // Compute derived lines — multiple passes for nested dependencies
      for (let pass = 0; pass < 10; pass++) {
        let resolved = 0;
        for (const line of BS_LINES) {
          if (!line.computed_from) continue;
          if (line.code in balances) continue;
          const allReady = line.computed_from.every((c: string) => c in balances);
          if (!allReady) continue;
          balances[line.code] = line.computed_from.reduce((s: number, c: string) => s + (balances[c] || 0), 0);
          resolved++;
        }
        if (resolved === 0) break;
      }

      groupBalances[group.name] = balances;
    }

    // Step 2: Compute subtotals
    for (const group of ENTITY_GROUPS) {
      if (!group.is_subtotal || !group.subtotal_groups) continue;

      const balances: Record<string, number> = {};

      for (const line of BS_LINES) {
        balances[line.code] = group.subtotal_groups.reduce((sum: number, gname: string) => {
          return sum + (groupBalances[gname]?.[line.code] || 0);
        }, 0);
      }

      groupBalances[group.name] = balances;
    }

    // Step 3: Build response
    const columns = ENTITY_GROUPS.map(g => ({
      name: g.name,
      is_subtotal: g.is_subtotal || false,
    }));

    const rows = BS_LINES.map(line => ({
      code: line.code,
      label: line.label,
      indent: line.indent,
      is_total: line.is_total || false,
      is_section: line.is_section || false,
      values: ENTITY_GROUPS.map(g => groupBalances[g.name]?.[line.code] || 0),
    }));

    // Add check row (Assets + Liabilities + Equity should = 0 in double-entry)
    rows.push({
      code: 'CHECK',
      label: 'Check (should be 0)',
      indent: 0,
      is_total: false,
      is_section: false,
      values: ENTITY_GROUPS.map(g => {
        const b = groupBalances[g.name] || {};
        return (b['ASSETS'] || 0) + (b['LIABILITIES'] || 0) + (b['EQUITY'] || 0);
      }),
    });

    res.json({ columns, rows });
  });

  return router;
}
