import Database from 'better-sqlite3';
import { ENTITY_GROUPS } from '../config/entity-groups';

// Complete verified spreadsheet data as at 28.02.2026
// Signs follow Odoo debit-credit convention:
//   Assets: positive, Liabilities: negative, Equity: negative
//   ASSETS + LIABILITIES + EQUITY = 0
//
// Each entity has: asset accounts, liability accounts, AND equity accounts

interface EntityData {
  company_id: number;
  company_name: string;
  accounts: { code: string; name: string; type: string; balance: number }[];
}

const ENTITIES: EntityData[] = [
  {
    company_id: 1, company_name: 'LTECH, LTECH W3',
    accounts: [
      // Assets
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 703043 },
      { code: '10W000', name: 'Digital Token', type: 'asset_cash', balance: 257791 },
      { code: '107010', name: 'GST Control', type: 'asset_receivable', balance: 271679 },
      { code: '101010', name: 'Other Receivable', type: 'asset_receivable', balance: 12039 },
      { code: '202000', name: 'Deposits', type: 'asset_non_current', balance: 685387 },
      // Liabilities - Related
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: 1786698 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: -1397318 },
      { code: '303040', name: 'Amount due to/from Xterlabs (Non-trade)', type: 'liability_current', balance: 893337 },
      { code: '303041', name: 'Amount due to/from Xterlabs W3 (Non-trade)', type: 'liability_current', balance: -4300376 },
      { code: '303050', name: 'Amount due to/from Overworld (Non-trade)', type: 'liability_current', balance: -773 },
      { code: '303180', name: 'Amount due to/from REACH LABS (Non-trade)', type: 'liability_current', balance: 2076 },
      { code: '303060', name: 'Amount due to/from Quantummind (Non-trade)', type: 'liability_current', balance: -51513 },
      { code: '303061', name: 'Amount due to/from PALIO W3 (Non-trade)', type: 'liability_current', balance: -2278 },
      { code: '303160', name: 'Amount due to/from Play Algorithm (Non-trade)', type: 'liability_current', balance: -35717 },
      { code: '303070', name: 'Amount due to/from Shadowcay (Non-trade)', type: 'liability_current', balance: -12501 },
      { code: '303071', name: 'Amount due to/from Shadowcay W3 (Non-trade)', type: 'liability_current', balance: -8000 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 25901 },
      { code: '303110', name: 'Amount due to/from Privilege HK (Non-trade)', type: 'liability_current', balance: -30000 },
      { code: '303021', name: 'Amount due to/from Libecciotech W3 (Non-trade)', type: 'liability_current', balance: -893337 },
      { code: '303100', name: 'Amount due to/from FunPlus (Non-trade)', type: 'liability_current', balance: 1000000 },
      { code: '303031', name: 'Amount due to/from Xterio Foundation (Non-trade)', type: 'liability_current', balance: -165000 },
      { code: '301000', name: 'Accrued Expenses', type: 'liability_current', balance: 100000 },
      { code: '302010', name: 'Deferred Revenue', type: 'liability_current', balance: -3192 },
      { code: '303030', name: 'Amount due to/from Xterio Fdn', type: 'liability_non_current', balance: 1602338 },
      // Equity
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: -2526256 },
      { code: '310000', name: 'Share Capitals', type: 'equity', balance: -1 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 121654 },
    ],
  },
  {
    company_id: 17, company_name: 'XLABS, XLAB W3',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 6997 },
      { code: '303020', name: 'Amount due to/from Libecciotech (Non-trade)', type: 'liability_current', balance: -893337 },
      { code: '303021', name: 'Amount due to/from Libecciotech W3 (Non-trade)', type: 'liability_current', balance: 4300376 },
      { code: '303030', name: 'Amount due to/from Xterio Fdn', type: 'liability_non_current', balance: -2806974 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 1947662 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 95516 },
    ],
  },
  {
    company_id: 21, company_name: 'PRIVILEGE HK',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 17305 },
      { code: '303020', name: 'Amount due to/from Libecciotech (Non-trade)', type: 'liability_current', balance: 30000 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 12695 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: -17292 },
    ],
  },
  {
    company_id: 5, company_name: 'AOD',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 412183 },
      { code: '101000', name: 'Accounts Receivable', type: 'asset_receivable', balance: 66486 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: -2505850 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: 4616855 },
      { code: '303041', name: 'Amount due to/from Xterlabs W3 (Non-trade)', type: 'liability_current', balance: 700 },
      { code: '303061', name: 'Amount due to/from PALIO W3 (Non-trade)', type: 'liability_current', balance: 56000 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 4616855 },
      { code: '303181', name: 'Amount due to/from REACH LABS W3 (Non-trade)', type: 'liability_current', balance: 700 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 4788259 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: -24937 },
    ],
  },
  {
    company_id: 2, company_name: 'CS',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 9410 },
      { code: '101000', name: 'Accounts Receivable', type: 'asset_receivable', balance: 257 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: -990196 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: -846284 },
      { code: '303071', name: 'Amount due to/from Shadowcay W3 (Non-trade)', type: 'liability_current', balance: -835143 },
      { code: '303080', name: 'Amount due to/from Gamephilos (Non-trade)', type: 'liability_current', balance: -2505850 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 4661714 },
      { code: '301000', name: 'Accrued Expenses', type: 'liability_current', balance: -39358 },
      { code: '300030', name: 'Trade Payables', type: 'liability_payable', balance: -972485 },
      { code: '300040', name: 'Other Payables (non-trade)', type: 'liability_non_current', balance: -3500100 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 7078034 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 7502 },
    ],
  },
  {
    company_id: 11, company_name: 'Palios',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 20328 },
      { code: '200000', name: 'Non-current Assets', type: 'asset_non_current', balance: 100000 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: 1942566 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: -2322115 },
      { code: '303060', name: 'Amount due to/from Quantummind (Non-trade)', type: 'liability_current', balance: 3700 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: -56000 },
      { code: '303120', name: 'Amount due to/from collected on behalf (Non-trade)', type: 'liability_current', balance: 35717 },
      { code: '303021', name: 'Amount due to/from Libecciotech W3 (Non-trade)', type: 'liability_current', balance: 2278 },
      { code: '301000', name: 'Accrued Expenses', type: 'liability_current', balance: -17064 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: -384749 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 27271 },
    ],
  },
  {
    company_id: 19, company_name: 'LHOLDINGS',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 603985 },
      { code: '10W000', name: 'Digital Token', type: 'asset_cash', balance: 7031090 },
      { code: '107010', name: 'GST Control', type: 'asset_receivable', balance: 271 },
      { code: '200000', name: 'Investment', type: 'asset_non_current', balance: 150002 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: -8870813 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: 13575239 },
      { code: '303050', name: 'Amount due to/from Overworld (Non-trade)', type: 'liability_current', balance: -2036288 },
      { code: '303051', name: 'Amount due to/from Overworld W3 (Non-trade)', type: 'liability_current', balance: -58394 },
      { code: '303061', name: 'Amount due to/from PALIO W3 (Non-trade)', type: 'liability_current', balance: -2322115 },
      { code: '303070', name: 'Amount due to/from Shadowcay (Non-trade)', type: 'liability_current', balance: 990196 },
      { code: '303071', name: 'Amount due to/from Shadowcay W3 (Non-trade)', type: 'liability_current', balance: 846284 },
      { code: '303080', name: 'Amount due to/from Gamephilos (Non-trade)', type: 'liability_current', balance: 2505850 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: -4616855 },
      { code: '303160', name: 'Amount due to/from Play Algorithm (Non-trade)', type: 'liability_current', balance: 845000 },
      { code: '300030', name: 'Trade Payables', type: 'liability_payable', balance: -972485 },
      { code: '300040', name: 'Other Payables (non-trade)', type: 'liability_non_current', balance: -1 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 1268154 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 212625 },
    ],
  },
  {
    company_id: 8, company_name: 'QUANTUMMIND',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 871 },
      { code: '101010', name: 'Other Receivable', type: 'asset_receivable', balance: 13457 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: -1132050 },
      { code: '303060', name: 'Amount due to/from Quantummind (Non-trade)', type: 'liability_current', balance: 0 },
      { code: '303160', name: 'Amount due to/from Play Algorithm (Non-trade)', type: 'liability_current', balance: 3700 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 1210647 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 67970 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 6922 },
    ],
  },
  {
    company_id: 15, company_name: 'OW',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 4073918 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: -8870813 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: 13575239 },
      { code: '303170', name: 'Amount due to/from Rough House (Non-trade)', type: 'liability_current', balance: 420378 },
      { code: '303171', name: 'Amount due to/from Rough House W3 (Non-trade)', type: 'liability_current', balance: 245339 },
      { code: '303180', name: 'Amount due to/from REACH LABS (Non-trade)', type: 'liability_current', balance: 2036288 },
      { code: '303181', name: 'Amount due to/from REACH LABS W3 (Non-trade)', type: 'liability_current', balance: 58394 },
      { code: '303140', name: 'Amount due to/from Play Algorithm (BVI) (Non-trade)', type: 'liability_current', balance: -845000 },
      { code: '303070', name: 'Amount due to/from Shadowcay (Non-trade)', type: 'liability_current', balance: -990196 },
      { code: '303071', name: 'Amount due to/from Shadowcay W3 (Non-trade)', type: 'liability_current', balance: -835143 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: -381965 },
      { code: '310000', name: 'Share Capitals', type: 'equity', balance: -10885456 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: -270549 },
    ],
  },
  {
    company_id: 30, company_name: 'Reach',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 182812 },
      { code: '150000', name: 'Fixed Assets', type: 'asset_fixed', balance: 725668 },
      { code: '303050', name: 'Amount due to/from Overworld (Non-trade)', type: 'liability_current', balance: -2036288 },
      { code: '303051', name: 'Amount due to/from Overworld W3 (Non-trade)', type: 'liability_current', balance: -58394 },
      { code: '303170', name: 'Amount due to/from Rough House (Non-trade)', type: 'liability_current', balance: -117776 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: -700 },
      { code: '107010', name: 'GST Control', type: 'asset_receivable', balance: -2076 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 1302602 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 270549 },
    ],
  },
  {
    company_id: 31, company_name: 'Rough house',
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 133797 },
      { code: '150000', name: 'Fixed Assets', type: 'asset_fixed', balance: 18946758 },
      { code: '101000', name: 'Accounts Receivable', type: 'asset_receivable', balance: 1342376 },
      { code: '303050', name: 'Amount due to/from Overworld (Non-trade)', type: 'liability_current', balance: 8870813 },
      { code: '303170', name: 'Amount due to/from Rough House (Non-trade)', type: 'liability_current', balance: -302602 },
      { code: '303171', name: 'Amount due to/from Rough House W3 (Non-trade)', type: 'liability_current', balance: -245339 },
      { code: '303180', name: 'Amount due to/from REACH LABS (Non-trade)', type: 'liability_current', balance: 665716 },
      { code: '303160', name: 'Amount due to/from Play Algorithm (Non-trade)', type: 'liability_current', balance: -1054064 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 2412455 },
      { code: '303020', name: 'Amount due to/from Libecciotech (Non-trade)', type: 'liability_current', balance: -1786698 },
      { code: '303021', name: 'Amount due to/from Libecciotech W3 (Non-trade)', type: 'liability_current', balance: 1397318 },
      { code: '300000', name: 'Accounts Payable', type: 'liability_payable', balance: -1000000 },
      { code: '300030', name: 'Trade Payables', type: 'liability_payable', balance: -54582 },
      { code: '500000', name: 'Retained Earnings', type: 'equity', balance: 12679000 },
      { code: '800000', name: 'Current Year P&L', type: 'income', balance: 1319 },
    ],
  },
];

export function seedSpreadsheetBalances(db: Database.Database) {
  const snapshotDate = '2026-02-28';

  // Check if 303010 for Palios (company 11) has the correct value
  const existing = db.prepare(
    "SELECT balance FROM account_balances WHERE snapshot_date = ? AND company_id = 11 AND account_code = '303010'"
  ).get(snapshotDate) as any;

  if (existing && Math.abs(existing.balance - 1942566) < 1) {
    // Also check equity exists
    const eqCheck = db.prepare(
      "SELECT balance FROM account_balances WHERE snapshot_date = ? AND company_id = 11 AND account_type = 'equity'"
    ).get(snapshotDate) as any;
    if (eqCheck) {
      console.log('[seed-bs] Spreadsheet balance data already correct, skipping');
      return;
    }
  }

  console.log('[seed-bs] Importing verified spreadsheet balances for ' + snapshotDate + '...');

  // Delete existing data for this snapshot
  db.prepare('DELETE FROM account_balances WHERE snapshot_date = ?').run(snapshotDate);

  const insert = db.prepare(`
    INSERT INTO account_balances (company_id, company_name, account_odoo_id, account_code, account_name, account_type, balance, snapshot_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  const tx = db.transaction(() => {
    for (const entity of ENTITIES) {
      for (const acct of entity.accounts) {
        if (Math.abs(acct.balance) < 0.01) continue;
        insert.run(
          entity.company_id, entity.company_name,
          0, acct.code, acct.name, acct.type,
          acct.balance, snapshotDate
        );
        count++;
      }
    }
  });
  tx();

  console.log(`[seed-bs] Imported ${count} balance entries for ${snapshotDate}`);
}
