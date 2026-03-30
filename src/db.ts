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
      odoo_type TEXT DEFAULT '',
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
      company_id INTEGER,
      company_name TEXT DEFAULT '',
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
      amount_currency REAL DEFAULT 0,
      currency TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS manual_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      period TEXT NOT NULL,
      amount_local REAL DEFAULT 0,
      currency TEXT DEFAULT 'CHF',
      exchange_rate REAL DEFAULT 1,
      amount_usd REAL DEFAULT 0,
      category TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_manual_entity_period ON manual_balances(entity, period);

    CREATE TABLE IF NOT EXISTS account_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      company_name TEXT NOT NULL,
      account_odoo_id INTEGER NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL DEFAULT 0,
      snapshot_date TEXT NOT NULL,
      synced_at TEXT DEFAULT (datetime('now')),
      UNIQUE(company_id, account_odoo_id, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_ab_company_snapshot ON account_balances(company_id, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_ab_snapshot ON account_balances(snapshot_date);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'finance',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_date TEXT,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done', 'cancelled')),
      category TEXT DEFAULT 'general',
      assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT DEFAULT '',
      severity TEXT DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'critical')),
      category TEXT DEFAULT 'general',
      entity TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      is_resolved INTEGER DEFAULT 0,
      resolved_by INTEGER REFERENCES users(id),
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
    CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(is_resolved);
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

    -- Seed default users if empty
    INSERT OR IGNORE INTO users (username, password, display_name, role) VALUES
      ('ryan', 'finance123', 'Ryan Cheung', 'admin'),
      ('finance1', 'finance123', 'Finance Team 1', 'finance'),
      ('finance2', 'finance123', 'Finance Team 2', 'finance');
  `);

  return db;
}
