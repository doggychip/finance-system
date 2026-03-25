import Database from 'better-sqlite3';

export function initDb(filename: string = 'finance.db'): Database.Database {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      odoo_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      code TEXT NOT NULL,
      parent_id TEXT REFERENCES accounts(id),
      description TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      odoo_id INTEGER UNIQUE,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      reference TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'posted', 'void')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      posted_at TEXT,
      voided_at TEXT,
      void_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS line_items (
      id TEXT PRIMARY KEY,
      odoo_id INTEGER UNIQUE,
      journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      description TEXT DEFAULT '',
      CHECK(debit >= 0 AND credit >= 0),
      CHECK(NOT (debit > 0 AND credit > 0))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      odoo_id INTEGER UNIQUE NOT NULL,
      number TEXT,
      partner_name TEXT NOT NULL,
      partner_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('out_invoice', 'in_invoice', 'out_refund', 'in_refund')),
      state TEXT NOT NULL,
      date TEXT NOT NULL,
      due_date TEXT,
      amount_total REAL DEFAULT 0,
      amount_due REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      journal_entry_id TEXT REFERENCES journal_entries(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      odoo_id INTEGER UNIQUE NOT NULL,
      partner_name TEXT NOT NULL,
      partner_id INTEGER,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      payment_type TEXT NOT NULL CHECK(payment_type IN ('inbound', 'outbound')),
      state TEXT NOT NULL,
      reference TEXT DEFAULT '',
      journal_entry_id TEXT REFERENCES journal_entries(id),
      currency TEXT DEFAULT 'USD',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      records_synced INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_line_items_journal ON line_items(journal_entry_id);
    CREATE INDEX IF NOT EXISTS idx_line_items_account ON line_items(account_id);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_odoo_id ON accounts(odoo_id);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_odoo_id ON journal_entries(odoo_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_odoo_id ON invoices(odoo_id);
    CREATE INDEX IF NOT EXISTS idx_payments_odoo_id ON payments(odoo_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_state ON invoices(state);
    CREATE INDEX IF NOT EXISTS idx_payments_state ON payments(state);
  `);

  return db;
}
