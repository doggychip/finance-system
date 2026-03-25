import Database from 'better-sqlite3';
import crypto from 'crypto';
import { OdooClient } from './client';

export interface JournalSyncResult {
  created: number;
  updated: number;
  total: number;
  errors: string[];
}

function mapOdooState(state: string): 'draft' | 'posted' | 'void' {
  switch (state) {
    case 'posted': return 'posted';
    case 'cancel': return 'void';
    default: return 'draft';
  }
}

export async function syncJournalEntries(
  odoo: OdooClient,
  db: Database.Database,
  options: { limit?: number; offset?: number; dateFrom?: string; dateTo?: string } = {}
): Promise<JournalSyncResult> {
  const result: JournalSyncResult = { created: 0, updated: 0, total: 0, errors: [] };

  // Build domain filter
  const domain: unknown[][] = [];
  if (options.dateFrom) domain.push(['date', '>=', options.dateFrom]);
  if (options.dateTo) domain.push(['date', '<=', options.dateTo]);

  // Fetch journal entries (account.move in Odoo)
  const odooEntries = await odoo.searchRead(
    'account.move',
    domain,
    ['id', 'name', 'date', 'ref', 'state', 'move_type', 'amount_total'],
    {
      order: 'date desc',
      limit: options.limit,
      offset: options.offset,
    }
  );

  result.total = odooEntries.length;

  const upsertEntry = db.prepare(`
    INSERT INTO journal_entries (id, odoo_id, date, description, reference, status, posted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(odoo_id) DO UPDATE SET
      date = excluded.date,
      description = excluded.description,
      reference = excluded.reference,
      status = excluded.status,
      posted_at = excluded.posted_at,
      updated_at = datetime('now')
  `);

  const getEntryByOdooId = db.prepare('SELECT id FROM journal_entries WHERE odoo_id = ?');
  const getAccountByOdooId = db.prepare('SELECT id FROM accounts WHERE odoo_id = ?');
  const deleteLineItems = db.prepare('DELETE FROM line_items WHERE journal_entry_id = ?');

  const upsertLineItem = db.prepare(`
    INSERT INTO line_items (id, odoo_id, journal_entry_id, account_id, debit, credit, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(odoo_id) DO UPDATE SET
      debit = excluded.debit,
      credit = excluded.credit,
      description = excluded.description
  `);

  // Process each entry
  for (const entry of odooEntries) {
    try {
      const odooId = entry.id as number;
      const name = (entry.name as string) || '';
      const date = entry.date as string;
      const ref = (entry.ref as string | false) || '';
      const state = mapOdooState(entry.state as string);
      const postedAt = state === 'posted' ? date : null;

      const existing = getEntryByOdooId.get(odooId) as { id: string } | undefined;
      const entryId = existing?.id || crypto.randomUUID();

      // Fetch line items from Odoo
      const odooLines = await odoo.searchRead(
        'account.move.line',
        [['move_id', '=', odooId]],
        ['id', 'name', 'account_id', 'debit', 'credit', 'move_id'],
        { order: 'id asc' }
      );

      // Skip entries with no valid line items that we can map
      const mappableLines = odooLines.filter(line => {
        const accountRef = line.account_id as [number, string] | false;
        if (!accountRef) return false;
        return !!getAccountByOdooId.get(accountRef[0]);
      });

      if (mappableLines.length < 2) {
        // Need accounts synced first — skip entries we can't fully map
        result.errors.push(`Entry ${name} (${odooId}): not enough mappable accounts (${mappableLines.length}), sync accounts first`);
        continue;
      }

      const transaction = db.transaction(() => {
        upsertEntry.run(entryId, odooId, date, name, ref, state, postedAt);

        if (existing) {
          deleteLineItems.run(entryId);
        }

        for (const line of mappableLines) {
          const lineOdooId = line.id as number;
          const accountRef = line.account_id as [number, string];
          const localAccount = getAccountByOdooId.get(accountRef[0]) as { id: string };
          const debit = (line.debit as number) || 0;
          const credit = (line.credit as number) || 0;
          const lineName = (line.name as string | false) || '';

          if (debit === 0 && credit === 0) continue;

          upsertLineItem.run(
            crypto.randomUUID(),
            lineOdooId,
            entryId,
            localAccount.id,
            debit,
            credit,
            lineName
          );
        }
      });

      transaction();

      if (existing) result.updated++;
      else result.created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Entry ${entry.name} (${entry.id}): ${msg}`);
    }
  }

  return result;
}
