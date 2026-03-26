import { Router } from 'express';
import Database from 'better-sqlite3';

// Period grouping SQL expressions
function periodExpr(period: string): string {
  switch (period) {
    case 'daily': return "je.date";
    case 'weekly': return "strftime('%Y-W%W', je.date)";
    case 'monthly': default: return "strftime('%Y-%m', je.date)";
  }
}

export function reportingRoutes(db: Database.Database): Router {
  const router = Router();

  // ====== Revenue & Expenses by period ======
  router.get('/revenue-expenses', (req, res) => {
    const period = (req.query.period as string) || 'monthly';
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const pExpr = periodExpr(period);

    let dateFilter = '';
    const params: any[] = [];
    if (dateFrom) { dateFilter += ' AND je.date >= ?'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND je.date <= ?'; params.push(dateTo); }
    if (companyId) { dateFilter += ' AND je.company_id = ?'; params.push(parseInt(companyId)); }

    const rows = db.prepare(`
      SELECT
        ${pExpr} as period,
        a.odoo_type,
        SUM(li.debit) as total_debit,
        SUM(li.credit) as total_credit
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted' ${dateFilter}
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type IN ('income', 'income_other', 'expense', 'expense_direct_cost')
      GROUP BY ${pExpr}, a.odoo_type
      ORDER BY period ASC
    `).all(...params) as any[];

    const periods: Record<string, any> = {};
    for (const row of rows) {
      if (!periods[row.period]) periods[row.period] = { period: row.period, revenue: 0, other_income: 0, expenses: 0, direct_costs: 0, net_income: 0 };
      const p = periods[row.period];
      if (row.odoo_type === 'income') p.revenue += (row.total_credit - row.total_debit);
      else if (row.odoo_type === 'income_other') p.other_income += (row.total_credit - row.total_debit);
      else if (row.odoo_type === 'expense') p.expenses += (row.total_debit - row.total_credit);
      else if (row.odoo_type === 'expense_direct_cost') p.direct_costs += (row.total_debit - row.total_credit);
    }

    const result = Object.values(periods).map((p: any) => {
      p.total_revenue = p.revenue + p.other_income;
      p.total_expenses = p.expenses + p.direct_costs;
      p.net_income = p.total_revenue - p.total_expenses;
      return p;
    });

    res.json(result);
  });

  // ====== P&L by period ======
  router.get('/pnl', (req, res) => {
    const period = (req.query.period as string) || 'monthly';
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const pExpr = periodExpr(period);

    let dateFilter = '';
    const params: any[] = [];
    if (dateFrom) { dateFilter += ' AND je.date >= ?'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND je.date <= ?'; params.push(dateTo); }
    if (companyId) { dateFilter += ' AND je.company_id = ?'; params.push(parseInt(companyId)); }

    // Get P&L by account code per period
    const rows = db.prepare(`
      SELECT
        ${pExpr} as period,
        a.code, a.name, a.odoo_type,
        SUM(li.debit) as total_debit,
        SUM(li.credit) as total_credit,
        CASE
          WHEN a.odoo_type IN ('income','income_other') THEN SUM(li.credit) - SUM(li.debit)
          ELSE SUM(li.debit) - SUM(li.credit)
        END as amount
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted' ${dateFilter}
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type IN ('income','income_other','expense','expense_direct_cost')
      GROUP BY ${pExpr}, a.code, a.name, a.odoo_type
      HAVING amount != 0
      ORDER BY period ASC, a.odoo_type, a.code
    `).all(...params) as any[];

    res.json(rows);
  });

  // ====== Balance Sheet by period (snapshot at each period end) ======
  router.get('/balance-sheet-series', (req, res) => {
    const period = (req.query.period as string) || 'monthly';
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const pExpr = periodExpr(period);

    let dateFilter = '';
    const params: any[] = [];
    if (dateFrom) { dateFilter += ' AND je.date >= ?'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND je.date <= ?'; params.push(dateTo); }
    if (companyId) { dateFilter += ' AND je.company_id = ?'; params.push(parseInt(companyId)); }

    // Get cumulative balances by period for BS account types
    const bsTypes = ['asset_cash','asset_receivable','asset_current','asset_prepayments','asset_fixed','asset_non_current',
      'liability_current','liability_credit_card','liability_payable','liability_non_current',
      'equity','equity_unaffected'];

    const typePlaceholders = bsTypes.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT
        ${pExpr} as period,
        a.odoo_type,
        SUM(li.debit) - SUM(li.credit) as net_change
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted' ${dateFilter}
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type IN (${typePlaceholders})
      GROUP BY ${pExpr}, a.odoo_type
      ORDER BY period ASC
    `).all(...params, ...bsTypes) as any[];

    // Build cumulative snapshots
    const allPeriods = [...new Set(rows.map(r => r.period))].sort();
    const cumulative: Record<string, number> = {};

    const snapshots = allPeriods.map(p => {
      const periodRows = rows.filter(r => r.period === p);
      for (const r of periodRows) {
        cumulative[r.odoo_type] = (cumulative[r.odoo_type] || 0) + r.net_change;
      }

      const bankCash = cumulative['asset_cash'] || 0;
      const receivable = cumulative['asset_receivable'] || 0;
      const currentAssets = (cumulative['asset_current'] || 0) + (cumulative['asset_prepayments'] || 0);
      const fixedAssets = cumulative['asset_fixed'] || 0;
      const nonCurrentAssets = cumulative['asset_non_current'] || 0;
      const totalAssets = bankCash + receivable + currentAssets + fixedAssets + nonCurrentAssets;

      const currentLiab = (cumulative['liability_current'] || 0) + (cumulative['liability_credit_card'] || 0);
      const payables = cumulative['liability_payable'] || 0;
      const nonCurrentLiab = cumulative['liability_non_current'] || 0;
      const totalLiabilities = currentLiab + payables + nonCurrentLiab;

      const equity = (cumulative['equity'] || 0) + (cumulative['equity_unaffected'] || 0);

      return {
        period: p,
        assets: { bank_cash: bankCash, receivable, current_assets: currentAssets, fixed_assets: fixedAssets, non_current_assets: nonCurrentAssets, total: totalAssets },
        liabilities: { current: currentLiab, payables, non_current: nonCurrentLiab, total: totalLiabilities },
        equity,
      };
    });

    res.json(snapshots);
  });

  // ====== Cash flow by period ======
  router.get('/cash-flow-series', (req, res) => {
    const period = (req.query.period as string) || 'monthly';
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const pExpr = periodExpr(period);

    let dateFilter = '';
    const params: any[] = [];
    if (dateFrom) { dateFilter += ' AND je.date >= ?'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND je.date <= ?'; params.push(dateTo); }
    if (companyId) { dateFilter += ' AND je.company_id = ?'; params.push(parseInt(companyId)); }

    const rows = db.prepare(`
      SELECT
        ${pExpr} as period,
        SUM(li.debit) as inflows,
        SUM(li.credit) as outflows,
        SUM(li.debit) - SUM(li.credit) as net_flow
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted' ${dateFilter}
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE a.odoo_type = 'asset_cash'
      GROUP BY ${pExpr}
      ORDER BY period ASC
    `).all(...params) as any[];

    let balance = 0;
    const result = rows.map((r: any) => {
      balance += r.net_flow;
      return { ...r, balance };
    });

    res.json(result);
  });

  // ====== Per-account detail by period ======
  router.get('/account-detail', (req, res) => {
    const period = (req.query.period as string) || 'monthly';
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const odooType = req.query.odoo_type as string | undefined;
    const pExpr = periodExpr(period);

    let dateFilter = '';
    const params: any[] = [];
    if (dateFrom) { dateFilter += ' AND je.date >= ?'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND je.date <= ?'; params.push(dateTo); }
    if (companyId) { dateFilter += ' AND je.company_id = ?'; params.push(parseInt(companyId)); }

    let typeFilter = '';
    if (odooType) { typeFilter = ' AND a.odoo_type = ?'; params.push(odooType); }

    const rows = db.prepare(`
      SELECT
        ${pExpr} as period,
        a.code, a.name, a.odoo_type,
        SUM(li.debit) as total_debit,
        SUM(li.credit) as total_credit,
        SUM(li.debit) - SUM(li.credit) as net
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id
        AND je.status = 'posted' ${dateFilter}
      INNER JOIN accounts a ON a.id = li.account_id
      WHERE 1=1 ${typeFilter}
      GROUP BY ${pExpr}, a.code, a.name, a.odoo_type
      HAVING ABS(net) > 0.01
      ORDER BY period ASC, a.code
    `).all(...params) as any[];

    res.json(rows);
  });

  return router;
}
