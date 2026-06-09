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

// Sync balances from Odoo using journal line aggregation as of a specific date.
// asOfDate: Odoo accounting date (YYYY-MM-DD). Balances are the sum of all
//   posted journal lines with date <= asOfDate. This is the Odoo data date,
//   not the sync run date. Defaults to today if not provided.
export async function syncBalances(
  odoo: OdooClient,
  db: Database.Database,
  asOfDate?: string
): Promise<BalanceSyncResult> {
  const snapshotDate = asOfDate || new Date().toISOString().slice(0, 10);

  const result: BalanceSyncResult = {
    companies_synced: 0,
    accounts_synced: 0,
    snapshot_date: snapshotDate,
    errors: [],
  };

  // One-time cleanup: rows tagged with legacy 'CRYPTO' sentinel
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
      console.log(`[sync-balances] Fetching ${company.name} (${company.id}) as of ${snapshotDate}...`);

      // Aggregate posted journal lines up to snapshotDate
      // date <= snapshotDate ensures we only include Odoo entries up to that date
      const grouped = await odoo.execute('account.move.line', 'read_group',
        [[
          ['company_id', '=', company.id],
          ['parent_state', '=', 'posted'],
          ['date', '<=', snapshotDate],
        ]],
        {
          fields: ['account_id', 'balance'],
          groupby: ['account_id'],
          lazy: false,
        }
      ) as any[];

      // Fetch account details (code, name, type, currency) for non-zero accounts
      const accountIds = grouped
        .filter(g => Math.abs(g.balance) >= 0.01)
        .map(g => (g.account_id as [number, string])[0]);

      let accountDetails: Record<number, { code: string; name: string; account_type: string; currency: string }> = {};
      if (accountIds.length > 0) {
        const accts = await odoo.execute('account.account', 'search_read',
          [[['id', 'in', accountIds]]],
          {
            fields: ['id', 'code', 'name', 'account_type', 'currency_id'],
            context: { 'allowed_company_ids': [company.id] },
          }
        ) as any[];
        for (const a of accts) {
          const currencyRef = a.currency_id as [number, string] | false;
          accountDetails[a.id as number] = {
            code: (a.code as string) || '',
            name: (a.name as string) || '',
            account_type: (a.account_type as string) || '',
            currency: (currencyRef && currencyRef[1]) ? currencyRef[1] : 'USD',
          };
        }
      }

      const tx = db.transaction(() => {
        // Wipe prior rows for this company+snapshot to prevent stale entries
        deleteCompanySnapshot.run(company.id, snapshotDate);
        for (const g of grouped) {
          if (Math.abs(g.balance) < 0.01) continue;
          const acctId = (g.account_id as [number, string])[0];
          const detail = accountDetails[acctId];
          if (!detail || !detail.code) continue;

          upsert.run(
            company.id, company.name,
            acctId, detail.code, detail.name, detail.account_type, detail.currency,
            g.balance, snapshotDate
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

  console.log(`[sync-balances] Done: ${result.companies_synced} companies, ${result.accounts_synced} accounts as of ${snapshotDate}`);
  return result;
}
