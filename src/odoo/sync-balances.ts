import Database from 'better-sqlite3';
import { OdooClient } from './client';

export interface BalanceSyncResult {
  companies_synced: number;
  accounts_synced: number;
  snapshot_date: string;
  errors: string[];
}

export const FIAT_CURRENCIES = ['USD', 'CNY', 'SGD'];
export const CRYPTO_CURRENCIES = ['BNB', 'ETH', 'XTR', 'UST', 'WBN', 'USC', 'SHI', 'SPE'];

export function classifyCurrency(currency: string): 'fiat' | 'crypto' {
  return CRYPTO_CURRENCIES.includes(currency) ? 'crypto' : 'fiat';
}

// All company IDs and names
const COMPANIES = [
  { id: 1, name: 'LTECH' }, { id: 23, name: 'LTECH W3' },
  { id: 17, name: 'XLABS' }, { id: 18, name: 'XLABS W3' },
  { id: 21, name: 'PRIVILEGE HK' }, { id: 22, name: 'LSTATION' },
  { id: 5, name: 'GAMEPHILOS' }, { id: 6, name: 'GAMEPHILOS W3' },
  { id: 7, name: 'MAOFAN' }, { id: 10, name: 'DIFANHA' },
  { id: 2, name: 'SHADOWCAY' }, { id: 3, name: 'SHADOWCAY W3' },
  { id: 4, name: 'CHAOYING' }, { id: 12, name: 'COS GAMES' },
  { id: 13, name: 'DIREWOLF' }, { id: 14, name: 'COS GAMES W3' },
  { id: 11, name: 'PALIO W3' }, { id: 9, name: 'BJ TUDONG' },
  { id: 19, name: 'LHOLDINGS' }, { id: 20, name: 'LHOLDINGS W3' },
  { id: 8, name: 'QUANTUMMIND' },
  { id: 15, name: 'OVERWORLD' }, { id: 16, name: 'OVERWORLD W3' },
  { id: 30, name: 'REACH LABS' }, { id: 31, name: 'ROUGH HOUSE' },
  { id: 28, name: 'PLAY ALGORITHM' },
];

export async function syncBalances(
  odoo: OdooClient,
  db: Database.Database
): Promise<BalanceSyncResult> {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const result: BalanceSyncResult = {
    companies_synced: 0,
    accounts_synced: 0,
    snapshot_date: snapshotDate,
    errors: [],
  };

  // One-time cleanup: rows tagged with legacy 'CRYPTO' sentinel (set before we
  // stored real currency_id) lose their specific currency after this fix. Map
  // them to 'UST' so the new classifier still treats them as crypto; real
  // per-account currency will be overwritten on the next fresh sync.
  db.prepare(`UPDATE account_balances SET currency = 'UST' WHERE currency = 'CRYPTO'`).run();

  const upsert = db.prepare(`
    INSERT INTO account_balances (company_id, company_name, account_odoo_id, account_code, account_name, account_type, currency, balance, snapshot_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, account_odoo_id, snapshot_date) DO UPDATE SET
      balance = excluded.balance,
      account_name = excluded.account_name,
      account_type = excluded.account_type,
      currency = excluded.currency,
      synced_at = datetime('now')
  `);

  const deleteCompanySnapshot = db.prepare(
    `DELETE FROM account_balances WHERE company_id = ? AND snapshot_date = ?`
  );

  for (const company of COMPANIES) {
    try {
      console.log(`[sync-balances] Fetching balances for ${company.name} (${company.id})...`);

      // Use Odoo's current_balance with company context
      const accts = await odoo.execute('account.account', 'search_read',
        [[['company_ids', 'in', [company.id]]]],
        {
          fields: ['id', 'code', 'name', 'current_balance', 'account_type', 'currency_id'],
          context: { 'allowed_company_ids': [company.id] },
          limit: 2000,
        }
      ) as any[];

      const tx = db.transaction(() => {
        // Wipe any prior rows for this company+snapshot to prevent stale entries
        // (accounts zeroed/removed in Odoo would otherwise linger, since we skip
        // near-zero balances below and upsert only matches by account_odoo_id).
        deleteCompanySnapshot.run(company.id, snapshotDate);
        for (const a of accts) {
          if (Math.abs(a.current_balance) < 0.01) continue;
          const code = a.code || '';
          const name = a.name || '';
          const accountType = a.account_type || '';
          if (!code) continue;

          // Determine currency from Odoo currency_id; fallback to USD
          const currencyRef = a.currency_id as [number, string] | false;
          const currency = (currencyRef && currencyRef[1]) ? currencyRef[1] : 'USD';

          upsert.run(
            company.id, company.name,
            a.id, code, name, accountType, currency,
            a.current_balance, snapshotDate
          );
          result.accounts_synced++;
        }
      });
      tx();
      result.companies_synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${company.name}: ${msg.slice(0, 200)}`);
    }
  }

  console.log(`[sync-balances] Done: ${result.companies_synced} companies, ${result.accounts_synced} accounts`);
  return result;
}
