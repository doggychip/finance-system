import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDb } from '../db';
import { OdooClient } from '../odoo/client';
import { syncAccounts } from '../odoo/sync-accounts';
import { syncJournalEntries } from '../odoo/sync-journal';
import { syncInvoices } from '../odoo/sync-invoices';
import Database from 'better-sqlite3';

// Create a mock OdooClient
function createMockOdoo(): OdooClient {
  const mock = {
    authenticate: vi.fn().mockResolvedValue(1),
    searchRead: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(null),
    version: vi.fn().mockResolvedValue({ server_version: '17.0' }),
    searchCount: vi.fn().mockResolvedValue(0),
    getUid: vi.fn().mockReturnValue(1),
  } as unknown as OdooClient;
  return mock;
}

let db: Database.Database;
let odoo: OdooClient;

beforeEach(() => {
  db = initDb(':memory:');
  odoo = createMockOdoo();
});

describe('syncAccounts', () => {
  it('should sync accounts from Odoo', async () => {
    (odoo.searchRead as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 1, name: 'Cash', code: '1000', account_type: 'asset_cash', deprecated: false },
      { id: 2, name: 'Accounts Receivable', code: '1200', account_type: 'asset_receivable', deprecated: false },
      { id: 3, name: 'Sales Revenue', code: '4000', account_type: 'income', deprecated: false },
      { id: 4, name: 'Accounts Payable', code: '2000', account_type: 'liability_payable', deprecated: false },
    ]);

    const result = await syncAccounts(odoo, db);

    expect(result.created).toBe(4);
    expect(result.updated).toBe(0);
    expect(result.total).toBe(4);
    expect(result.errors).toHaveLength(0);

    // Verify accounts are in local DB
    const accounts = db.prepare('SELECT * FROM accounts ORDER BY code').all() as any[];
    expect(accounts).toHaveLength(4);
    expect(accounts[0].code).toBe('1000');
    expect(accounts[0].type).toBe('asset');
    expect(accounts[0].odoo_id).toBe(1);
    expect(accounts[2].code).toBe('2000');
    expect(accounts[2].type).toBe('liability');
  });

  it('should update existing accounts on re-sync', async () => {
    const mockData = [
      { id: 1, name: 'Cash', code: '1000', account_type: 'asset_cash', deprecated: false },
    ];
    (odoo.searchRead as ReturnType<typeof vi.fn>).mockResolvedValue(mockData);

    await syncAccounts(odoo, db);

    // Change name and re-sync
    mockData[0].name = 'Cash & Equivalents';
    (odoo.searchRead as ReturnType<typeof vi.fn>).mockResolvedValue(mockData);

    const result = await syncAccounts(odoo, db);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);

    const account = db.prepare('SELECT name FROM accounts WHERE odoo_id = 1').get() as any;
    expect(account.name).toBe('Cash & Equivalents');
  });

  it('should map all Odoo account types correctly', async () => {
    (odoo.searchRead as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 1, name: 'A', code: '1000', account_type: 'asset_cash', deprecated: false },
      { id: 2, name: 'B', code: '2000', account_type: 'liability_current', deprecated: false },
      { id: 3, name: 'C', code: '3000', account_type: 'equity', deprecated: false },
      { id: 4, name: 'D', code: '4000', account_type: 'income', deprecated: false },
      { id: 5, name: 'E', code: '5000', account_type: 'expense', deprecated: false },
    ]);

    await syncAccounts(odoo, db);

    const accounts = db.prepare('SELECT type, code FROM accounts ORDER BY code').all() as any[];
    expect(accounts[0].type).toBe('asset');
    expect(accounts[1].type).toBe('liability');
    expect(accounts[2].type).toBe('equity');
    expect(accounts[3].type).toBe('revenue');
    expect(accounts[4].type).toBe('expense');
  });

  it('should mark deprecated accounts as inactive', async () => {
    (odoo.searchRead as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 1, name: 'Old Account', code: '9999', account_type: 'asset_cash', deprecated: true },
    ]);

    await syncAccounts(odoo, db);

    const account = db.prepare('SELECT is_active FROM accounts WHERE odoo_id = 1').get() as any;
    expect(account.is_active).toBe(0);
  });
});

describe('syncJournalEntries', () => {
  beforeEach(async () => {
    // Pre-seed accounts for journal entry mapping
    (odoo.searchRead as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 10, name: 'Cash', code: '1000', account_type: 'asset_cash', deprecated: false },
      { id: 20, name: 'Revenue', code: '4000', account_type: 'income', deprecated: false },
    ]);
    await syncAccounts(odoo, db);
  });

  it('should sync journal entries with line items', async () => {
    // Mock account.move search_read
    (odoo.searchRead as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: 100, name: 'INV/2025/001', date: '2025-01-15', ref: 'Sale', state: 'posted', move_type: 'entry', amount_total: 500 },
      ])
      // Mock account.move.line search_read for the entry
      .mockResolvedValueOnce([
        { id: 1001, name: 'Cash receipt', account_id: [10, 'Cash'], debit: 500, credit: 0, move_id: [100, 'INV/2025/001'] },
        { id: 1002, name: 'Revenue', account_id: [20, 'Revenue'], debit: 0, credit: 500, move_id: [100, 'INV/2025/001'] },
      ]);

    const result = await syncJournalEntries(odoo, db);

    expect(result.created).toBe(1);
    expect(result.total).toBe(1);

    const entry = db.prepare('SELECT * FROM journal_entries WHERE odoo_id = 100').get() as any;
    expect(entry).toBeDefined();
    expect(entry.status).toBe('posted');
    expect(entry.description).toBe('INV/2025/001');

    const lines = db.prepare('SELECT * FROM line_items WHERE journal_entry_id = ?').all(entry.id) as any[];
    expect(lines).toHaveLength(2);
    expect(lines[0].debit + lines[1].debit).toBe(500);
    expect(lines[0].credit + lines[1].credit).toBe(500);
  });

  it('should map Odoo states correctly', async () => {
    (odoo.searchRead as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: 200, name: 'DRAFT/001', date: '2025-02-01', ref: '', state: 'draft', move_type: 'entry', amount_total: 100 },
      ])
      .mockResolvedValueOnce([
        { id: 2001, name: 'Line 1', account_id: [10, 'Cash'], debit: 100, credit: 0, move_id: [200, 'DRAFT/001'] },
        { id: 2002, name: 'Line 2', account_id: [20, 'Revenue'], debit: 0, credit: 100, move_id: [200, 'DRAFT/001'] },
      ]);

    await syncJournalEntries(odoo, db);

    const entry = db.prepare('SELECT status FROM journal_entries WHERE odoo_id = 200').get() as any;
    expect(entry.status).toBe('draft');
  });
});

describe('syncInvoices', () => {
  it('should sync invoices from Odoo', async () => {
    (odoo.searchRead as ReturnType<typeof vi.fn>)
      // Invoices
      .mockResolvedValueOnce([
        {
          id: 300,
          name: 'INV/2025/0001',
          partner_id: [1, 'Acme Corp'],
          move_type: 'out_invoice',
          state: 'posted',
          invoice_date: '2025-01-10',
          invoice_date_due: '2025-02-10',
          amount_total: 1500,
          amount_residual: 1500,
          currency_id: [1, 'USD'],
        },
      ])
      // Payments
      .mockResolvedValueOnce([
        {
          id: 400,
          name: 'PAY/2025/0001',
          partner_id: [1, 'Acme Corp'],
          amount: 1500,
          date: '2025-02-05',
          payment_type: 'inbound',
          state: 'posted',
          ref: 'Payment for INV/2025/0001',
          currency_id: [1, 'USD'],
          move_id: false,
        },
      ]);

    const result = await syncInvoices(odoo, db);

    expect(result.invoices.created).toBe(1);
    expect(result.invoices.total).toBe(1);
    expect(result.payments.created).toBe(1);
    expect(result.payments.total).toBe(1);

    const invoice = db.prepare('SELECT * FROM invoices WHERE odoo_id = 300').get() as any;
    expect(invoice).toBeDefined();
    expect(invoice.partner_name).toBe('Acme Corp');
    expect(invoice.amount_total).toBe(1500);
    expect(invoice.type).toBe('out_invoice');

    const payment = db.prepare('SELECT * FROM payments WHERE odoo_id = 400').get() as any;
    expect(payment).toBeDefined();
    expect(payment.amount).toBe(1500);
    expect(payment.payment_type).toBe('inbound');
  });

  it('should update invoices on re-sync', async () => {
    (odoo.searchRead as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          id: 300, name: 'INV/2025/0001', partner_id: [1, 'Acme Corp'],
          move_type: 'out_invoice', state: 'posted', invoice_date: '2025-01-10',
          invoice_date_due: '2025-02-10', amount_total: 1500, amount_residual: 1500,
          currency_id: [1, 'USD'],
        },
      ])
      .mockResolvedValueOnce([]); // no payments

    await syncInvoices(odoo, db);

    // Re-sync with updated amount_residual (partial payment)
    (odoo.searchRead as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          id: 300, name: 'INV/2025/0001', partner_id: [1, 'Acme Corp'],
          move_type: 'out_invoice', state: 'posted', invoice_date: '2025-01-10',
          invoice_date_due: '2025-02-10', amount_total: 1500, amount_residual: 500,
          currency_id: [1, 'USD'],
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await syncInvoices(odoo, db);
    expect(result.invoices.updated).toBe(1);

    const invoice = db.prepare('SELECT amount_due FROM invoices WHERE odoo_id = 300').get() as any;
    expect(invoice.amount_due).toBe(500);
  });
});

describe('Database schema', () => {
  it('should have sync_log table', () => {
    db.prepare(`
      INSERT INTO sync_log (entity_type, status, records_synced)
      VALUES ('accounts', 'success', 10)
    `).run();

    const log = db.prepare('SELECT * FROM sync_log').all() as any[];
    expect(log).toHaveLength(1);
    expect(log[0].entity_type).toBe('accounts');
  });

  it('should have invoices table', () => {
    const cols = db.prepare("PRAGMA table_info('invoices')").all() as any[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('odoo_id');
    expect(colNames).toContain('partner_name');
    expect(colNames).toContain('amount_total');
    expect(colNames).toContain('amount_due');
  });

  it('should have payments table', () => {
    const cols = db.prepare("PRAGMA table_info('payments')").all() as any[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('odoo_id');
    expect(colNames).toContain('payment_type');
    expect(colNames).toContain('amount');
  });

  it('should have odoo_id on accounts table', () => {
    const cols = db.prepare("PRAGMA table_info('accounts')").all() as any[];
    expect(cols.map((c: any) => c.name)).toContain('odoo_id');
  });
});
