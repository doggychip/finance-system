import { Router } from 'express';
import Database from 'better-sqlite3';

export function exportRoutes(db: Database.Database): Router {
  const router = Router();

  // Helper: escape CSV field
  function csvField(v: any): string {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function csvRow(fields: any[]): string {
    return fields.map(csvField).join(',');
  }

  // GET /api/export/tb?month=YYYY-MM&companies=1,2,3
  // Trial Balance: account balances snapshot for end-of-month
  // GET /api/export/tb?month=YYYY-MM&companies=1,2,3
  // Trial Balance: P&L from tb_snapshots (Odoo fiscal-year), BS from account_balances
  router.get('/tb', (req, res) => {
    const month = req.query.month as string;
    const companiesParam = req.query.companies as string;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month required (YYYY-MM)' });
    }

    const lastDay = new Date(parseInt(month.substring(0, 4)), parseInt(month.substring(5, 7)), 0)
      .toISOString().substring(0, 10);

    const companyIds: number[] = companiesParam
      ? companiesParam.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n))
      : [];
    const bsCompanyFilter = companyIds.length > 0
      ? `AND ab.company_id IN (${companyIds.map(() => '?').join(',')})`
      : '';
    const plCompanyFilter = companyIds.length > 0
      ? `AND company_id IN (${companyIds.map(() => '?').join(',')})`
      : '';

    // BS accounts: cumulative balances from account_balances
    const bsRows = db.prepare(`
      SELECT
        ab.company_id,
        ab.company_name,
        ab.account_code,
        ab.account_name,
        ab.account_type,
        ab.currency,
        ab.balance,
        ab.snapshot_date
      FROM account_balances ab
      INNER JOIN (
        SELECT company_id, account_odoo_id, MAX(snapshot_date) as max_date
        FROM account_balances
        WHERE snapshot_date <= ?
          AND account_type NOT LIKE 'expense%'
          AND account_type NOT LIKE 'income%'
        GROUP BY company_id, account_odoo_id
      ) latest ON ab.company_id = latest.company_id
        AND ab.account_odoo_id = latest.account_odoo_id
        AND ab.snapshot_date = latest.max_date
      WHERE ab.snapshot_date <= ?
        AND ab.account_type NOT LIKE 'expense%'
        AND ab.account_type NOT LIKE 'income%'
        ${bsCompanyFilter}
      ORDER BY ab.company_name, ab.account_code
    `).all(lastDay, lastDay, ...companyIds) as any[];

    // P&L accounts: fiscal-year balances from tb_snapshots (matches Odoo TB)
    const plRows = db.prepare(`
      SELECT
        company_id,
        company_name,
        account_code,
        account_name,
        account_type,
        currency,
        balance,
        ? as snapshot_date
      FROM tb_snapshots
      WHERE period = ?
        AND (account_type LIKE 'expense%' OR account_type LIKE 'income%')
        ${plCompanyFilter}
      ORDER BY company_name, account_code
    `).all(lastDay, month, ...companyIds) as any[];

    const rows = [...bsRows, ...plRows].sort((a: any, b: any) => {
      if (a.company_name !== b.company_name) return a.company_name.localeCompare(b.company_name);
      return a.account_code.localeCompare(b.account_code);
    });

    if (rows.length === 0) {
      const availRows = db.prepare(`
        SELECT DISTINCT substr(snapshot_date,1,7) as month
        FROM account_balances
        WHERE company_id IN (${companyIds.length > 0 ? companyIds.map(() => '?').join(',') : '1'})
        ORDER BY month DESC LIMIT 12
      `).all(...companyIds) as any[];
      const availMonths = [...new Set(availRows.map((r: any) => r.month))];
      return res.status(404).json({
        error: `No TB snapshot found for ${month}. Available months: ${availMonths.join(', ') || 'none'}`
      });
    }

    const headers = ['Company ID', 'Company Name', 'Account Code', 'Account Name', 'Account Type', 'Currency', 'Balance', 'Snapshot Date'];
    const csvLines = [
      csvRow(headers),
      ...rows.map((r: any) => csvRow([r.company_id, r.company_name, r.account_code, r.account_name, r.account_type, r.currency, r.balance, r.snapshot_date]))
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tb-${month}.csv"`);
    res.send(csvLines.join('\r\n'));
  });

  // GET /api/export/journal?month=YYYY-MM&companies=1,2,3
  // Journal entry detail: all posted entries with line items for the month
  router.get('/journal', (req, res) => {
    const month = req.query.month as string;
    const companiesParam = req.query.companies as string;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month required (YYYY-MM)' });
    }

    const dateFrom = month + '-01';
    const dateTo = month + '-31';
    let companyFilter = '';
    let params: any[] = [dateFrom, dateTo];

    if (companiesParam) {
      const ids = companiesParam.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (ids.length > 0) {
        companyFilter = `AND je.company_id IN (${ids.map(() => '?').join(',')})`;
        params = [dateFrom, dateTo, ...ids];
      }
    }

    // Join journal_entries + line_items + accounts
    const rows = db.prepare(`
      SELECT
        je.company_id,
        je.company_name,
        je.date,
        je.reference,
        je.description AS entry_description,
        je.status,
        a.code AS account_code,
        a.name AS account_name,
        a.odoo_type AS account_type,
        li.debit,
        li.credit,
        li.amount_currency,
        li.currency,
        li.description AS line_description
      FROM journal_entries je
      JOIN line_items li ON li.journal_entry_id = je.id
      JOIN accounts a ON a.id = li.account_id
      WHERE je.date >= ? AND je.date <= ?
        AND je.status = 'posted'
        ${companyFilter}
      ORDER BY je.company_name, je.date, je.reference, a.code
    `).all(...params) as any[];

    if (rows.length === 0) {
      // Provide helpful info: what months have journal data for the requested companies?
      const companyIds = companiesParam ? companiesParam.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [];
      const availRows = companyIds.length > 0
        ? db.prepare(`
            SELECT DISTINCT substr(je.date,1,7) as month, je.company_name
            FROM journal_entries je
            JOIN line_items li ON li.journal_entry_id = je.id
            JOIN accounts a ON a.id = li.account_id
            WHERE je.status = 'posted'
              AND je.company_id IN (${companyIds.map(() => '?').join(',')})
            ORDER BY month DESC LIMIT 12
          `).all(...companyIds) as any[]
        : [];
      const availMonths = [...new Set(availRows.map((r: any) => r.month))].slice(0, 6);
      return res.status(404).json({
        error: `No journal entries found for ${month}. Latest available months: ${availMonths.join(', ') || 'none (journal not yet synced for these companies)'}`
      });
    }

    const headers = ['Company ID', 'Company Name', 'Date', 'Reference', 'Entry Description', 'Status', 'Account Code', 'Account Name', 'Account Type', 'Debit', 'Credit', 'Amount (Currency)', 'Currency', 'Line Description'];
    const csvLines = [
      csvRow(headers),
      ...rows.map(r => csvRow([r.company_id, r.company_name, r.date, r.reference, r.entry_description, r.status, r.account_code, r.account_name, r.account_type, r.debit, r.credit, r.amount_currency, r.currency, r.line_description]))
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Journal_${month}.csv"`);
    res.send(csvLines.join('\r\n'));
  });

  return router;
}
