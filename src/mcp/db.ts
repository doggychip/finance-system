import Database from 'better-sqlite3';

/**
 * DATA LAYER — embedded in finance-system (Shape 2: co-location)
 *
 * Opens a second, read-only connection to the same finance.db already used by
 * the main app.  finance-system's initDb() already sets WAL mode on that file,
 * so WAL is in effect for this connection too.
 *
 * Schema reconciliation vs. the standalone xter-finance-mcp defaults:
 *   - journal_entries: total_debit / total_credit / line_count are computed on
 *     the fly via correlated subqueries — they are not stored columns.
 *   - line_items: account_code / account_name live in the accounts table;
 *     line_items.account_id is a FK to accounts.id.  All line-item queries
 *     JOIN accounts to project the expected field names.
 *   - payments: the stored column is `amount`, not `amount_usd`.
 *     company_id / company_name do not exist on payments in this schema.
 */

let DB_PATH = process.env.DB_PATH ?? 'finance.db';

let db: Database.Database;

/** Override the DB path before first open (called by mountMcp). */
export function setDbPath(p: string): void {
  if (db) throw new Error('setDbPath must be called before the DB is opened');
  DB_PATH = p;
}

export function openDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

export function dbPath(): string {
  return DB_PATH;
}

// ---- shared types ---------------------------------------------------------

export interface CashLine {
  company_id: number;
  company_name: string;
  account_code: string;
  account_name: string;
  cash_kind: 'bank' | 'crypto';
  balance: number;
}

export interface CompanyCash {
  company_id: number;
  company_name: string;
  bank: number;
  crypto: number;
  total: number;
}

export interface CashPosition {
  as_of_date: string;
  filters: { company_id: number | null };
  totals: { bank: number; crypto: number; total: number };
  by_company: CompanyCash[];
  lines: CashLine[];
}

export interface JournalEntrySummary {
  id: string;
  odoo_id: number;
  company_id: number;
  company_name: string;
  date: string;
  description: string;
  reference: string;
  status: string;
  total_debit: number;
  total_credit: number;
  line_count: number;
}

// ---- helpers --------------------------------------------------------------

const cashKind = (code: string): 'bank' | 'crypto' =>
  code.startsWith('10W') ? 'crypto' : 'bank';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Resolve the snapshot to read: latest on/before as_of_date, else global latest. */
export function resolveSnapshotDate(asOfDate?: string): string | null {
  const conn = openDb();
  const row = asOfDate
    ? conn
        .prepare(
          "SELECT MAX(snapshot_date) AS d FROM account_balances WHERE snapshot_date <= ? AND snapshot_date < '9000-01-01'"
        )
        .get(asOfDate)
    : conn.prepare("SELECT MAX(snapshot_date) AS d FROM account_balances WHERE snapshot_date < '9000-01-01'").get();
  const d = (row as { d: string | null } | undefined)?.d ?? null;
  return d;
}

// ---- cash -----------------------------------------------------------------

export function getCashPosition(asOfDate?: string, companyId?: number): CashPosition {
  const conn = openDb();
  const snapshot = resolveSnapshotDate(asOfDate);
  if (!snapshot) {
    return {
      as_of_date: asOfDate ?? '',
      filters: { company_id: companyId ?? null },
      totals: { bank: 0, crypto: 0, total: 0 },
      by_company: [],
      lines: [],
    };
  }

  const params: (string | number)[] = [snapshot];
  let where = "snapshot_date = ? AND account_type = 'asset_cash'";
  if (companyId !== undefined) {
    where += ' AND company_id = ?';
    params.push(companyId);
  }

  const rows = conn
    .prepare(
      `SELECT company_id, company_name, account_code, account_name, balance
         FROM account_balances
        WHERE ${where}
        ORDER BY company_id, account_code`
    )
    .all(...params) as Array<{
    company_id: number;
    company_name: string;
    account_code: string;
    account_name: string;
    balance: number;
  }>;

  const lines: CashLine[] = rows.map((r) => ({
    company_id: r.company_id,
    company_name: r.company_name,
    account_code: r.account_code,
    account_name: r.account_name,
    cash_kind: cashKind(r.account_code),
    balance: r.balance,
  }));

  const byCompanyMap = new Map<number, CompanyCash>();
  for (const l of lines) {
    const c =
      byCompanyMap.get(l.company_id) ??
      { company_id: l.company_id, company_name: l.company_name, bank: 0, crypto: 0, total: 0 };
    if (l.cash_kind === 'bank') {
      c.bank += l.balance;
    } else {
      c.crypto += l.balance;
    }
    c.total += l.balance;
    byCompanyMap.set(l.company_id, c);
  }

  const by_company = [...byCompanyMap.values()]
    .map((c) => ({
      ...c,
      bank: round2(c.bank),
      crypto: round2(c.crypto),
      total: round2(c.total),
    }))
    .sort((a, b) => b.total - a.total);

  // Derive consolidated totals from the per-entity rounded figures so the
  // headline total always equals the sum of the entity breakdown shown to the
  // user. Summing raw line balances and rounding once at the end (the previous
  // approach) double-rounds against the per-entity rounding and can drift a cent
  // -- a number a controller can't sign because it doesn't tie out.
  const totals = {
    bank: round2(by_company.reduce((s, c) => s + c.bank, 0)),
    crypto: round2(by_company.reduce((s, c) => s + c.crypto, 0)),
    total: round2(by_company.reduce((s, c) => s + c.total, 0)),
  };

  return {
    as_of_date: snapshot,
    filters: { company_id: companyId ?? null },
    totals,
    by_company,
    lines,
  };
}

export function getCashHistory(
  startDate?: string,
  endDate?: string,
  limit = 52
): { count: number; filters: { start_date: string | null; end_date: string | null }; snapshots: unknown[] } {
  const conn = openDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (startDate) {
    clauses.push('snapshot_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    clauses.push('snapshot_date <= ?');
    params.push(endDate);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  const snapshots = conn
    .prepare(
      `SELECT * FROM historical_cash_weekly
        ${where}
        ORDER BY snapshot_date DESC
        LIMIT ?`
    )
    .all(...params);

  return {
    count: snapshots.length,
    filters: { start_date: startDate ?? null, end_date: endDate ?? null },
    snapshots,
  };
}

// ---- companies ------------------------------------------------------------

export function getCompany(opts: { companyId?: number; companyName?: string }): unknown {
  const conn = openDb();
  const snapshot = resolveSnapshotDate();
  if (!snapshot) return { error: 'no snapshot data' };

  const params: (string | number)[] = [snapshot];
  let where = 'snapshot_date = ?';
  if (opts.companyId !== undefined) {
    where += ' AND company_id = ?';
    params.push(opts.companyId);
  } else if (opts.companyName !== undefined) {
    where += ' AND company_name = ?';
    params.push(opts.companyName);
  } else {
    return { error: 'provide company_id or company_name' };
  }

  const accounts = conn
    .prepare(
      `SELECT account_code, account_name, account_type, balance
         FROM account_balances
        WHERE ${where}
        ORDER BY account_code`
    )
    .all(...params) as Array<{
    account_code: string;
    account_name: string;
    account_type: string;
    balance: number;
  }>;

  const rollup: Record<string, number> = {};
  for (const a of accounts) {
    rollup[a.account_type] = round2((rollup[a.account_type] ?? 0) + a.balance);
  }

  return { as_of_date: snapshot, account_count: accounts.length, rollup_by_type: rollup, accounts };
}

// ---- ledger ---------------------------------------------------------------

/*
 * total_debit, total_credit, line_count are not stored columns — computed here.
 * The correlated subqueries reference `id` which SQLite resolves to the outer
 * journal_entries row without an explicit table alias.
 */
const JOURNAL_COMPUTED_COLS = `
  COALESCE((SELECT SUM(debit) FROM line_items WHERE journal_entry_id = id), 0) AS total_debit,
  COALESCE((SELECT SUM(credit) FROM line_items WHERE journal_entry_id = id), 0) AS total_credit,
  (SELECT COUNT(*) FROM line_items WHERE journal_entry_id = id) AS line_count`;

export function listRecentJournalEntries(opts: {
  companyId?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  minAmountUsd?: number;
  limit: number;
  offset: number;
}): { total_matching: number; returned: number; limit: number; offset: number; journal_entries: JournalEntrySummary[] } {
  const conn = openDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (opts.status && opts.status !== 'all') {
    clauses.push('status = ?');
    params.push(opts.status);
  }
  if (opts.companyId !== undefined) {
    clauses.push('company_id = ?');
    params.push(opts.companyId);
  }
  if (opts.startDate) {
    clauses.push('date >= ?');
    params.push(opts.startDate);
  }
  if (opts.endDate) {
    clauses.push('date <= ?');
    params.push(opts.endDate);
  }
  if (opts.minAmountUsd !== undefined) {
    // Correlated subquery — `id` resolves to the outer journal_entries.id
    clauses.push(
      '(SELECT COALESCE(SUM(debit), 0) FROM line_items WHERE journal_entry_id = id) >= ?'
    );
    params.push(opts.minAmountUsd);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = (
    conn.prepare(`SELECT COUNT(*) AS n FROM journal_entries ${where}`).get(...params) as { n: number }
  ).n;

  const rows = conn
    .prepare(
      `SELECT id, odoo_id, company_id, company_name, date, description, reference, status,
              ${JOURNAL_COMPUTED_COLS}
         FROM journal_entries
        ${where}
        ORDER BY date DESC, odoo_id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, opts.limit, opts.offset) as JournalEntrySummary[];

  return {
    total_matching: total,
    returned: rows.length,
    limit: opts.limit,
    offset: opts.offset,
    journal_entries: rows,
  };
}

export function searchJournalEntries(opts: {
  query: string;
  companyId?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit: number;
  offset: number;
}): { total_matching: number; returned: number; journal_entries: JournalEntrySummary[] } {
  const conn = openDb();
  const like = `%${opts.query}%`;
  const clauses: string[] = [
    `(je.description LIKE ? OR je.reference LIKE ? OR EXISTS (
        SELECT 1 FROM line_items li WHERE li.journal_entry_id = je.id AND li.description LIKE ?))`,
  ];
  const params: (string | number)[] = [like, like, like];

  if (opts.status && opts.status !== 'all') {
    clauses.push('je.status = ?');
    params.push(opts.status);
  }
  if (opts.companyId !== undefined) {
    clauses.push('je.company_id = ?');
    params.push(opts.companyId);
  }
  if (opts.startDate) {
    clauses.push('je.date >= ?');
    params.push(opts.startDate);
  }
  if (opts.endDate) {
    clauses.push('je.date <= ?');
    params.push(opts.endDate);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const total = (
    conn.prepare(`SELECT COUNT(*) AS n FROM journal_entries je ${where}`).get(...params) as { n: number }
  ).n;

  const rows = conn
    .prepare(
      `SELECT je.id, je.odoo_id, je.company_id, je.company_name, je.date, je.description,
              je.reference, je.status,
              COALESCE((SELECT SUM(debit) FROM line_items WHERE journal_entry_id = je.id), 0) AS total_debit,
              COALESCE((SELECT SUM(credit) FROM line_items WHERE journal_entry_id = je.id), 0) AS total_credit,
              (SELECT COUNT(*) FROM line_items WHERE journal_entry_id = je.id) AS line_count
         FROM journal_entries je
        ${where}
        ORDER BY je.date DESC, je.odoo_id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, opts.limit, opts.offset) as JournalEntrySummary[];

  return { total_matching: total, returned: rows.length, journal_entries: rows };
}

export function getJournalEntry(opts: { journalEntryId?: string; odooId?: number }): unknown {
  const conn = openDb();
  let header: JournalEntrySummary | undefined;
  if (opts.journalEntryId) {
    header = conn
      .prepare(
        `SELECT id, odoo_id, company_id, company_name, date, description, reference, status,
                ${JOURNAL_COMPUTED_COLS}
           FROM journal_entries WHERE id = ?`
      )
      .get(opts.journalEntryId) as JournalEntrySummary | undefined;
  } else if (opts.odooId !== undefined) {
    header = conn
      .prepare(
        `SELECT id, odoo_id, company_id, company_name, date, description, reference, status,
                ${JOURNAL_COMPUTED_COLS}
           FROM journal_entries WHERE odoo_id = ?`
      )
      .get(opts.odooId) as JournalEntrySummary | undefined;
  } else {
    return { error: 'provide journal_entry_id or odoo_id' };
  }
  if (!header) return { error: 'journal entry not found' };

  // account_code / account_name live in the accounts table; join via account_id FK
  const lines = conn
    .prepare(
      `SELECT a.code AS account_code, a.name AS account_name,
              li.debit, li.credit, li.amount_currency, li.currency, li.description
         FROM line_items li
         JOIN accounts a ON a.id = li.account_id
        WHERE li.journal_entry_id = ?
        ORDER BY li.rowid`
    )
    .all(header.id);

  return { ...header, lines };
}

// ---- payments -------------------------------------------------------------

export function listPayments(opts: {
  paymentType?: string;
  state?: string;
  partnerContains?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  limit: number;
  offset: number;
}): { total_matching: number; returned: number; payments: unknown[] } {
  const conn = openDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (opts.paymentType && opts.paymentType !== 'all') {
    clauses.push('payment_type = ?');
    params.push(opts.paymentType);
  }
  if (opts.state) {
    clauses.push('state = ?');
    params.push(opts.state);
  }
  if (opts.partnerContains) {
    clauses.push('partner_name LIKE ?');
    params.push(`%${opts.partnerContains}%`);
  }
  if (opts.startDate) {
    clauses.push('date >= ?');
    params.push(opts.startDate);
  }
  if (opts.endDate) {
    clauses.push('date <= ?');
    params.push(opts.endDate);
  }
  if (opts.minAmount !== undefined) {
    // actual column is `amount`, not `amount_usd`
    clauses.push('amount >= ?');
    params.push(opts.minAmount);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = (
    conn.prepare(`SELECT COUNT(*) AS n FROM payments ${where}`).get(...params) as { n: number }
  ).n;

  const payments = conn
    .prepare(
      `SELECT * FROM payments ${where} ORDER BY date DESC LIMIT ? OFFSET ?`
    )
    .all(...params, opts.limit, opts.offset);

  return { total_matching: total, returned: payments.length, payments };
}

/** Cheap liveness probe used by /mcp/health and at mount time. */
export function healthProbe(): { ok: boolean; latest_snapshot: string | null } {
  const conn = openDb();
  conn.prepare('SELECT 1').get();
  return { ok: true, latest_snapshot: resolveSnapshotDate() };
}
