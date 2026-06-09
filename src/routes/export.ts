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
  router.get('/tb', (req, res) => {
    const month = req.query.month as string;
    const companiesParam = req.query.companies as string;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month required (YYYY-MM)' });
    }

    const endOfMonth = month + '-31';
    const startOfMonth = month + '-01';
    let companyFilter = '';
    let params: any[] = [endOfMonth, startOfMonth];

    if (companiesParam) {
      const ids = companiesParam.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (ids.length > 0) {
        companyFilter = `AND company_id IN (${ids.map(() => '?').join(',')})`;
        params = [endOfMonth, startOfMonth, ...ids];
      }
    }

    // For each company+account, get the snapshot closest to end of month
    const rows = db.prepare(`
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
        WHERE snapshot_date <= ? AND snapshot_date >= ?
        ${companyFilter}
        GROUP BY company_id, account_odoo_id
      ) latest ON ab.company_id = latest.company_id
        AND ab.account_odoo_id = latest.account_odoo_id
        AND ab.snapshot_date = latest.max_date
      ORDER BY ab.company_name, ab.account_code
    `).all(...params) as any[];

    if (rows.length === 0) {
      // Provide helpful info: what months have balance data for the requested companies?
      const availRows = db.prepare(`
        SELECT DISTINCT substr(snapshot_date,1,7) as month, company_name
        FROM account_balances
        WHERE company_id IN (${companiesParam ? companiesParam.split(',').map(() => '?').join(',') : '?'})
        ORDER BY month DESC LIMIT 12
      `).all(...(companiesParam ? companiesParam.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [])) as any[];
      const availMonths = [...new Set((availRows as any[]).map((r: any) => r.month))].slice(0,6);
      return res.status(404).json({
        error: `No TB snapshot found for ${month}. Available months: ${availMonths.join(', ') || 'none'}`
      });
    }

    const headers = ['Company ID', 'Company Name', 'Account Code', 'Account Name', 'Account Type', 'Currency', 'Balance', 'Snapshot Date'];
    const csvLines = [
      csvRow(headers),
      ...rows.map(r => csvRow([r.company_id, r.company_name, r.account_code, r.account_name, r.account_type, r.currency, r.balance, r.snapshot_date]))
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="TB_${month}.csv"`);
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
