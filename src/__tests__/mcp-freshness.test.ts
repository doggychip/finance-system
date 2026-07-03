import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setDbPath } from '../mcp/db';
import { computeFreshness, freshnessStamp, STALE_THRESHOLD_HOURS } from '../mcp/freshness';

/**
 * Freshness source-of-truth behaviour. Seeds a temp finance.db with fixed
 * timestamps and drives "now" via fake timers so the fresh / stale boundary is
 * deterministic. Key invariants under test:
 *   - last_data_timestamp = newest SUCCESSFUL write (error sync rows ignored)
 *   - staleness comes from that timestamp, NOT the file mtime (which a failed
 *     sync would bump)
 *   - future-dated journal entries are flagged, not hidden
 */

let dir: string;

// Newest successful write across the seeded data = 2026-06-01 12:00:00 UTC.
const NEWEST_WRITE = '2026-06-01 12:00:00';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcpfresh-'));
  const dbFile = join(dir, 'finance.db');
  const seed = new Database(dbFile);
  seed.exec(`
    CREATE TABLE account_balances (
      company_name TEXT, account_code TEXT, snapshot_date TEXT, synced_at TEXT
    );
    CREATE TABLE journal_entries (
      date TEXT, company_name TEXT, reference TEXT, description TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE invoices (updated_at TEXT);
    CREATE TABLE payments (updated_at TEXT);
    CREATE TABLE historical_cash_weekly (snapshot_date TEXT);
    CREATE TABLE sync_log (status TEXT, completed_at TEXT);

    INSERT INTO account_balances VALUES ('ALPHA', '100001', '2026-06-01', '${NEWEST_WRITE}');
    INSERT INTO journal_entries VALUES
      ('2026-06-01', 'ALPHA', 'JE-1', 'normal entry', '2026-05-30 09:00:00', '2026-06-01 11:00:00'),
      ('2026-12-30', 'ALPHA', 'AMORT-1', 'pre-posted amortization', '2026-05-01 09:00:00', '2026-05-01 09:00:00');
    INSERT INTO invoices VALUES ('2026-05-20 08:00:00');
    INSERT INTO payments VALUES ('2026-05-25 08:00:00');
    INSERT INTO historical_cash_weekly VALUES ('2026-06-01');
    -- Newest sync_log row is an ERROR at a LATER time; it must NOT count as
    -- fresh data (a failed sync advances nothing).
    INSERT INTO sync_log VALUES
      ('success', '${NEWEST_WRITE}'),
      ('error',   '2026-06-05 04:00:00');
  `);
  seed.close();

  setDbPath(dbFile);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('computeFreshness', () => {
  it('is fresh 6h after the newest successful write', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T18:00:00Z')); // +6h

    const f = computeFreshness({ force: true });

    expect(f.last_data_timestamp).toBe('2026-06-01T12:00:00.000Z');
    expect(f.data_age_hours).toBe(6);
    expect(f.stale).toBe(false);
    expect(f.stale_threshold_hours).toBe(STALE_THRESHOLD_HOURS);
    // The newer sync_log row is an error — last successful sync stays at 12:00.
    expect(f.last_successful_sync).toBe(NEWEST_WRITE);
  });

  it('is stale once the newest write is older than the threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T18:00:00Z')); // well past 26h

    const f = computeFreshness({ force: true });

    expect(f.stale).toBe(true);
    // File mtime is "now" (just written) yet the result is stale: proves mtime
    // is reported but not used for the staleness decision.
    expect(f.file_mtime).not.toBeNull();
    expect(f.data_age_hours).toBeGreaterThan(STALE_THRESHOLD_HOURS);
  });

  it('flags future-dated journal entries without hiding them', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T18:00:00Z'));

    const f = computeFreshness({ force: true });

    expect(f.future_dated.count).toBe(1);
    expect(f.future_dated.max_date).toBe('2026-12-30');
    expect(f.future_dated.sample[0].reference).toBe('AMORT-1');
  });

  it('reports snapshot + write freshness and row counts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T18:00:00Z'));

    const f = computeFreshness({ force: true });

    const snap = f.snapshots.find((s) => s.table === 'account_balances');
    expect(snap?.latest_date).toBe('2026-06-01');
    expect(f.row_counts.journal_entries).toBe(2);
    expect(f.error).toBeUndefined();
  });
});

describe('freshnessStamp', () => {
  it('projects the light three-field stamp from the full report', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T18:00:00Z'));

    const stamp = freshnessStamp();
    expect(stamp).toEqual({
      data_age_hours: 6,
      stale: false,
      data_as_of: '2026-06-01T12:00:00.000Z',
    });
  });
});
