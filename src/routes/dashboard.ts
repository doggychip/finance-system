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

  // Cash & bank account balances — categorized
  router.get('/cash-balances', (req, res) => {
    const requestedDate = (req.query.as_of_date as string) || '';

    // Find best snapshot
    const snap = db.prepare(
      requestedDate
        ? `SELECT DISTINCT snapshot_date FROM account_balances WHERE snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`
        : `SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date DESC LIMIT 1`
    ).get(...(requestedDate ? [requestedDate] : [])) as any;

    if (!snap?.snapshot_date) {
      return res.json({ cash: { accounts: [], total: 0 }, receivable: { accounts: [], total: 0 }, overdrawn: { accounts: [], total: 0 }, overworld: { accounts: [], total: 0 }, reach: { accounts: [], total: 0 }, grand_total: 0, non_ow_total: 0, snapshot_date: null });
    }

    const rows = db.prepare(`
      SELECT company_id, company_name, account_code as code, account_name as name, account_type as odoo_type, balance
      FROM account_balances
      WHERE snapshot_date = ? AND (account_type = 'asset_cash' OR (account_type = 'asset_receivable' AND company_id IN (15, 16, 30, 31, 28)))
      AND ABS(balance) > 0.01
      ORDER BY balance DESC
    `).all(snap.snapshot_date) as any[];

    // Map companies to entity groups
    const companyToGroup: Record<number, string> = {};
    for (const g of ENTITY_GROUPS) {
      if (g.is_subtotal || g.is_manual) continue;
      for (const cid of g.company_ids) companyToGroup[cid] = g.name;
    }

    // Non-OW entity groups (for the hero total)
    const nonOWGroups = new Set(['LTECH, LTECH W3', 'AOD', 'XLABS, XLAB W3', 'PRIVILEGE HK', 'CS', 'Palios', 'LHOLDINGS', 'QUANTUMMIND']);
    const owGroups = new Set(['OW', 'Reach', 'Rough house', 'Keystone']);

    const isNonOW = (r: any) => nonOWGroups.has(companyToGroup[r.company_id] || '');
    const isOW = (r: any) => owGroups.has(companyToGroup[r.company_id] || '');

    const nonOWRows = rows.filter(r => isNonOW(r) && r.odoo_type === 'asset_cash');
    const owRows = rows.filter(isOW);
    const remaining = rows.filter(r => !isOW(r));

    const overdrawn = remaining.filter(r => r.balance < 0);
    const receivable = remaining.filter(r => r.balance > 0 && r.odoo_type === 'asset_receivable');
    const cash = remaining.filter(r => r.balance > 0 && r.odoo_type !== 'asset_receivable');

    const sum = (arr: any[]) => arr.reduce((s: number, r: any) => s + r.balance, 0);

    const overworld = owRows.filter(r => ['OW'].includes(companyToGroup[r.company_id] || ''));
    const reach = owRows.filter(r => companyToGroup[r.company_id] === 'Reach');
    const otherOW = owRows.filter(r => !['OW', 'Reach'].includes(companyToGroup[r.company_id] || ''));

    // Non-OW Total "Cash" = bank accounts only (100xxx codes) + Xterio Foundation
    // This excludes Digital Token (10Wxxx) — matches the "Cash" sub-line in consolidated BS
    const nonOWBankCash = nonOWRows.filter((r: any) => r.code.startsWith('100')).reduce((s: number, r: any) => s + r.balance, 0);
    const xterioFoundationCash = 5942149;
    const nonOWCash = nonOWBankCash + xterioFoundationCash;

    // Split cash into bank (100xxx) vs crypto (10Wxxx) sub-categories
    const allPositiveCash = [...cash]; // non-OW positive asset_cash accounts
    const isBankCode = (code: string) => code.startsWith('100');
    const isCryptoCode = (code: string) => code.startsWith('10W');
    const isFixedDeposit = (name: string) => /time deposit|mma/i.test(name);
    const isHotWallet = (name: string) => /integrated|segregate|mt ledger/i.test(name);
    const isColdWallet = (name: string) => /cold wallet|safe wallet/i.test(name);
    const isDefi = (name: string) => /defi/i.test(name);

    const cash_current = allPositiveCash.filter(r => isBankCode(r.code) && !isFixedDeposit(r.name));
    const cash_fixed = allPositiveCash.filter(r => isBankCode(r.code) && isFixedDeposit(r.name));
    const crypto_hot = allPositiveCash.filter(r => isCryptoCode(r.code) && isHotWallet(r.name));
    const crypto_cold = allPositiveCash.filter(r => isCryptoCode(r.code) && isColdWallet(r.name));
    const crypto_defi = allPositiveCash.filter(r => isCryptoCode(r.code) && isDefi(r.name));
    const crypto_other = allPositiveCash.filter(r => isCryptoCode(r.code) && !isHotWallet(r.name) && !isColdWallet(r.name) && !isDefi(r.name));
    // Accounts that don't match 100 or 10W patterns go into cash_current as fallback
    const unmatched = allPositiveCash.filter(r => !isBankCode(r.code) && !isCryptoCode(r.code));
    const cash_current_all = [...cash_current, ...unmatched];

    const total_cash_bank = sum(cash_current_all) + sum(cash_fixed);
    const total_crypto = sum(crypto_hot) + sum(crypto_cold) + sum(crypto_defi) + sum(crypto_other);

    res.json({
      // New split categories
      cash_current: { accounts: cash_current_all, total: sum(cash_current_all) },
      cash_fixed: { accounts: cash_fixed, total: sum(cash_fixed) },
      crypto_hot: { accounts: crypto_hot, total: sum(crypto_hot) },
      crypto_cold: { accounts: crypto_cold, total: sum(crypto_cold) },
      crypto_defi: { accounts: crypto_defi, total: sum(crypto_defi) },
      crypto_other: { accounts: crypto_other, total: sum(crypto_other) },
      total_cash: total_cash_bank,
      total_crypto: total_crypto,
      // Backward-compatible fields
      cash: { accounts: cash, total: sum(cash) },
      receivable: { accounts: receivable, total: sum(receivable) },
      overdrawn: { accounts: overdrawn, total: sum(overdrawn) },
      overworld: { accounts: [...overworld, ...otherOW], total: sum(overworld) + sum(otherOW) },
      reach: { accounts: reach, total: sum(reach) },
      grand_total: sum(remaining),
      non_ow_total: nonOWCash,
      snapshot_date: snap.snapshot_date,
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

  // Revenue vs Expenses monthly — all time
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
  router.get('/balance-sheet-all', (req, res) => {
    const requestedDate = (req.query.as_of_date as string) || '';

    // Find closest snapshot
    const latestSnap = db.prepare(
      requestedDate
        ? `SELECT DISTINCT snapshot_date FROM account_balances WHERE snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`
        : `SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date DESC LIMIT 1`
    ).get(...(requestedDate ? [requestedDate] : [])) as any;

    const snapDate = latestSnap?.snapshot_date;

    if (!snapDate) {
      return res.json([]);
    }

    // Get all companies from snapshot
    const companies = db.prepare(`
      SELECT DISTINCT company_id, company_name
      FROM account_balances WHERE snapshot_date = ?
      ORDER BY company_name
    `).all(snapDate) as any[];

    const result: any[] = [];
    const plTypes = ['income', 'income_other', 'expense', 'expense_direct_cost', 'expense_depreciation'];

    for (const company of companies) {
      const rows = db.prepare(`
        SELECT account_type, SUM(balance) as balance
        FROM account_balances
        WHERE company_id = ? AND snapshot_date = ?
        GROUP BY account_type
      `).all(company.company_id, snapDate) as any[];

      const byType: Record<string, number> = {};
      for (const r of rows) byType[r.account_type] = r.balance;

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
      const pl = plTypes.reduce((s, t) => s + (byType[t] || 0), 0);

      // Get equity account detail for breakdown
      const equityAccounts = db.prepare(`
        SELECT account_code, account_name, balance
        FROM account_balances
        WHERE company_id = ? AND snapshot_date = ? AND account_type = 'equity' AND ABS(balance) > 0.01
        ORDER BY ABS(balance) DESC
      `).all(company.company_id, snapDate) as any[];

      // Categorize equity accounts
      let retainedEarnings = 0, shareCapitals = 0, capitalInWallet = 0, otherEquity = 0;
      for (const ea of equityAccounts) {
        if (ea.account_code === '310000' || ea.account_name.toLowerCase().includes('share capital')) shareCapitals += ea.balance;
        else if (ea.account_code === '201000' || ea.account_name.toLowerCase().includes('capital in wallet')) capitalInWallet += ea.balance;
        else if (ea.account_name.toLowerCase().includes('retained') || ea.account_code === '500000') retainedEarnings += ea.balance;
        else otherEquity += ea.balance;
      }

      const totalCurrentAssets = bankCash + receivable + currentAssets + prepayments;
      const totalAssets = totalCurrentAssets + fixedAssets + nonCurrentAssets;
      const totalCurrentLiabilities = currentLiab + payable;
      const totalLiabilities = totalCurrentLiabilities + nonCurrentLiab;
      const totalEquity = equity + equityUnaffected + pl;

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
          equity: totalEquity,
          unallocated_earnings: equityUnaffected + pl,
          retained_earnings: retainedEarnings + otherEquity,
          share_capitals: shareCapitals,
          capital_in_wallet: capitalInWallet,
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
  router.get('/consolidated-bs', (req, res) => {
    // Use Odoo's current_balance from account_balances table (authoritative)
    // Falls back to JE computation if no balance snapshot exists
    const snapshotDate = (req.query.as_of_date as string) || '';

    // Find latest snapshot date
    const latestSnap = db.prepare(
      snapshotDate
        ? `SELECT DISTINCT snapshot_date FROM account_balances WHERE snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`
        : `SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date DESC LIMIT 1`
    ).get(...(snapshotDate ? [snapshotDate] : [])) as any;

    const useBalanceTable = !!latestSnap?.snapshot_date;
    const snapDate = latestSnap?.snapshot_date || '';

    if (useBalanceTable) {
      console.log(`[consolidated-bs] Using account_balances snapshot: ${snapDate}`);
    } else {
      console.log('[consolidated-bs] No balance snapshot found, falling back to JE computation');
    }

    // Step 1: Compute raw balances for non-subtotal groups
    const groupBalances: Record<string, Record<string, number>> = {};

    if (useBalanceTable) {
      // === USE ODOO'S AUTHORITATIVE current_balance ===
      for (const group of ENTITY_GROUPS) {
        if (group.is_subtotal) continue;

        // Handle manual entities (e.g. Xterio Foundation)
        if (group.is_manual) {
          // Xterio Foundation — hardcoded from spreadsheet (as at 28.02.2026)
          const balances: Record<string, number> = {
            'ASSETS': 5942149,
            'CURRENT_ASSETS': 5942149,
            'BANK_CASH': 5942149,
            'CASH': 5942149,
            'DIGITAL_TOKEN': 0,
            'RECEIVABLES': 0,
            'A_107010': 0, 'A_101000': 0, 'A_101010': 0,
            'CURRENT_ASSETS_OTHER': 0,
            'PREPAYMENTS': 0,
            'FIXED_ASSETS': 0,
            'NON_CURRENT_ASSETS': 0,
            'A_200000': 0, 'A_202000': 0,
            'LIABILITIES': 1369636,
            'CURRENT_LIABILITIES': 165000,
            'A_303010': 0, 'A_303011': 0, 'A_303040': 0, 'A_303041': 0,
            'A_303050': 0, 'A_303100': 0, 'A_303031': 165000,
            'A_301000': 0, 'A_302010': 0,
            'PAYABLES': 0, 'A_300030': 0,
            'NON_CURRENT_LIABILITIES': 1204636,
            'A_300040': 0, 'A_300050': 0, 'A_303030': 1204636,
            'EQUITY': 4563853,
            'EQUITY_RETAINED': -33889064,
            'A_RETAINED_EARNINGS': -33889064,
            'A_SHARE_CAPITALS': 0,
            'A_CAPITAL_IN_WALLET': 0,
            'CURRENT_YEAR_PL': 12831 + 38452916, // Current Year + Share Capitals (38,452,916)
            'LIAB_EQUITY': 5933488,
          };
          // Zero out any BS line not explicitly set
          for (const line of BS_LINES) {
            if (!(line.code in balances)) balances[line.code] = 0;
          }
          groupBalances[group.name] = balances;
          continue;
        }

        if (group.company_ids.length === 0) continue;

        // Query account_balances for this group's companies
        const placeholders = group.company_ids.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT account_code as code, account_type, SUM(balance) as balance
          FROM account_balances
          WHERE company_id IN (${placeholders}) AND snapshot_date = ?
          GROUP BY account_code, account_type
        `).all(...group.company_ids, snapDate) as any[];

        // Build lookup by account_type and by code
        const byType: Record<string, number> = {};
        const byCode: Record<string, number> = {};
        for (const r of rows) {
          byType[r.account_type] = (byType[r.account_type] || 0) + r.balance;
          byCode[r.code] = (byCode[r.code] || 0) + r.balance;
        }

        // Map BS_LINES leaf nodes
        const currentYear = new Date().getFullYear().toString();
        const balances: Record<string, number> = {};
        for (const line of BS_LINES) {
          if (line.computed_from) continue;
          if (line.odoo_types) {
            // For current_balance, no need for date_filter — Odoo already computes it
            // But we need to handle the P&L split differently
            // current_balance already includes all-time for equity, and current P&L
            if (line.date_filter === 'current_year' || line.date_filter === 'prior_years') {
              // For P&L split, use the total from Odoo (it's already correct)
              // Odoo's equity type includes retained earnings
              // Odoo's income/expense types include current P&L
              balances[line.code] = line.odoo_types.reduce((s: number, t: string) => s + (byType[t] || 0), 0);
            } else {
              balances[line.code] = line.odoo_types.reduce((s: number, t: string) => s + (byType[t] || 0), 0);
            }
          } else if (line.account_codes) {
            balances[line.code] = line.account_codes.reduce((s: number, c: string) => s + (byCode[c] || 0), 0);
          } else if (line.account_codes_prefix) {
            const prefix = line.account_codes_prefix;
            balances[line.code] = Object.entries(byCode).reduce((s: number, [code, bal]) => {
              return code.startsWith(prefix) ? s + bal : s;
            }, 0);
          }
        }

        // Resolve computed lines
        for (let pass = 0; pass < 10; pass++) {
          let resolved = 0;
          for (const line of BS_LINES) {
            if (!line.computed_from) continue;
            if (line.code in balances) continue;
            if (!line.computed_from.every((c: string) => c in balances)) continue;
            balances[line.code] = line.computed_from.reduce((s: number, c: string) => s + (balances[c] || 0), 0);
            resolved++;
          }
          if (resolved === 0) break;
        }

        groupBalances[group.name] = balances;
      }

      // Compute subtotals
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
    } else {
    // JE computation fallback (when no balance snapshot exists)
    const asOfDate = snapshotDate || '2099-12-31';
    const dateFilter = `AND je.date <= '${asOfDate.replace(/[^0-9-]/g, '')}'`;

    for (const group of ENTITY_GROUPS) {
      if (group.is_subtotal) continue;

      // Handle manual entities (e.g. Xterio Foundation)
      if (group.is_manual) {
        const latestPeriod = db.prepare(`
          SELECT period, SUM(amount_usd) as total_usd
          FROM manual_balances
          WHERE entity = ?
          GROUP BY period
          ORDER BY period DESC
          LIMIT 1
        `).get(group.name) as any;

        const balances: Record<string, number> = {};
        // Put the total as Bank & Cash for the BS
        const totalUsd = latestPeriod?.total_usd || 0;
        balances['BANK_CASH'] = totalUsd;
        // Zero out everything else
        for (const line of BS_LINES) {
          if (line.computed_from) continue;
          if (!(line.code in balances)) balances[line.code] = 0;
        }
        // Compute derived
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
        continue;
      }

      if (group.company_ids.length === 0) continue;

      const placeholders = group.company_ids.map(() => '?').join(',');

      const currentYear = new Date().getFullYear().toString();

      // All-time balances per odoo_type (up to as_of_date)
      const allTimeBalances = db.prepare(`
        SELECT a.odoo_type,
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
        FROM line_items li
        INNER JOIN journal_entries je ON je.id = li.journal_entry_id
          AND je.status = 'posted' AND je.company_id IN (${placeholders}) ${dateFilter}
        INNER JOIN accounts a ON a.id = li.account_id
        WHERE a.odoo_type != ''
        GROUP BY a.odoo_type
      `).all(...group.company_ids) as any[];

      const byTypeAll: Record<string, number> = {};
      for (const row of allTimeBalances) byTypeAll[row.odoo_type] = row.balance;

      // Current year balances per odoo_type (up to as_of_date)
      const currentYearBalances = db.prepare(`
        SELECT a.odoo_type,
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
        FROM line_items li
        INNER JOIN journal_entries je ON je.id = li.journal_entry_id
          AND je.status = 'posted' AND je.company_id IN (${placeholders})
          AND je.date >= ? ${dateFilter}
        INNER JOIN accounts a ON a.id = li.account_id
        WHERE a.odoo_type != ''
        GROUP BY a.odoo_type
      `).all(...group.company_ids, currentYear + '-01-01') as any[];

      const byTypeCY: Record<string, number> = {};
      for (const row of currentYearBalances) byTypeCY[row.odoo_type] = row.balance;

      // Also get balances per account code for account-specific lines
      const allAccountCodes = BS_LINES
        .filter(l => l.account_codes && !l.computed_from)
        .flatMap(l => l.account_codes!);
      const uniqueCodes = [...new Set(allAccountCodes)];

      const byCode: Record<string, number> = {};
      if (uniqueCodes.length > 0) {
        const codeRows = db.prepare(`
          SELECT a.code,
            COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
          FROM line_items li
          INNER JOIN journal_entries je ON je.id = li.journal_entry_id
            AND je.status = 'posted' AND je.company_id IN (${placeholders}) ${dateFilter}
          INNER JOIN accounts a ON a.id = li.account_id
          WHERE a.code IN (${uniqueCodes.map(() => '?').join(',')})
          GROUP BY a.code
        `).all(...group.company_ids, ...uniqueCodes) as any[];
        for (const r of codeRows) byCode[r.code] = r.balance;
      }

      // Map BS_LINES leaf nodes
      const balances: Record<string, number> = {};
      for (const line of BS_LINES) {
        if (line.computed_from) continue;
        if (line.odoo_types) {
          if (line.date_filter === 'current_year') {
            balances[line.code] = line.odoo_types.reduce((s: number, t: string) => s + (byTypeCY[t] || 0), 0);
          } else if (line.date_filter === 'prior_years') {
            balances[line.code] = line.odoo_types.reduce((s: number, t: string) => s + ((byTypeAll[t] || 0) - (byTypeCY[t] || 0)), 0);
          } else {
            balances[line.code] = line.odoo_types.reduce((s: number, t: string) => s + (byTypeAll[t] || 0), 0);
          }
        } else if (line.account_codes) {
          balances[line.code] = line.account_codes.reduce((s: number, c: string) => s + (byCode[c] || 0), 0);
        } else if (line.account_codes_prefix) {
          // Sum all account codes starting with this prefix
          const prefix = line.account_codes_prefix;
          balances[line.code] = Object.entries(byCode).reduce((s: number, [code, bal]) => {
            return code.startsWith(prefix) ? s + bal : s;
          }, 0);
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
    } // end of else (JE computation fallback)

    // Step 3: Compute IC elimination
    // Intercompany accounts (303xxx) should net to zero in consolidation
    const allCompanyIds = ENTITY_GROUPS.filter(g => !g.is_subtotal && !g.is_manual).flatMap(g => g.company_ids);

    const icByType: Record<string, number> = {};

    if (useBalanceTable) {
      // Use account_balances for IC elimination
      const icPlaceholders = allCompanyIds.map(() => '?').join(',');
      const icRows = db.prepare(`
        SELECT account_type, SUM(balance) as balance
        FROM account_balances
        WHERE company_id IN (${icPlaceholders}) AND snapshot_date = ? AND account_code LIKE '303%'
        GROUP BY account_type
      `).all(...allCompanyIds, snapDate) as any[];
      for (const row of icRows) icByType[row.account_type] = row.balance;
    } else {
      const icPlaceholders = allCompanyIds.map(() => '?').join(',');
      const icBalances = db.prepare(`
        SELECT a.odoo_type,
          COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
        FROM line_items li
        INNER JOIN journal_entries je ON je.id = li.journal_entry_id
          AND je.status = 'posted' AND je.company_id IN (${icPlaceholders})
        INNER JOIN accounts a ON a.id = li.account_id
        WHERE a.code LIKE '303%'
        GROUP BY a.odoo_type
      `).all(...allCompanyIds) as any[];
      for (const row of icBalances) icByType[row.odoo_type] = row.balance;
    }

    // Build IC elimination balances — negate IC amounts per odoo_type
    const icElimination: Record<string, number> = {};
    for (const line of BS_LINES) {
      if (line.computed_from) continue;
      if (line.odoo_types) {
        icElimination[line.code] = -line.odoo_types.reduce((s: number, t: string) => s + (icByType[t] || 0), 0);
      } else {
        icElimination[line.code] = 0;
      }
    }
    // Resolve computed IC elimination
    for (let pass = 0; pass < 10; pass++) {
      let resolved = 0;
      for (const line of BS_LINES) {
        if (!line.computed_from) continue;
        if (line.code in icElimination) continue;
        const allReady = line.computed_from.every((c: string) => c in icElimination);
        if (!allReady) continue;
        icElimination[line.code] = line.computed_from.reduce((s: number, c: string) => s + (icElimination[c] || 0), 0);
        resolved++;
      }
      if (resolved === 0) break;
    }

    // Step 4: Build response with IC elimination and consolidated columns
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

    const totalIdx = ENTITY_GROUPS.findIndex(g => g.name === 'Total');

    const rows = BS_LINES.map(line => {
      const entityValues = ENTITY_GROUPS.map(g => groupBalances[g.name]?.[line.code] || 0);
      const totalVal = totalIdx >= 0 ? entityValues[totalIdx] : 0;
      const icVal = icElimination[line.code] || 0;
      const consolidatedVal = totalVal + icVal;

      return {
        code: line.code,
        label: line.label,
        indent: line.indent,
        is_total: line.is_total || false,
        is_section: line.is_section || false,
        values: [...entityValues, icVal, consolidatedVal],
      };
    });

    // Add check row
    rows.push({
      code: 'CHECK',
      label: 'Check (should be 0)',
      indent: 0,
      is_total: false,
      is_section: false,
      values: [
        ...ENTITY_GROUPS.map(g => {
          const b = groupBalances[g.name] || {};
          return (b['ASSETS'] || 0) + (b['LIABILITIES'] || 0) + (b['EQUITY'] || 0);
        }),
        // IC elimination check
        (icElimination['ASSETS'] || 0) + (icElimination['LIABILITIES'] || 0) + (icElimination['EQUITY'] || 0),
        // Consolidated check
        (() => {
          const totalBal = groupBalances['Total'] || {};
          const t = (totalBal['ASSETS'] || 0) + (totalBal['LIABILITIES'] || 0) + (totalBal['EQUITY'] || 0);
          return t + (icElimination['ASSETS'] || 0) + (icElimination['LIABILITIES'] || 0) + (icElimination['EQUITY'] || 0);
        })(),
      ],
    });

    res.json({ columns, rows });
  });

  // IC Reconciliation report
  router.get('/ic-reconciliation', (_req, res) => {
    // Get intercompany balances per company per account
    const rows = db.prepare(`
      SELECT
        je.company_id, je.company_name,
        a.code, a.name,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id AND je.status = 'posted'
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.code LIKE '303%'
      GROUP BY je.company_id, je.company_name, a.code, a.name
      HAVING ABS(balance) > 0.01
      ORDER BY a.code, je.company_name
    `).all() as any[];

    // Group by IC account
    const byAccount: Record<string, { code: string; name: string; entries: any[]; total: number }> = {};
    for (const row of rows) {
      const key = row.code;
      if (!byAccount[key]) byAccount[key] = { code: row.code, name: row.name, entries: [], total: 0 };
      byAccount[key].entries.push({
        company_id: row.company_id,
        company_name: row.company_name,
        balance: row.balance,
      });
      byAccount[key].total += row.balance;
    }

    // Summary
    const accounts = Object.values(byAccount).sort((a: any, b: any) => a.code.localeCompare(b.code));
    const grandTotal = accounts.reduce((s, a) => s + a.total, 0);
    const unreconciled = accounts.filter(a => Math.abs(a.total) > 1);

    res.json({
      accounts,
      summary: {
        total_ic_accounts: accounts.length,
        unreconciled_count: unreconciled.length,
        net_unreconciled: grandTotal,
      },
    });
  });


  // ====== Cash Position Report ======
  // Entity group cash composition over time (monthly snapshots)
  router.get('/cash-position', (req, res) => {
    const months = parseInt(req.query.months as string) || 12;

    // Generate month labels
    const now = new Date();
    const monthLabels: string[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthLabels.push(d.toISOString().slice(0, 7)); // YYYY-MM
    }
    monthLabels.reverse();

    const categories = [
      { key: 'cash', label: 'Cash', filter: "a.odoo_type = 'asset_cash'" },
      { key: 'receivable', label: 'Receivables', filter: "a.odoo_type = 'asset_receivable'" },
      { key: 'current_assets', label: 'Current Assets', filter: "a.odoo_type IN ('asset_current','asset_prepayments')" },
      { key: 'non_current_assets', label: 'Non-current Assets', filter: "a.odoo_type IN ('asset_fixed','asset_non_current')" },
      { key: 'payables', label: 'Payables', filter: "a.odoo_type = 'liability_payable'" },
      { key: 'current_liabilities', label: 'Current Liabilities', filter: "a.odoo_type IN ('liability_current','liability_credit_card')" },
      { key: 'non_current_liabilities', label: 'Non-current Liabilities', filter: "a.odoo_type = 'liability_non_current'" },
      { key: 'ic_balances', label: 'IC Balances', filter: "a.code LIKE '303%'" },
    ];

    const result: any[] = [];

    for (const group of ENTITY_GROUPS) {
      if (group.is_subtotal) continue;
      if (group.company_ids.length === 0) continue;

      const placeholders = group.company_ids.map(() => '?').join(',');

      // ONE query: get monthly net changes per category
      const monthlyData: Record<string, Record<string, number>> = {};

      for (const cat of categories) {
        const rows = db.prepare(`
          SELECT strftime('%Y-%m', je.date) as month,
            SUM(li.debit) - SUM(li.credit) as net
          FROM line_items li
          INNER JOIN journal_entries je ON je.id = li.journal_entry_id
            AND je.status = 'posted' AND je.company_id IN (${placeholders})
          INNER JOIN accounts a ON a.id = li.account_id
          WHERE ${cat.filter}
          GROUP BY strftime('%Y-%m', je.date)
        `).all(...group.company_ids) as any[];

        for (const r of rows) {
          if (!monthlyData[r.month]) monthlyData[r.month] = {};
          monthlyData[r.month][cat.key] = r.net;
        }
      }

      // Build cumulative snapshots
      const cumulative: Record<string, number> = {};
      for (const cat of categories) cumulative[cat.key] = 0;

      // Get all months sorted
      const allMonths = Object.keys(monthlyData).sort();

      // Accumulate up to our display window
      for (const m of allMonths) {
        for (const cat of categories) {
          cumulative[cat.key] += monthlyData[m]?.[cat.key] || 0;
        }
      }

      // Now build snapshots for requested months
      // First reset and re-accumulate
      for (const cat of categories) cumulative[cat.key] = 0;
      const snapshots: any[] = [];

      for (const m of allMonths) {
        for (const cat of categories) {
          cumulative[cat.key] += monthlyData[m]?.[cat.key] || 0;
        }
        if (monthLabels.includes(m)) {
          const snap: any = { date: m };
          for (const cat of categories) snap[cat.key] = cumulative[cat.key];
          snap.closing = categories.reduce((s, cat) => s + cumulative[cat.key], 0);
          snapshots.push(snap);
        }
      }

      // Monthly burn
      const last3 = snapshots.slice(-3);
      let avgBurn = 0;
      if (last3.length >= 2) {
        const expRow = db.prepare(`
          SELECT COALESCE(SUM(li.debit) - SUM(li.credit), 0) as total
          FROM line_items li
          INNER JOIN journal_entries je ON je.id = li.journal_entry_id
            AND je.status = 'posted' AND je.company_id IN (${placeholders})
            AND je.date >= ?
          INNER JOIN accounts a ON a.id = li.account_id
          WHERE a.odoo_type IN ('expense', 'expense_direct_cost')
        `).get(...group.company_ids, last3[0].date + '-01') as any;
        avgBurn = (expRow?.total || 0) / last3.length;
      }

      const lastClosing = snapshots.length > 0 ? snapshots[snapshots.length - 1].closing : 0;

      result.push({
        group: group.name,
        company_ids: group.company_ids,
        snapshots,
        monthly_burn: avgBurn,
        available_balance: lastClosing,
        runway_months: avgBurn > 0 ? Math.round(lastClosing / avgBurn) : null,
      });
    }

    // Add subtotals
    for (const group of ENTITY_GROUPS) {
      if (!group.is_subtotal || !group.subtotal_groups) continue;
      const children = result.filter(r => group.subtotal_groups!.includes(r.group));
      if (children.length === 0) continue;

      const snapshots = monthLabels.map((m) => {
        const snap: any = { date: m };
        for (const cat of categories) {
          snap[cat.key] = children.reduce((s: number, c: any) => {
            const cs = c.snapshots.find((x: any) => x.date === m);
            return s + (cs?.[cat.key] || 0);
          }, 0);
        }
        snap.closing = categories.reduce((s, cat) => s + (snap[cat.key] || 0), 0);
        return snap;
      }).filter((s: any) => Math.abs(s.closing) > 0.01 || categories.some(c => Math.abs(s[c.key]) > 0.01));

      const totalBurn = children.reduce((s: number, c: any) => s + (c.monthly_burn || 0), 0);
      const lastClosing = snapshots.length > 0 ? snapshots[snapshots.length - 1].closing : 0;

      result.push({
        group: group.name,
        is_subtotal: true,
        snapshots,
        monthly_burn: totalBurn,
        available_balance: lastClosing,
        runway_months: totalBurn > 0 ? Math.round(lastClosing / totalBurn) : null,
      });
    }

    res.json({ months: monthLabels, categories, groups: result });
  });

  // ====== Bank Account Detail ======
  router.get('/bank-accounts', (req, res) => {
    const requestedDate = (req.query.as_of_date as string) || '';
    const priorDate = req.query.prior_date as string || (() => {
      const d = new Date(); d.setDate(d.getDate() - 7);
      return d.toISOString().slice(0, 10);
    })();

    // Use account_balances if available
    const snap = db.prepare(
      requestedDate
        ? `SELECT DISTINCT snapshot_date FROM account_balances WHERE snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`
        : `SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date DESC LIMIT 1`
    ).get(...(requestedDate ? [requestedDate] : [])) as any;

    const priorSnap = db.prepare(
      `SELECT DISTINCT snapshot_date FROM account_balances WHERE snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`
    ).get(priorDate) as any;

    if (snap?.snapshot_date) {
      // Use account_balances
      // Get ALL cash accounts from both current and prior snapshots
      const currentRows = db.prepare(`
        SELECT company_id, company_name, account_code as code, account_name as name, account_type, balance
        FROM account_balances
        WHERE snapshot_date = ? AND account_type = 'asset_cash' AND ABS(balance) > 0.01
        ORDER BY company_name, account_code
      `).all(snap.snapshot_date) as any[];

      const priorRows = priorSnap?.snapshot_date ? db.prepare(`
        SELECT company_id, company_name, account_code as code, account_name as name, account_type, balance
        FROM account_balances
        WHERE snapshot_date = ? AND account_type = 'asset_cash' AND ABS(balance) > 0.01
      `).all(priorSnap.snapshot_date) as any[] : [];

      // Build maps for both snapshots
      const currentMap: Record<string, any> = {};
      for (const r of currentRows) currentMap[r.company_id + '|' + r.code] = r;

      const priorMap: Record<string, any> = {};
      for (const r of priorRows) priorMap[r.company_id + '|' + r.code] = r;

      // Merge: all accounts from both snapshots
      const allKeys = new Set([...Object.keys(currentMap), ...Object.keys(priorMap)]);

      // Map to entity groups
      const companyToGroup: Record<number, string> = {};
      for (const g of ENTITY_GROUPS) {
        if (g.is_subtotal || g.is_manual) continue;
        for (const cid of g.company_ids) companyToGroup[cid] = g.name;
      }

      const accounts: any[] = [];
      for (const key of allKeys) {
        const cur = currentMap[key];
        const pri = priorMap[key];
        const row = cur || pri;
        const currentBal = cur?.balance || 0;
        const priorBal = pri?.balance || 0;
        const change = currentBal - priorBal;
        const changePct = priorBal !== 0 ? ((change / Math.abs(priorBal)) * 100) : 0;

        accounts.push({
          entity_group: companyToGroup[row.company_id] || 'Other',
          company_name: row.company_name,
          code: row.code,
          name: row.name,
          current_balance: currentBal,
          prior_balance: priorBal,
          change, change_pct: changePct,
          asset_type: row.code.startsWith('10W') ? 'Crypto' : 'Cash',
        });
      }

      const byGroup: Record<string, any[]> = {};
      for (const a of accounts) {
        if (!byGroup[a.entity_group]) byGroup[a.entity_group] = [];
        byGroup[a.entity_group].push(a);
      }

      const groups = Object.entries(byGroup).map(([name, accs]) => ({
        name,
        accounts: accs,
        total_current: accs.reduce((s: number, a: any) => s + a.current_balance, 0),
        total_prior: accs.reduce((s: number, a: any) => s + a.prior_balance, 0),
        total_cash_current: accs.filter((a: any) => a.code.startsWith('100')).reduce((s: number, a: any) => s + a.current_balance, 0),
        total_crypto_current: accs.filter((a: any) => a.code.startsWith('10W')).reduce((s: number, a: any) => s + a.current_balance, 0),
        total_all: accs.reduce((s: number, a: any) => s + a.current_balance, 0),
      }));

      groups.sort((a, b) => Math.abs(b.total_current) - Math.abs(a.total_current));
      return res.json({ snapshot_date: snap.snapshot_date, prior_date: priorSnap?.snapshot_date || priorDate, groups });
    }

    // Fallback to old JE-based computation

    const rows = db.prepare(`
      SELECT
        a.code, a.name, a.odoo_type,
        je.company_name,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as current_balance
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id AND je.status = 'posted'
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type = 'asset_cash'
      GROUP BY a.code, a.name, a.odoo_type, je.company_name
      HAVING ABS(current_balance) > 0.01
      ORDER BY je.company_name, a.code
    `).all() as any[];

    // Get prior balances
    const priorRows = db.prepare(`
      SELECT
        a.code, a.name,
        je.company_name,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id AND je.status = 'posted' AND je.date <= ?
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type = 'asset_cash'
      GROUP BY a.code, a.name, je.company_name
      HAVING ABS(balance) > 0.01
    `).all(priorDate) as any[];

    const priorMap: Record<string, number> = {};
    for (const r of priorRows) priorMap[r.company_name + '|' + r.code] = r.balance;

    // Map to entity groups
    const companyToGroup: Record<string, string> = {};
    for (const g of ENTITY_GROUPS) {
      if (g.is_subtotal) continue;
      for (const cid of g.company_ids) {
        // Find company name from data
        const match = rows.find((r: any) => {
          const companyRow = db.prepare('SELECT company_name FROM journal_entries WHERE company_id = ? LIMIT 1').get(cid) as any;
          return companyRow?.company_name === r.company_name;
        });
        if (match) companyToGroup[match.company_name] = g.name;
      }
    }
    // Fallback: map by company name lookup
    const companyMap = db.prepare('SELECT DISTINCT company_id, company_name FROM journal_entries WHERE company_id IS NOT NULL').all() as any[];
    for (const c of companyMap) {
      for (const g of ENTITY_GROUPS) {
        if (g.is_subtotal) continue;
        if (g.company_ids.includes(c.company_id)) {
          companyToGroup[c.company_name] = g.name;
          break;
        }
      }
    }

    const accounts = rows.map((r: any) => {
      const key = r.company_name + '|' + r.code;
      const prior = priorMap[key] || 0;
      const change = r.current_balance - prior;
      const changePct = prior !== 0 ? ((change / Math.abs(prior)) * 100) : 0;
      return {
        entity_group: companyToGroup[r.company_name] || 'Other',
        company_name: r.company_name,
        code: r.code,
        name: r.name,
        current_balance: r.current_balance,
        prior_balance: prior,
        change,
        change_pct: changePct,
      };
    });

    // Group by entity group
    const byGroup: Record<string, any[]> = {};
    for (const a of accounts) {
      if (!byGroup[a.entity_group]) byGroup[a.entity_group] = [];
      byGroup[a.entity_group].push(a);
    }

    const groups = Object.entries(byGroup).map(([name, accs]) => ({
      name,
      accounts: accs,
      total_current: accs.reduce((s: number, a: any) => s + a.current_balance, 0),
      total_prior: accs.reduce((s: number, a: any) => s + a.prior_balance, 0),
    }));

    groups.sort((a, b) => Math.abs(b.total_current) - Math.abs(a.total_current));

    res.json({ prior_date: priorDate, groups });
  });

  // Xterio Foundation manual data
  router.get('/xterio-foundation', (_req, res) => {
    const rows = db.prepare(`
      SELECT entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category
      FROM manual_balances
      WHERE entity = 'Xterio Foundation'
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

  // List available balance snapshots
  router.get('/snapshots', (_req, res) => {
    const snaps = db.prepare(`
      SELECT DISTINCT snapshot_date, COUNT(*) as account_count
      FROM account_balances
      GROUP BY snapshot_date
      ORDER BY snapshot_date DESC
    `).all();
    res.json(snaps);
  });

  // Executive summary for CEO dashboard
  router.get('/executive-summary', (req, res) => {
    const requestedDate = (req.query.as_of_date as string) || '';

    // Find matching snapshot
    const snapQuery = requestedDate
      ? db.prepare(`SELECT DISTINCT snapshot_date FROM account_balances WHERE snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`).get(requestedDate) as any
      : db.prepare(`SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date DESC LIMIT 1`).get() as any;
    const currentSnap = snapQuery?.snapshot_date;
    if (!currentSnap) return res.json({});

    // Find prior snapshot (the one before current)
    const priorQuery = db.prepare(`SELECT DISTINCT snapshot_date FROM account_balances WHERE snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1`).get(currentSnap) as any;
    const priorSnap = priorQuery?.snapshot_date;

    // Company to group mapping
    const companyToGroup: Record<number, string> = {};
    for (const g of ENTITY_GROUPS) {
      if (g.is_subtotal || g.is_manual) continue;
      for (const cid of g.company_ids) companyToGroup[cid] = g.name;
    }

    const xterioGroups = new Set(['LTECH, LTECH W3', 'AOD', 'XLABS, XLAB W3', 'PRIVILEGE HK']);
    const holdingsGroups = new Set(['CS', 'Palios', 'LHOLDINGS', 'QUANTUMMIND']);
    const nonOWGroups = new Set([...xterioGroups, ...holdingsGroups]);
    const owGroups = new Set(['OW', 'Reach', 'Rough house', 'Keystone']);
    const xterioFoundationCash = 5942149;

    // Helper: get all company IDs for a group set
    const getCompanyIds = (groups: Set<string>) =>
      ENTITY_GROUPS.filter(g => groups.has(g.name) && !g.is_subtotal && !g.is_manual).flatMap(g => g.company_ids);

    const nonOWCompanyIds = getCompanyIds(nonOWGroups);
    const owCompanyIds = getCompanyIds(owGroups);
    const xterioCompanyIds = getCompanyIds(xterioGroups);
    const holdingsCompanyIds = getCompanyIds(holdingsGroups);

    // === NET ASSETS for each group ===
    const netAssetTypes = `'asset_cash','asset_receivable','asset_current','asset_prepayments','asset_fixed','asset_non_current','liability_current','liability_payable','liability_non_current','liability_credit_card'`;
    // OW excludes fixed/non-current assets (project capitalization)
    const owNetAssetTypes = `'asset_cash','asset_receivable','asset_current','asset_prepayments','liability_current','liability_payable','liability_non_current','liability_credit_card'`;

    const netAssetsRows = db.prepare(`
      SELECT company_id, SUM(balance) as total
      FROM account_balances
      WHERE snapshot_date = ? AND account_type IN (${netAssetTypes})
      GROUP BY company_id
    `).all(currentSnap) as any[];

    const owNetAssetsRows = db.prepare(`
      SELECT company_id, SUM(balance) as total
      FROM account_balances
      WHERE snapshot_date = ? AND account_type IN (${owNetAssetTypes})
      GROUP BY company_id
    `).all(currentSnap) as any[];

    let xterioNetAssets = xterioFoundationCash;
    let holdingsNetAssets = 0;
    for (const r of netAssetsRows) {
      const group = companyToGroup[r.company_id] || 'Other';
      if (xterioGroups.has(group)) xterioNetAssets += r.total;
      if (holdingsGroups.has(group)) holdingsNetAssets += r.total;
    }

    let owNetAssets = 0;
    for (const r of owNetAssetsRows) {
      const group = companyToGroup[r.company_id] || 'Other';
      if (owGroups.has(group)) owNetAssets += r.total;
    }

    // === PRIOR NET ASSETS ===
    let priorXterioNetAssets = xterioFoundationCash;
    let priorHoldingsNetAssets = 0;
    let priorOWNetAssets = 0;
    if (priorSnap) {
      const priorNARows = db.prepare(`
        SELECT company_id, SUM(balance) as total
        FROM account_balances
        WHERE snapshot_date = ? AND account_type IN (${netAssetTypes})
        GROUP BY company_id
      `).all(priorSnap) as any[];
      for (const r of priorNARows) {
        const group = companyToGroup[r.company_id] || 'Other';
        if (xterioGroups.has(group)) priorXterioNetAssets += r.total;
        if (holdingsGroups.has(group)) priorHoldingsNetAssets += r.total;
      }
      const priorOWNARows = db.prepare(`
        SELECT company_id, SUM(balance) as total
        FROM account_balances
        WHERE snapshot_date = ? AND account_type IN (${owNetAssetTypes})
        GROUP BY company_id
      `).all(priorSnap) as any[];
      for (const r of priorOWNARows) {
        const group = companyToGroup[r.company_id] || 'Other';
        if (owGroups.has(group)) priorOWNetAssets += r.total;
      }
    }

    // === WATERFALL: Net Assets → Cash breakdown (non-OW only) ===
    const nonOWPlaceholders = nonOWCompanyIds.map(() => '?').join(',');
    const waterfallQuery = (accountFilter: string) =>
      nonOWCompanyIds.length > 0
        ? (db.prepare(`SELECT SUM(balance) as total FROM account_balances WHERE snapshot_date = ? AND company_id IN (${nonOWPlaceholders}) AND ${accountFilter}`).get(currentSnap, ...nonOWCompanyIds) as any)?.total || 0
        : 0;

    const totalReceivable = waterfallQuery(`account_type = 'asset_receivable'`);
    const totalPayable = waterfallQuery(`account_type IN ('liability_payable', 'liability_current')`);
    const totalIntercompany = waterfallQuery(`account_code LIKE '303%'`);
    const totalDeposit = waterfallQuery(`account_code = '202000'`);
    const totalCashFiat = waterfallQuery(`account_type = 'asset_cash' AND account_code LIKE '100%'`) + xterioFoundationCash;
    const totalCashCrypto = waterfallQuery(`account_type = 'asset_cash' AND account_code LIKE '10W%'`);
    const totalCashAll = totalCashFiat + totalCashCrypto;

    // === BACKWARD COMPAT: cash by entity group for chart ===
    const cashRows = db.prepare(`
      SELECT company_id, SUM(balance) as cash
      FROM account_balances
      WHERE snapshot_date = ? AND account_type = 'asset_cash'
      GROUP BY company_id
    `).all(currentSnap) as any[];

    const groupCash: Record<string, number> = {};
    let owCash = 0;
    for (const r of cashRows) {
      const group = companyToGroup[r.company_id] || 'Other';
      groupCash[group] = (groupCash[group] || 0) + r.cash;
      if (owGroups.has(group)) owCash += r.cash;
    }

    // Monthly burn
    const burnRow = db.prepare(`
      SELECT SUM(ABS(balance)) as burn FROM account_balances
      WHERE snapshot_date = ? AND account_type IN ('expense', 'expense_direct_cost')
    `).get(currentSnap) as any;
    const entryDates = db.prepare(`SELECT MIN(date) as first, MAX(date) as last FROM journal_entries WHERE status = 'posted'`).get() as any;
    let monthlyBurn = 0;
    if (entryDates.first && entryDates.last) {
      const firstDate = new Date(entryDates.first);
      const lastDate = new Date(entryDates.last);
      const months = Math.max(1, (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + lastDate.getMonth() - firstDate.getMonth());
      monthlyBurn = (burnRow?.burn || 0) / months;
    }

    const nonOWTotal = totalCashFiat;
    const runway = monthlyBurn > 0 ? Math.round(nonOWTotal / monthlyBurn) : null;

    // Overdrawn accounts (alerts)
    const overdrawn = db.prepare(`
      SELECT company_name, account_code, account_name, balance
      FROM account_balances
      WHERE snapshot_date = ? AND account_type = 'asset_cash' AND balance < -1000
      ORDER BY balance ASC LIMIT 10
    `).all(currentSnap) as any[];

    // IC imbalances
    const icImbalances = db.prepare(`
      SELECT account_code, account_name, SUM(balance) as net
      FROM account_balances
      WHERE snapshot_date = ? AND account_code LIKE '303%'
      GROUP BY account_code, account_name
      HAVING ABS(net) > 10000
      ORDER BY ABS(net) DESC LIMIT 5
    `).all(currentSnap) as any[];

    // Cash by entity group for chart — split into bank and crypto
    const entityCash: any[] = [];
    // Get per-entity bank vs crypto split
    const entityDetailRows = db.prepare(`
      SELECT company_id, account_code, balance
      FROM account_balances
      WHERE snapshot_date = ? AND account_type = 'asset_cash' AND ABS(balance) > 0.01
    `).all(currentSnap) as any[];

    const entityBankCash: Record<string, number> = {};
    const entityCryptoCash: Record<string, number> = {};
    for (const r of entityDetailRows) {
      const group = companyToGroup[r.company_id] || 'Other';
      if (r.account_code.startsWith('10W')) {
        entityCryptoCash[group] = (entityCryptoCash[group] || 0) + r.balance;
      } else {
        entityBankCash[group] = (entityBankCash[group] || 0) + r.balance;
      }
    }

    for (const g of ENTITY_GROUPS) {
      if (g.is_subtotal || g.is_manual) continue;
      const bank = entityBankCash[g.name] || 0;
      const crypto = entityCryptoCash[g.name] || 0;
      const total = bank + crypto;
      if (Math.abs(total) > 100) {
        entityCash.push({ name: g.name, cash: total, bank, crypto });
      }
    }
    entityCash.sort((a, b) => b.cash - a.cash);

    // Cash trend from snapshots — aggregated weekly (use latest snapshot per ISO week)
    const allSnaps = db.prepare(`SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date`).all() as any[];
    // Group snapshots by ISO week, keep only the latest snapshot per week
    const weeklySnaps: any[] = [];
    const seenWeeks = new Set<string>();
    for (let i = allSnaps.length - 1; i >= 0; i--) {
      const d = new Date(allSnaps[i].snapshot_date + 'T00:00:00Z');
      const year = d.getUTCFullYear();
      const jan1 = new Date(Date.UTC(year, 0, 1));
      const weekNum = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
      const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;
      if (!seenWeeks.has(weekKey)) {
        seenWeeks.add(weekKey);
        weeklySnaps.unshift(allSnaps[i]);
      }
    }
    const cashTrend = weeklySnaps.map((s: any) => {
      const row = db.prepare(`
        SELECT SUM(CASE WHEN company_id IN (${Array.from(nonOWGroups).flatMap(g => ENTITY_GROUPS.find(eg => eg.name === g)?.company_ids || []).join(',')}) THEN balance ELSE 0 END) as non_ow,
               SUM(CASE WHEN company_id IN (${Array.from(owGroups).flatMap(g => ENTITY_GROUPS.find(eg => eg.name === g)?.company_ids || []).join(',')}) THEN balance ELSE 0 END) as ow
        FROM account_balances WHERE snapshot_date = ? AND account_type = 'asset_cash'
      `).get(s.snapshot_date) as any;
      return { date: s.snapshot_date, non_ow: (row?.non_ow || 0) + xterioFoundationCash, ow: row?.ow || 0 };
    });

    res.json({
      snapshot_date: currentSnap,
      prior_date: priorSnap,
      // Net Assets per group
      xterio_net_assets: xterioNetAssets,
      xterio_net_assets_prior: priorXterioNetAssets,
      foundation_net_assets: xterioFoundationCash,
      foundation_net_assets_prior: xterioFoundationCash,
      holdings_net_assets: holdingsNetAssets,
      holdings_net_assets_prior: priorHoldingsNetAssets,
      ow_net_assets: owNetAssets,
      ow_net_assets_prior: priorOWNetAssets,
      // Waterfall: Net Assets → Cash
      total_net_assets: xterioNetAssets + holdingsNetAssets,
      total_receivable: totalReceivable,
      total_payable: totalPayable,
      total_intercompany: totalIntercompany,
      total_deposit: totalDeposit,
      total_cash_fiat: totalCashFiat,
      total_cash_crypto: totalCashCrypto,
      total_cash_all: totalCashAll,
      // Backward compat
      non_ow_cash: nonOWTotal,
      ow_cash: owCash,
      // Burn & runway
      monthly_burn: monthlyBurn,
      runway_months: runway,
      entity_cash: entityCash,
      cash_trend: cashTrend,
      alerts: {
        overdrawn,
        ic_imbalances: icImbalances,
      },
    });
  });

  // OW Closing Balance history — breakdown by line item across snapshots
  router.get('/ow-closing', (req, res) => {
    const owCompanyIds = ENTITY_GROUPS
      .filter(g => ['OW', 'Reach', 'Rough house', 'Keystone'].includes(g.name) && !g.is_subtotal)
      .flatMap(g => g.company_ids);

    if (owCompanyIds.length === 0) return res.json({ snapshots: [] });

    const placeholders = owCompanyIds.map(() => '?').join(',');

    // Get all available snapshot dates
    const snapDates = db.prepare(
      `SELECT DISTINCT snapshot_date FROM account_balances WHERE company_id IN (${placeholders}) ORDER BY snapshot_date`
    ).all(...owCompanyIds) as any[];

    const snapshots = snapDates.map((s: any) => {
      const rows = db.prepare(`
        SELECT account_code as code, account_name as name, account_type, SUM(balance) as balance
        FROM account_balances
        WHERE snapshot_date = ? AND company_id IN (${placeholders}) AND ABS(balance) > 0.01
        GROUP BY account_code, account_name, account_type
        ORDER BY account_code
      `).all(s.snapshot_date, ...owCompanyIds) as any[];

      // Categorize into closing balance line items
      let cash = 0, orFromXterio = 0, ar = 0, noteReceivable = 0;
      let payables = 0, accrualExp = 0, thrackle = 0, otherAssets = 0, otherLiabilities = 0;

      for (const r of rows) {
        const code = r.code;
        const bal = r.balance;

        // Cash (asset_cash)
        if (r.account_type === 'asset_cash') {
          cash += bal;
        }
        // OR From Xterio (intercompany 303030, 303031, 303040, 303041 etc.)
        else if (code.startsWith('303')) {
          orFromXterio += bal;
        }
        // AR (101000, 101010)
        else if (code === '101000' || code === '101010') {
          ar += bal;
        }
        // Accrued Expenses (301000)
        else if (code === '301000') {
          accrualExp += bal;
        }
        // Trade/Accounts Payable (300000, 300030)
        else if (code === '300000' || code === '300030') {
          payables += bal;
        }
        // Thrackle Loan / Other non-current liabilities (300040, 300050)
        else if (code === '300040' || code === '300050') {
          thrackle += bal;
        }
        // Note receivable and other current assets
        else if (r.account_type === 'asset_receivable' || r.account_type === 'asset_current' || r.account_type === 'asset_prepayments') {
          noteReceivable += bal;
        }
        // Other assets
        else if (r.account_type?.startsWith('asset_')) {
          otherAssets += bal;
        }
        // Other liabilities
        else if (r.account_type?.startsWith('liability_')) {
          otherLiabilities += bal;
        }
      }

      const total = cash + orFromXterio + ar + noteReceivable + payables + accrualExp + thrackle + otherAssets + otherLiabilities;

      return {
        date: s.snapshot_date,
        cash,
        or_from_xterio: orFromXterio,
        ar,
        note_receivable: noteReceivable,
        payables,
        accrual_exp: accrualExp,
        thrackle_loan: thrackle,
        other_assets: otherAssets,
        other_liabilities: otherLiabilities,
        total,
      };
    });

    // Monthly burn estimate (latest 2 months)
    let monthlyBurn = 250000; // default
    if (snapshots.length >= 2) {
      const latest = snapshots[snapshots.length - 1];
      const prior = snapshots[snapshots.length - 2];
      const daysDiff = (new Date(latest.date).getTime() - new Date(prior.date).getTime()) / 86400000;
      if (daysDiff > 0) {
        const dailyBurn = (prior.total - latest.total) / daysDiff;
        monthlyBurn = Math.max(0, dailyBurn * 30);
      }
    }

    const latestTotal = snapshots.length > 0 ? snapshots[snapshots.length - 1].total : 0;
    const availableBalance = latestTotal;
    const runwayMonths = monthlyBurn > 0 ? Math.round(availableBalance / monthlyBurn) : null;

    res.json({
      snapshots,
      summary: {
        available_balance: availableBalance,
        monthly_burn: monthlyBurn,
        runway_months: runwayMonths,
      },
    });
  });

  return router;
}
