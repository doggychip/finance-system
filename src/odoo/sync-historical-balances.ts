import Database from 'better-sqlite3';
import { OdooClient } from './client';

export interface HistoricalBalanceSyncResult {
  companies_synced: number;
  accounts_synced: number;
  snapshot_date: string;
  errors: string[];
}

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

export async function syncHistoricalBalances(
  odoo: OdooClient,
  db: Database.Database,
  asOfDate: string
): Promise<HistoricalBalanceSyncResult> {
  const result: HistoricalBalanceSyncResult = {
    companies_synced: 0,
    accounts_synced: 0,
    snapshot_date: asOfDate,
    errors: [],
  };

  const upsert = db.prepare(`
    INSERT INTO account_balances (company_id, company_name, account_odoo_id, account_code, account_name, account_type, balance, snapshot_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, account_odoo_id, snapshot_date) DO UPDATE SET
      balance = excluded.balance,
      account_name = excluded.account_name,
      account_type = excluded.account_type,
      synced_at = datetime('now')
  `);

  for (const company of COMPANIES) {
    try {
      console.log(`[sync-hist] Fetching ${company.name} (${company.id}) as of ${asOfDate}...`);

      // Use read_group to get grouped balances by account
      const grouped = await odoo.execute('account.move.line', 'read_group',
        [[
          ['company_id', '=', company.id],
          ['parent_state', '=', 'posted'],
          ['date', '<=', asOfDate],
        ]],
        {
          fields: ['account_id', 'balance'],
          groupby: ['account_id'],
          lazy: false,
        }
      ) as any[];

      // We also need account_type — fetch account details for accounts with balances
      const accountIds = grouped.filter(g => Math.abs(g.balance) > 0.01).map(g => g.account_id[0]);

      let accountDetails: Record<number, { code: string; name: string; account_type: string }> = {};
      if (accountIds.length > 0) {
        // Batch fetch account details
        const accts = await odoo.read('account.account', accountIds, ['id', 'code', 'name', 'account_type']);
        for (const a of accts) {
          accountDetails[a.id as number] = {
            code: (a.code as string) || '',
            name: (a.name as string) || '',
            account_type: (a.account_type as string) || '',
          };
        }
      }

      const tx = db.transaction(() => {
        for (const g of grouped) {
          if (Math.abs(g.balance) < 0.01) continue;
          const acctId = g.account_id[0];
          const detail = accountDetails[acctId];
          if (!detail || !detail.code) continue;

          upsert.run(
            company.id, company.name,
            acctId, detail.code, detail.name, detail.account_type,
            g.balance, asOfDate
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

  console.log(`[sync-hist] Done: ${result.companies_synced} companies, ${result.accounts_synced} accounts for ${asOfDate}`);
  return result;
}
