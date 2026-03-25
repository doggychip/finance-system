import Database from 'better-sqlite3';
import crypto from 'crypto';
import { OdooClient } from './client';
import { AccountType } from '../models/account';

// Odoo account.account type mapping
// Odoo uses account_type field (v16+) or user_type_id (older)
const ODOO_TYPE_MAP: Record<string, AccountType> = {
  // Odoo v16+ account_type values
  'asset_receivable': 'asset',
  'asset_cash': 'asset',
  'asset_current': 'asset',
  'asset_non_current': 'asset',
  'asset_prepayments': 'asset',
  'asset_fixed': 'asset',
  'liability_payable': 'liability',
  'liability_credit_card': 'liability',
  'liability_current': 'liability',
  'liability_non_current': 'liability',
  'equity': 'equity',
  'equity_unaffected': 'equity',
  'income': 'revenue',
  'income_other': 'revenue',
  'expense': 'expense',
  'expense_depreciation': 'expense',
  'expense_direct_cost': 'expense',
  'off_balance': 'asset', // fallback
};

function mapOdooType(odooType: string): AccountType {
  return ODOO_TYPE_MAP[odooType] || 'asset';
}

export interface AccountSyncResult {
  created: number;
  updated: number;
  total: number;
  errors: string[];
}

export async function syncAccounts(odoo: OdooClient, db: Database.Database): Promise<AccountSyncResult> {
  const result: AccountSyncResult = { created: 0, updated: 0, total: 0, errors: [] };

  // Fetch all accounts from Odoo
  const odooAccounts = await odoo.searchRead(
    'account.account',
    [],
    ['id', 'name', 'code', 'account_type', 'deprecated', 'company_id'],
    { order: 'code asc' }
  );

  result.total = odooAccounts.length;

  const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, odoo_id, name, type, code, description, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(odoo_id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      code = excluded.code,
      is_active = excluded.is_active,
      updated_at = datetime('now')
  `);

  const getByOdooId = db.prepare('SELECT id FROM accounts WHERE odoo_id = ?');

  const transaction = db.transaction(() => {
    for (const acc of odooAccounts) {
      try {
        const odooId = acc.id as number;
        const name = acc.name as string;
        const code = acc.code as string;
        const accountType = mapOdooType(acc.account_type as string);
        const isActive = acc.deprecated === true ? 0 : 1;

        const existing = getByOdooId.get(odooId) as { id: string } | undefined;

        if (existing) {
          upsertAccount.run(existing.id, odooId, name, accountType, code, '', isActive);
          result.updated++;
        } else {
          const id = crypto.randomUUID();
          upsertAccount.run(id, odooId, name, accountType, code, '', isActive);
          result.created++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Account ${acc.code}: ${msg}`);
      }
    }
  });

  transaction();
  return result;
}
