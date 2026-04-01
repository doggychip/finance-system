import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Account, CreateAccountSchema, UpdateAccountSchema } from '../models/account';

export class AccountService {
  constructor(private db: Database.Database) {}

  create(data: unknown): Account {
    const parsed = CreateAccountSchema.parse(data);
    const id = crypto.randomUUID();

    if (parsed.parent_id) {
      const parent = this.db.prepare('SELECT id, type FROM accounts WHERE id = ?').get(parsed.parent_id) as Account | undefined;
      if (!parent) throw new Error('Parent account not found');
      if (parent.type !== parsed.type) throw new Error('Child account must have the same type as parent');
    }

    const existing = this.db.prepare('SELECT id FROM accounts WHERE code = ?').get(parsed.code);
    if (existing) throw new Error(`Account code "${parsed.code}" already exists`);

    this.db.prepare(`
      INSERT INTO accounts (id, name, type, code, parent_id, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, parsed.name, parsed.type, parsed.code, parsed.parent_id || null, parsed.description);

    return this.getById(id)!;
  }

  getById(id: string): Account | undefined {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
  }

  getAll(type?: string): Account[] {
    if (type) {
      return this.db.prepare('SELECT * FROM accounts WHERE type = ? ORDER BY code').all(type) as Account[];
    }
    return this.db.prepare('SELECT * FROM accounts ORDER BY code').all() as Account[];
  }

  update(id: string, data: unknown): Account {
    const account = this.getById(id);
    if (!account) throw new Error('Account not found');

    const parsed = UpdateAccountSchema.parse(data);
    const updates: string[] = [];
    const values: unknown[] = [];

    if (parsed.name !== undefined) { updates.push('name = ?'); values.push(parsed.name); }
    if (parsed.description !== undefined) { updates.push('description = ?'); values.push(parsed.description); }
    if (parsed.is_active !== undefined) { updates.push('is_active = ?'); values.push(parsed.is_active ? 1 : 0); }

    if (updates.length === 0) return account;

    updates.push("updated_at = datetime('now')");
    values.push(id);

    this.db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id)!;
  }

  delete(id: string): void {
    const account = this.getById(id);
    if (!account) throw new Error('Account not found');

    const hasChildren = this.db.prepare('SELECT COUNT(*) as count FROM accounts WHERE parent_id = ?').get(id) as { count: number };
    if (hasChildren.count > 0) throw new Error('Cannot delete account with children');

    const hasLineItems = this.db.prepare(
      'SELECT COUNT(*) as count FROM line_items li INNER JOIN journal_entries je ON li.journal_entry_id = je.id WHERE li.account_id = ? AND je.status = ?'
    ).get(id, 'posted') as { count: number };
    if (hasLineItems.count > 0) throw new Error('Cannot delete account with posted transactions');

    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }
}
