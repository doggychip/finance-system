import Database from 'better-sqlite3';
import crypto from 'crypto';
import { JournalEntry, LineItem, CreateJournalEntrySchema } from '../models/journal';

export class JournalService {
  constructor(private db: Database.Database) {}

  create(data: unknown): JournalEntry & { line_items: LineItem[] } {
    const parsed = CreateJournalEntrySchema.parse(data);

    // Validate debits equal credits
    const totalDebits = parsed.line_items.reduce((sum, li) => sum + li.debit, 0);
    const totalCredits = parsed.line_items.reduce((sum, li) => sum + li.credit, 0);
    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      throw new Error(`Debits ($${totalDebits.toFixed(2)}) must equal credits ($${totalCredits.toFixed(2)})`);
    }

    // Validate each line item has either debit or credit
    for (const li of parsed.line_items) {
      if (li.debit === 0 && li.credit === 0) {
        throw new Error('Each line item must have a debit or credit amount');
      }
    }

    // Validate all accounts exist
    for (const li of parsed.line_items) {
      const account = this.db.prepare('SELECT id FROM accounts WHERE id = ?').get(li.account_id);
      if (!account) throw new Error(`Account ${li.account_id} not found`);
    }

    const id = crypto.randomUUID();

    const insertEntry = this.db.prepare(`
      INSERT INTO journal_entries (id, date, description, reference)
      VALUES (?, ?, ?, ?)
    `);

    const insertLineItem = this.db.prepare(`
      INSERT INTO line_items (id, journal_entry_id, account_id, debit, credit, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertEntry.run(id, parsed.date, parsed.description, parsed.reference);
      for (const li of parsed.line_items) {
        insertLineItem.run(crypto.randomUUID(), id, li.account_id, li.debit, li.credit, li.description);
      }
    });

    transaction();
    return this.getById(id)!;
  }

  getById(id: string): (JournalEntry & { line_items: LineItem[] }) | undefined {
    const entry = this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry | undefined;
    if (!entry) return undefined;

    const lineItems = this.db.prepare('SELECT * FROM line_items WHERE journal_entry_id = ?').all(id) as LineItem[];
    return { ...entry, line_items: lineItems };
  }

  getAll(status?: string): JournalEntry[] {
    if (status) {
      return this.db.prepare('SELECT * FROM journal_entries WHERE status = ? ORDER BY date DESC').all(status) as JournalEntry[];
    }
    return this.db.prepare('SELECT * FROM journal_entries ORDER BY date DESC').all() as JournalEntry[];
  }

  post(id: string): JournalEntry {
    const entry = this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry | undefined;
    if (!entry) throw new Error('Journal entry not found');
    if (entry.status !== 'draft') throw new Error(`Cannot post entry with status "${entry.status}"`);

    this.db.prepare(`
      UPDATE journal_entries SET status = 'posted', posted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).run(id);

    return this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry;
  }

  void(id: string, reason: string): JournalEntry & { line_items: LineItem[] } {
    const entry = this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry | undefined;
    if (!entry) throw new Error('Journal entry not found');
    if (entry.status !== 'posted') throw new Error('Can only void posted entries');

    const lineItems = this.db.prepare('SELECT * FROM line_items WHERE journal_entry_id = ?').all(id) as LineItem[];

    const transaction = this.db.transaction(() => {
      // Mark original as void
      this.db.prepare(`
        UPDATE journal_entries SET status = 'void', voided_at = datetime('now'), void_reason = ?, updated_at = datetime('now') WHERE id = ?
      `).run(reason, id);

      // Create reversing entry
      const reversalId = crypto.randomUUID();
      this.db.prepare(`
        INSERT INTO journal_entries (id, date, description, reference, status, posted_at)
        VALUES (?, datetime('now'), ?, ?, 'posted', datetime('now'))
      `).run(reversalId, `Reversal: ${entry.description}`, `void:${id}`);

      for (const li of lineItems) {
        this.db.prepare(`
          INSERT INTO line_items (id, journal_entry_id, account_id, debit, credit, description)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), reversalId, li.account_id, li.credit, li.debit, `Reversal: ${li.description}`);
      }
    });

    transaction();
    return this.getById(id)!;
  }
}
