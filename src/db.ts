import Database from 'better-sqlite3';

export function initDb(filename: string = 'finance.db'): Database.Database {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      code TEXT UNIQUE NOT NULL,
      parent_id TEXT REFERENCES accounts(id),
      description TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
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
      journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      description TEXT DEFAULT '',
      CHECK(debit >= 0 AND credit >= 0),
      CHECK(NOT (debit > 0 AND credit > 0))
    );

    CREATE INDEX IF NOT EXISTS idx_line_items_journal ON line_items(journal_entry_id);
    CREATE INDEX IF NOT EXISTS idx_line_items_account ON line_items(account_id);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);
  `);

  return db;
}
