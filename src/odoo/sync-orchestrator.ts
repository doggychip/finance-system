import Database from 'better-sqlite3';
import { OdooClient, createOdooClient } from './client';
import { syncAccounts, AccountSyncResult } from './sync-accounts';
import { syncJournalEntries, JournalSyncResult } from './sync-journal';
import { syncInvoices, InvoiceSyncResult } from './sync-invoices';

export interface FullSyncResult {
  accounts: AccountSyncResult;
  journalEntries: JournalSyncResult;
  invoices: InvoiceSyncResult;
  duration_ms: number;
}

function logSync(db: Database.Database, entityType: string, status: 'success' | 'error', recordsSynced: number, errorMessage?: string) {
  db.prepare(`
    INSERT INTO sync_log (entity_type, status, records_synced, error_message, completed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(entityType, status, recordsSynced, errorMessage || null);
}

export async function runFullSync(
  db: Database.Database,
  options: { dateFrom?: string; dateTo?: string; limit?: number } = {}
): Promise<FullSyncResult> {
  const start = Date.now();
  const odoo = createOdooClient();
  await odoo.authenticate();

  // 1. Sync accounts first (other syncs depend on account mapping)
  const accountResult = await syncAccounts(odoo, db);
  logSync(
    db, 'accounts',
    accountResult.errors.length > 0 ? 'error' : 'success',
    accountResult.created + accountResult.updated,
    accountResult.errors.join('; ') || undefined
  );

  // 2. Sync journal entries (depends on accounts)
  const journalResult = await syncJournalEntries(odoo, db, options);
  logSync(
    db, 'journal_entries',
    journalResult.errors.length > 0 ? 'error' : 'success',
    journalResult.created + journalResult.updated,
    journalResult.errors.join('; ') || undefined
  );

  // 3. Sync invoices & payments (depends on journal entries for linking)
  const invoiceResult = await syncInvoices(odoo, db, options);
  logSync(
    db, 'invoices',
    invoiceResult.errors.length > 0 ? 'error' : 'success',
    invoiceResult.invoices.created + invoiceResult.invoices.updated +
    invoiceResult.payments.created + invoiceResult.payments.updated,
    invoiceResult.errors.join('; ') || undefined
  );

  return {
    accounts: accountResult,
    journalEntries: journalResult,
    invoices: invoiceResult,
    duration_ms: Date.now() - start,
  };
}

export async function runAccountSync(db: Database.Database): Promise<AccountSyncResult> {
  const odoo = createOdooClient();
  await odoo.authenticate();
  const result = await syncAccounts(odoo, db);
  logSync(db, 'accounts', result.errors.length > 0 ? 'error' : 'success', result.created + result.updated, result.errors.join('; ') || undefined);
  return result;
}

export async function runJournalSync(db: Database.Database, options: { dateFrom?: string; dateTo?: string; limit?: number } = {}): Promise<JournalSyncResult> {
  const odoo = createOdooClient();
  await odoo.authenticate();
  const result = await syncJournalEntries(odoo, db, options);
  logSync(db, 'journal_entries', result.errors.length > 0 ? 'error' : 'success', result.created + result.updated, result.errors.join('; ') || undefined);
  return result;
}

export async function runInvoiceSync(db: Database.Database, options: { dateFrom?: string; dateTo?: string; limit?: number } = {}): Promise<InvoiceSyncResult> {
  const odoo = createOdooClient();
  await odoo.authenticate();
  const result = await syncInvoices(odoo, db, options);
  logSync(db, 'invoices', result.errors.length > 0 ? 'error' : 'success',
    result.invoices.created + result.invoices.updated + result.payments.created + result.payments.updated,
    result.errors.join('; ') || undefined);
  return result;
}

// Simple interval-based scheduler
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startSyncScheduler(db: Database.Database, intervalMinutes: number = 30) {
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  console.log(`Odoo sync scheduler started (every ${intervalMinutes} minutes)`);

  syncInterval = setInterval(async () => {
    console.log(`[${new Date().toISOString()}] Running scheduled Odoo sync...`);
    try {
      const result = await runFullSync(db);
      console.log(`[${new Date().toISOString()}] Sync complete in ${result.duration_ms}ms:`, {
        accounts: `${result.accounts.created} created, ${result.accounts.updated} updated`,
        journal: `${result.journalEntries.created} created, ${result.journalEntries.updated} updated`,
        invoices: `${result.invoices.invoices.created + result.invoices.invoices.updated} invoices, ${result.invoices.payments.created + result.invoices.payments.updated} payments`,
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Sync error:`, err);
      logSync(db, 'full_sync', 'error', 0, err instanceof Error ? err.message : String(err));
    }
  }, intervalMinutes * 60 * 1000);
}

export function stopSyncScheduler() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('Odoo sync scheduler stopped');
  }
}
