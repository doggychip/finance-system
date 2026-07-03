import Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { openDb, dbPath } from './db';

/**
 * FRESHNESS / DATA-AGE SOURCE OF TRUTH
 *
 * One module answers "how stale is finance.db" and everything else reads from
 * it: the get_sync_status tool (full report), the per-response data_age_hours /
 * stale stamp added to every tool result (see ok() in tools.ts), and the
 * /healthz endpoint (see mount.ts).
 *
 * Why not the file mtime? finance.db is written by the Odoo sync. When the sync
 * FAILS (e.g. Odoo auth error) it still writes an error row to `sync_log`,
 * bumping the file mtime even though no business data advanced. So mtime is
 * reported for diagnostics but is deliberately NOT used to decide staleness. The
 * canonical signal is the newest successful write timestamp across the data
 * tables plus the last successful sync_log row.
 */

/** A snapshot older than this (by last successful data write) is considered stale. */
export const STALE_THRESHOLD_HOURS = 26;

/** Snapshot tables and the column that carries their business "as-of" date. */
const SNAPSHOT_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'account_balances', column: 'snapshot_date' },
  { table: 'historical_cash_weekly', column: 'snapshot_date' },
  { table: 'historical_bs_monthly', column: 'month_end' },
  { table: 'historical_pl_monthly', column: 'month_start' },
  { table: 'historical_fiat_deposits', column: 'snapshot_date' },
  { table: 'historical_crypto_deposits', column: 'snapshot_date' },
];

/**
 * Columns that carry an actual write timestamp ("YYYY-MM-DD HH:MM:SS", UTC via
 * SQLite datetime('now')). The MAX across these — plus the last successful
 * sync — defines `last_data_timestamp`.
 */
const WRITE_TS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'account_balances', column: 'synced_at' },
  { table: 'journal_entries', column: 'updated_at' },
  { table: 'journal_entries', column: 'created_at' },
  { table: 'invoices', column: 'updated_at' },
  { table: 'payments', column: 'updated_at' },
];

export interface SnapshotFreshness {
  table: string;
  date_column: string;
  latest_date: string | null;
}

export interface TableWriteFreshness {
  table: string;
  ts_column: string;
  latest_write: string | null;
}

export interface FutureDatedEntry {
  date: string;
  company_name: string;
  reference: string;
  description: string;
}

export interface FutureDated {
  /** Journal entries dated after today (the sync run date). */
  count: number;
  max_date: string | null;
  /** Up to 10 newest future-dated entries, for triage. */
  sample: FutureDatedEntry[];
}

export interface Freshness {
  generated_at: string;
  /** Canonical freshness signal (ISO UTC) — newest successful data write. */
  last_data_timestamp: string | null;
  data_age_hours: number | null;
  stale: boolean;
  stale_threshold_hours: number;
  /** File mtime (ISO UTC). Reported only; NOT used for staleness — see file docstring. */
  file_mtime: string | null;
  last_successful_sync: string | null;
  snapshots: SnapshotFreshness[];
  table_writes: TableWriteFreshness[];
  row_counts: Record<string, number>;
  /**
   * Journal entries dated in the future (date > today). Surfaced — not hidden —
   * because they're usually intentional (e.g. pre-posted amortization schedules)
   * but they corrupt any "latest entry" / entry-date-ordered view. Flagging here
   * turns a six-months-later surprise into a one-call check.
   */
  future_dated: FutureDated;
  /** Set when the freshness probe itself partially failed. */
  error?: string;
}

/** The light stamp merged into every tool response. */
export interface FreshnessStamp {
  data_age_hours: number | null;
  stale: boolean;
  data_as_of: string | null;
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: Freshness } | null = null;

/** Parse SQLite "YYYY-MM-DD HH:MM:SS" (UTC) into a Date, or null. */
function parseSqliteUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function existingTables(conn: Database.Database): Set<string> {
  const rows = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function maxColumn(conn: Database.Database, table: string, column: string): string | null {
  const row = conn.prepare(`SELECT MAX(${column}) AS m FROM ${table}`).get() as { m: string | null };
  return row?.m ?? null;
}

function rowCount(conn: Database.Database, table: string): number {
  const row = conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row?.n ?? 0;
}

/** Compute freshness (cached for {@link CACHE_TTL_MS}). Never throws. */
export function computeFreshness(opts: { force?: boolean } = {}): Freshness {
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const generated_at = new Date(now).toISOString();
  let value: Freshness;
  try {
    const conn = openDb();
    const tables = existingTables(conn);

    const snapshots: SnapshotFreshness[] = SNAPSHOT_TABLES.filter((s) => tables.has(s.table)).map(
      (s) => ({
        table: s.table,
        date_column: s.column,
        latest_date: maxColumn(conn, s.table, s.column),
      })
    );

    const table_writes: TableWriteFreshness[] = WRITE_TS.filter((w) => tables.has(w.table)).map(
      (w) => ({
        table: w.table,
        ts_column: w.column,
        latest_write: maxColumn(conn, w.table, w.column),
      })
    );

    let last_successful_sync: string | null = null;
    if (tables.has('sync_log')) {
      const row = conn
        .prepare("SELECT MAX(completed_at) AS m FROM sync_log WHERE status = 'success'")
        .get() as { m: string | null };
      last_successful_sync = row?.m ?? null;
    }

    // Canonical signal: newest successful write timestamp across data tables +
    // last successful sync. These share the "YYYY-MM-DD HH:MM:SS" UTC format,
    // so lexicographic MAX is correct.
    const candidates = [...table_writes.map((w) => w.latest_write), last_successful_sync].filter(
      (s): s is string => !!s
    );
    const newestRaw = candidates.length ? candidates.reduce((a, b) => (a > b ? a : b)) : null;
    const newest = parseSqliteUtc(newestRaw);
    const last_data_timestamp = newest ? newest.toISOString() : null;

    // Guard against future timestamps (clamp age to >= 0 so a bad future row
    // can't mask staleness with a negative age).
    const ageHours = newest ? Math.max(0, (now - newest.getTime()) / 3_600_000) : null;
    const data_age_hours = ageHours === null ? null : Math.round(ageHours * 10) / 10;

    const row_counts: Record<string, number> = {};
    for (const t of [...tables].sort()) {
      row_counts[t] = rowCount(conn, t);
    }

    // Future-dated journal entries (date > today). today = sync run date in UTC.
    let future_dated: FutureDated = { count: 0, max_date: null, sample: [] };
    if (tables.has('journal_entries')) {
      const today = new Date(now).toISOString().slice(0, 10);
      const { n } = conn
        .prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE date > ?')
        .get(today) as { n: number };
      if (n > 0) {
        const { m } = conn
          .prepare('SELECT MAX(date) AS m FROM journal_entries WHERE date > ?')
          .get(today) as { m: string | null };
        const sample = conn
          .prepare(
            `SELECT date, company_name, reference, description
               FROM journal_entries
              WHERE date > ?
              ORDER BY date DESC
              LIMIT 10`
          )
          .all(today) as FutureDatedEntry[];
        future_dated = { count: n, max_date: m, sample };
      }
    }

    let file_mtime: string | null = null;
    try {
      file_mtime = statSync(dbPath()).mtime.toISOString();
    } catch {
      file_mtime = null;
    }

    value = {
      generated_at,
      last_data_timestamp,
      data_age_hours,
      stale: data_age_hours === null || data_age_hours > STALE_THRESHOLD_HOURS,
      stale_threshold_hours: STALE_THRESHOLD_HOURS,
      file_mtime,
      last_successful_sync,
      snapshots,
      table_writes,
      row_counts,
      future_dated,
    };
  } catch (err) {
    // Degrade safely: a freshness probe failure must never break a tool call.
    value = {
      generated_at,
      last_data_timestamp: null,
      data_age_hours: null,
      stale: true,
      stale_threshold_hours: STALE_THRESHOLD_HOURS,
      file_mtime: null,
      last_successful_sync: null,
      snapshots: [],
      table_writes: [],
      row_counts: {},
      future_dated: { count: 0, max_date: null, sample: [] },
      error: err instanceof Error ? err.message : String(err),
    };
  }

  cache = { at: now, value };
  return value;
}

/** The light per-response stamp, derived from {@link computeFreshness}. */
export function freshnessStamp(): FreshnessStamp {
  const f = computeFreshness();
  return {
    data_age_hours: f.data_age_hours,
    stale: f.stale,
    data_as_of: f.last_data_timestamp,
  };
}
