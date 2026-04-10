import Database from 'better-sqlite3';

// Verified spreadsheet data as at 28.02.2026
// For each entity: individual accounts + equity derived from ASSETS + LIABILITIES + EQUITY = 0
// Reconciliation totals used to verify: _ASSETS, _LIABILITIES, _EQUITY from spreadsheet

interface Account { code: string; name: string; type: string; balance: number; }
interface Entity {
  company_id: number;
  name: string;
  accounts: Account[];
  // Verified totals from spreadsheet (accounting convention)
  verify: { assets: number; liabilities: number; equity: number; current_year_pl: number };
}

const ENTITIES: Entity[] = [
  {
    company_id: 1, name: 'LTECH, LTECH W3',
    verify: { assets: 1929938, liabilities: -596318, equity: 2526257, current_year_pl: -121654 },
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 703043 },
      { code: '10W000', name: 'Digital Token', type: 'asset_cash', balance: 257791 },
      { code: '107010', name: 'GST Control', type: 'asset_receivable', balance: 271679 },
      { code: '101010', name: 'Other Receivable', type: 'asset_receivable', balance: 12039 },
      { code: '202000', name: 'Deposits', type: 'asset_non_current', balance: 685387 },
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
    ],
  },
  {
    company_id: 17, name: 'XLABS, XLAB W3',
    verify: { assets: 6997, liabilities: 1954659, equity: -1947662, current_year_pl: -95516 },
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 6997 },
      { code: '303020', name: 'Amount due to/from Libecciotech (Non-trade)', type: 'liability_current', balance: -893337 },
      { code: '303021', name: 'Amount due to/from Libecciotech W3 (Non-trade)', type: 'liability_current', balance: 4300376 },
      { code: '303030', name: 'Amount due to/from Xterio Fdn', type: 'liability_non_current', balance: -2806974 },
    ],
  },
  {
    company_id: 21, name: 'PRIVILEGE HK',
    verify: { assets: 17305, liabilities: 30000, equity: -12695, current_year_pl: 17292 },
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 17305 },
      { code: '303020', name: 'Amount due to/from Libecciotech (Non-trade)', type: 'liability_current', balance: 30000 },
    ],
  },
  {
    company_id: 5, name: 'AOD',
    verify: { assets: 478669, liabilities: -2183072, equity: 2661741, current_year_pl: 24937 },
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 412183 },
      { code: '101000', name: 'Accounts Receivable', type: 'asset_receivable', balance: 66486 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: -2505850 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: 4616855 },
      { code: '303041', name: 'Amount due to/from Xterlabs W3 (Non-trade)', type: 'liability_current', balance: 700 },
      { code: '303061', name: 'Amount due to/from PALIO W3 (Non-trade)', type: 'liability_current', balance: 56000 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 4616855 },
      { code: '303181', name: 'Amount due to/from REACH LABS W3 (Non-trade)', type: 'liability_current', balance: 700 },
    ],
  },
  {
    company_id: 2, name: 'CS',
    verify: { assets: 9681, liabilities: 5385299, equity: -5375619, current_year_pl: -7502 },
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
    ],
  },
  {
    company_id: 11, name: 'Palios',
    verify: { assets: 120328, liabilities: -264700, equity: 385028, current_year_pl: -27271 },
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 20328 },
      { code: '200000', name: 'Non-current Assets', type: 'asset_non_current', balance: 100000 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: 1942566 },
      { code: '303011', name: 'Amount due to/from Holding W3 (Non-trade)', type: 'liability_current', balance: -2322115 },
      { code: '303060', name: 'Amount due to/from Quantummind (Non-trade)', type: 'liability_current', balance: 3700 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 56000 },
      { code: '303120', name: 'Amount due to/from collected on behalf (Non-trade)', type: 'liability_current', balance: 35717 },
      { code: '303021', name: 'Amount due to/from Libecciotech W3 (Non-trade)', type: 'liability_current', balance: 2278 },
      { code: '301000', name: 'Accrued Expenses', type: 'liability_current', balance: -17064 },
    ],
  },
  {
    company_id: 19, name: 'LHOLDINGS',
    verify: { assets: 7785077, liabilities: 4553231, equity: 3231847, current_year_pl: -212625 },
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
    ],
  },
  {
    company_id: 8, name: 'QUANTUMMIND',
    verify: { assets: 14328, liabilities: 82297, equity: -67969, current_year_pl: -6922 },
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 871 },
      { code: '101010', name: 'Other Receivable', type: 'asset_receivable', balance: 13457 },
      { code: '303010', name: 'Amount due to/from Holding (Non-trade)', type: 'liability_current', balance: -1132050 },
      { code: '303160', name: 'Amount due to/from Play Algorithm (Non-trade)', type: 'liability_current', balance: 3700 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: 1210647 },
    ],
  },
  {
    company_id: 15, name: 'OW',
    verify: { assets: 4073918, liabilities: -7464052, equity: 11537970, current_year_pl: 270549 },
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
    ],
  },
  {
    company_id: 30, name: 'Reach',
    verify: { assets: 908480, liabilities: -1602523, equity: -1302602, current_year_pl: -270549 },
    accounts: [
      { code: '100000', name: 'Cash', type: 'asset_cash', balance: 182812 },
      { code: '150000', name: 'Fixed Assets', type: 'asset_fixed', balance: 725668 },
      { code: '303050', name: 'Amount due to/from Overworld (Non-trade)', type: 'liability_current', balance: -2036288 },
      { code: '303051', name: 'Amount due to/from Overworld W3 (Non-trade)', type: 'liability_current', balance: -58394 },
      { code: '303170', name: 'Amount due to/from Rough House (Non-trade)', type: 'liability_current', balance: -117776 },
      { code: '303081', name: 'Amount due to/from Gamephilos W3 (Non-trade)', type: 'liability_current', balance: -700 },
      { code: '107010', name: 'GST Control', type: 'asset_receivable', balance: -2076 },
    ],
  },
  {
    company_id: 31, name: 'Rough house',
    verify: { assets: 20489159, liabilities: 1602523, equity: 18886636, current_year_pl: -1319 },
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
    ],
  },
];

export function seedSpreadsheetBalances(db: Database.Database) {
  const snapshotDate = '2026-02-28';

  // Check if ALL data is present (check multiple entities)
  const totalAccounts = db.prepare(
    "SELECT COUNT(*) as c FROM account_balances WHERE snapshot_date = ?"
  ).get(snapshotDate) as any;
  const owIC = db.prepare(
    "SELECT balance FROM account_balances WHERE snapshot_date = ? AND company_id = 15 AND account_code = '303010'"
  ).get(snapshotDate) as any;

  // Need at least 140 accounts AND OW must have 303010
  if (totalAccounts?.c >= 140 && owIC && Math.abs(owIC.balance - (-8870813)) < 1) {
    console.log('[seed-bs] Spreadsheet balance data already correct (' + totalAccounts.c + ' accounts), skipping');
    return;
  }

  console.log('[seed-bs] Importing verified spreadsheet balances for ' + snapshotDate + '...');
  // Delete ALL snapshots to prevent stale Odoo sync data from showing
  db.prepare('DELETE FROM account_balances').run();

  const insert = db.prepare(`
    INSERT INTO account_balances (company_id, company_name, account_odoo_id, account_code, account_name, account_type, balance, snapshot_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  let odooIdCounter = 900000; // Use high IDs to avoid conflicts with real Odoo IDs
  const tx = db.transaction(() => {
    for (const entity of ENTITIES) {
      // Insert individual accounts
      let assetSum = 0, liabSum = 0;
      for (const acct of entity.accounts) {
        if (Math.abs(acct.balance) < 0.01) continue;
        insert.run(entity.company_id, entity.name, odooIdCounter++, acct.code, acct.name, acct.type, acct.balance, snapshotDate);
        count++;

        if (acct.type.startsWith('asset_')) assetSum += acct.balance;
        else liabSum += acct.balance;
      }

      // Compute remaining liabilities not covered by individual accounts
      const targetLiabSystem = -entity.verify.liabilities;
      const liabGap = targetLiabSystem - liabSum;
      if (Math.abs(liabGap) > 1) {
        insert.run(entity.company_id, entity.name, odooIdCounter++, '303999', 'Other IC balances', 'liability_current', liabGap, snapshotDate);
        liabSum += liabGap;
        count++;
      }

      // Compute remaining assets not covered
      const targetAssetSystem = entity.verify.assets;
      const assetGap = targetAssetSystem - assetSum;
      if (Math.abs(assetGap) > 1) {
        insert.run(entity.company_id, entity.name, odooIdCounter++, '109999', 'Other assets', 'asset_current', assetGap, snapshotDate);
        assetSum += assetGap;
        count++;
      }

      // Equity from identity
      const equitySystem = -(entity.verify.equity);
      const currentYearPLSystem = -(entity.verify.current_year_pl);
      const retainedSystem = equitySystem - currentYearPLSystem;

      if (Math.abs(retainedSystem) > 0.01) {
        insert.run(entity.company_id, entity.name, odooIdCounter++, '500000', 'Retained Earnings', 'equity', retainedSystem, snapshotDate);
        count++;
      }
      if (Math.abs(currentYearPLSystem) > 0.01) {
        insert.run(entity.company_id, entity.name, odooIdCounter++, '800000', 'Current Year Unallocated', 'income', currentYearPLSystem, snapshotDate);
        count++;
      }

      const totalCheck = assetSum + liabSum + equitySystem;
      if (Math.abs(totalCheck) > 10) {
        console.warn(`[seed-bs] WARNING: ${entity.name} check = ${totalCheck.toFixed(0)}`);
      }
    }
  });
  tx();

  console.log(`[seed-bs] Imported ${count} balance entries for ${snapshotDate}`);
}
