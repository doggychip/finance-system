import Database from 'better-sqlite3';
import { ENTITY_GROUPS } from '../config/entity-groups';

// Verified spreadsheet data as at 28.02.2026
// Signs follow Odoo debit-credit convention: assets positive, liabilities/equity negative
const SPREADSHEET_DATA: Record<string, Record<string, number>> = {
  'LTECH, LTECH W3': {
    // Assets
    'asset_cash__100': 703043, 'asset_cash__10W': 257791,
    // Individual accounts
    '107010': 271679, '101000': 0, '101010': 12039,
    '202000': 685387, '200000': 0,
    // Liabilities - Related (303xxx)
    '303010': 1786698, '303011': -1397318, '303040': 893337, '303041': -4300376,
    '303050': -773, '303051': 0, '303180': 2076, '303181': 0,
    '303170': 0, '303171': 0, '303060': -51513, '303061': -2278,
    '303160': -35717, '303070': -12501, '303071': -8000,
    '303080': 0, '303081': 25901, '303090': 0, '303091': 0,
    '303110': -30000, '303120': 0, '303150': 0,
    '303020': 0, '303021': -893337,
    // Non-related
    '303100': 1000000, '303031': -165000,
    // Other current liab
    '301000': 100000, '300000': 0, '302010': -3192,
    // Payables
    '300030': 0,
    // Non-current
    '300040': 0, '300050': 0, '303030': 1602338,
  },
  'XLABS, XLAB W3': {
    'asset_cash__100': 6997,
    '303020': -893337, '303021': 4300376,
    '303030': -2806974,
  },
  'PRIVILEGE HK': {
    'asset_cash__100': 17305,
    '303020': 30000,
  },
  'AOD': {
    'asset_cash__100': 412183, '107010': 68, '101000': 66418,
    '303010': -2505850, '303011': 4616855, '303041': 700,
    '303061': 56000, '303081': 4616855,
  },
  'CS': {
    'asset_cash__100': 9410, '101000': 257,
    '303010': -990196, '303011': -846284, '303040': 0, '303041': 0,
    '303050': 0, '303070': 0, '303071': -835143,
    '303080': -2505850, '303081': 4661714,
    '301000': -39358, '302010': 0,
    '300030': -972485,
  },
  'Palios': {
    'asset_cash__100': 20304, '200000': 0, '202000': 0,
    'asset_non_current': 100000,
    '303010': 1942566, '303011': -2322115,
    '303060': 3700, '303081': -56000, '303120': 35717, '303021': 2278,
    '301000': -17064,
  },
  'LHOLDINGS': {
    'asset_cash__100': 603985, 'asset_cash__10W': 7031090,
    '101000': 0, '107010': 271,
    '200000': 150002, '202000': 0,
    '303010': -8870813, '303011': 13575239,
    '303050': -2036288, '303051': -58394,
    '303060': 0, '303061': -2322115,
    '303070': 990196, '303071': 846284,
    '303080': 2505850, '303081': -4616855,
    '303160': 845000,
    '300030': -972485,
    '300040': -1, '303030': 0,
  },
  'QUANTUMMIND': {
    'asset_cash__100': 871,
    '107010': 0, '101010': 0,
    '303060': 0, '303010': -1132050,
    '303160': 3700,
  },
  'OW': {
    'asset_cash__100': 4073918,
    '303010': -8870813, '303011': 13575239,
    '303050': 0, '303051': 0,
    '303170': 420378, '303171': 245339,
    '303180': 2036288, '303181': 58394,
    '303060': 0, '303061': 0,
    '303140': -845000, '303070': -990196, '303071': -835143,
    '303080': 0, '303081': 0,
    '300040': 0,
  },
  'Reach': {
    'asset_cash__100': 182812,
    'asset_fixed': 725668,
    '303050': -2036288, '303051': -58394,
    '303170': -117776, '303180': 0,
    '303081': -700,
    '107010': -2076,
  },
  'Rough house': {
    'asset_cash__100': 133797,
    'asset_fixed': 18946758,
    '101000': 1342376,
    '303050': 8870813, '303170': -302602, '303171': -245339,
    '303180': 665716,
    '303160': -1054064, '303061': 0,
    '303081': 2412455,
    '303140': 0,
    '303020': -1786698, '303021': 1397318,
    '300040': 0, '300030': -54582,
    '300000': -1000000,
  },
};

// Account type mapping for account codes
function getAccountType(code: string): string {
  if (code.startsWith('100') || code.startsWith('10W') || code.startsWith('asset_cash')) return 'asset_cash';
  if (code === '107010' || code === '101000' || code === '101010') return 'asset_receivable';
  if (code === '200000' || code === '202000') return 'asset_non_current';
  if (code === 'asset_fixed') return 'asset_fixed';
  if (code === 'asset_non_current') return 'asset_non_current';
  if (code.startsWith('303') || code === '301000' || code === '302010') return 'liability_current';
  if (code === '300000' || code === '300030') return 'liability_payable';
  if (code === '300040' || code === '300050') return 'liability_non_current';
  return 'asset_current';
}

// Company IDs per entity group
const COMPANY_MAP: Record<string, number> = {};
for (const g of ENTITY_GROUPS) {
  if (g.is_subtotal || g.is_manual || g.company_ids.length === 0) continue;
  // Use first company_id as representative
  COMPANY_MAP[g.name] = g.company_ids[0];
}

export function seedSpreadsheetBalances(db: Database.Database) {
  const snapshotDate = '2026-02-28';

  // Check if we already have good data for this date
  const existing = db.prepare(
    "SELECT COUNT(*) as count FROM account_balances WHERE snapshot_date = ? AND company_id = 11 AND account_code = '303010'"
  ).get(snapshotDate) as any;

  // Check if 303010 for Palios (company 11) has the correct value
  if (existing.count > 0) {
    const val = db.prepare(
      "SELECT balance FROM account_balances WHERE snapshot_date = ? AND company_id = 11 AND account_code = '303010'"
    ).get(snapshotDate) as any;
    if (val && Math.abs(val.balance - 1942566) < 1) {
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
    for (const [entityName, accounts] of Object.entries(SPREADSHEET_DATA)) {
      const companyId = COMPANY_MAP[entityName];
      if (!companyId) continue;

      for (const [code, balance] of Object.entries(accounts)) {
        if (Math.abs(balance) < 0.01) continue;

        let accountCode = code;
        let accountName = code;

        // Handle special codes
        if (code === 'asset_cash__100') { accountCode = '100000'; accountName = 'Bank and Cash'; }
        else if (code === 'asset_cash__10W') { accountCode = '10W000'; accountName = 'Digital Token'; }
        else if (code === 'asset_fixed') { accountCode = '150000'; accountName = 'Fixed Assets'; }
        else if (code === 'asset_non_current') { accountCode = '200099'; accountName = 'Non-current Assets'; }

        const accountType = getAccountType(code);

        insert.run(
          companyId, entityName,
          0, accountCode, accountName, accountType,
          balance, snapshotDate
        );
        count++;
      }
    }
  });
  tx();

  console.log(`[seed-bs] Imported ${count} balance entries for ${snapshotDate}`);
}
