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

const BATCH_SIZE = 500;

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

  // Count total entries to sync
  const totalCount = options.limit
    ? Math.min(options.limit, await odoo.searchCount('account.move', domain))
    : await odoo.searchCount('account.move', domain);

  console.log(`[sync-journal] ${totalCount} journal entries to sync`);

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

  const insertLineItem = db.prepare(`
    INSERT OR REPLACE INTO line_items (id, odoo_id, journal_entry_id, account_id, debit, credit, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let offset = options.offset || 0;
  let remaining = totalCount;

  while (remaining > 0) {
    const batchSize = Math.min(BATCH_SIZE, remaining);
    console.log(`[sync-journal] Fetching batch: offset=${offset}, size=${batchSize}`);

    // 1. Fetch a batch of journal entries
    const odooEntries = await odoo.searchRead(
      'account.move',
      domain,
      ['id', 'name', 'date', 'ref', 'state', 'move_type', 'amount_total'],
      { order: 'date desc', limit: batchSize, offset }
    );

    if (odooEntries.length === 0) break;

    const entryOdooIds = odooEntries.map(e => e.id as number);

    // 2. Fetch ALL line items for this batch in ONE call
    const allLines = await odoo.searchRead(
      'account.move.line',
      [['move_id', 'in', entryOdooIds]],
      ['id', 'name', 'account_id', 'debit', 'credit', 'move_id'],
      { order: 'id asc' }
    );

    console.log(`[sync-journal] Fetched ${odooEntries.length} entries with ${allLines.length} line items`);

    // Group line items by move_id
    const linesByEntry: Record<number, typeof allLines> = {};
    for (const line of allLines) {
      const moveRef = line.move_id as [number, string] | false;
      if (!moveRef) continue;
      const moveId = moveRef[0];
      if (!linesByEntry[moveId]) linesByEntry[moveId] = [];
      linesByEntry[moveId].push(line);
    }

    // 3. Process entries in a transaction
    const processBatch = db.transaction(() => {
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

          const entryLines = linesByEntry[odooId] || [];

          // Filter to lines we can map to local accounts
          const mappableLines = entryLines.filter(line => {
            const accountRef = line.account_id as [number, string] | false;
            if (!accountRef) return false;
            return !!getAccountByOdooId.get(accountRef[0]);
          });

          if (mappableLines.length < 2) {
            result.errors.push(`Entry ${name} (${odooId}): not enough mappable accounts (${mappableLines.length})`);
            return; // skip this entry within transaction
          }

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

            insertLineItem.run(
              crypto.randomUUID(),
              lineOdooId,
              entryId,
              localAccount.id,
              debit,
              credit,
              lineName
            );
          }

          if (existing) result.updated++;
          else result.created++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Entry ${entry.name} (${entry.id}): ${msg}`);
        }
      }
    });

    processBatch();

    result.total += odooEntries.length;
    offset += odooEntries.length;
    remaining -= odooEntries.length;
  }

  console.log(`[sync-journal] Done: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`);
  return result;
}
