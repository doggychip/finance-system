import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setDbPath, getCashPosition } from '../mcp/db';

/**
 * Regression: consolidated totals must tie out to the per-entity breakdown.
 *
 * Bug (fixed): getCashPosition summed RAW line balances and rounded once for
 * totals.total, while by_company rounded per entity. With sub-cent balances the
 * two rounding paths drift by a cent, so the headline total did not equal the
 * sum of the entity rows shown to the user -- a number a controller can't sign.
 *
 * The seed below is crafted to trigger the double-rounding: three entities of
 * 10.006 / 20.006 / 30.006. Per-entity rounded -> 10.01 + 20.01 + 30.01 = 60.03.
 * Round-once-at-end -> round2(60.018) = 60.02. The old code returned 60.02 for
 * totals.total while by_company summed to 60.03.
 */

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cashtieout-'));
  const dbFile = join(dir, 'finance.db');
  const seed = new Database(dbFile);
  seed.exec(`
    CREATE TABLE account_balances (
      snapshot_date TEXT NOT NULL,
      company_id    INTEGER NOT NULL,
      company_name  TEXT NOT NULL,
      account_code  TEXT NOT NULL,
      account_name  TEXT NOT NULL,
      account_type  TEXT NOT NULL,
      balance       REAL NOT NULL
    );
  `);
  const ins = seed.prepare(
    `INSERT INTO account_balances
       (snapshot_date, company_id, company_name, account_code, account_name, account_type, balance)
     VALUES (@d, @cid, @cname, @code, @aname, 'asset_cash', @bal)`
  );
  const rows = [
    { cid: 1, cname: 'ALPHA', code: '100001', aname: 'Bank A', bal: 10.006 },
    { cid: 2, cname: 'BETA', code: '100002', aname: 'Bank B', bal: 20.006 },
    { cid: 3, cname: 'GAMMA', code: '100003', aname: 'Bank C', bal: 30.006 },
  ];
  for (const r of rows) ins.run({ d: '2026-06-03', ...r });
  seed.close();

  setDbPath(dbFile);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

describe('getCashPosition consolidated tie-out', () => {
  it('headline total equals the sum of the per-entity totals shown', () => {
    const r = getCashPosition();

    const sumOfEntities = round2(r.by_company.reduce((s, c) => s + c.total, 0));

    // The exact failure the controller persona (CTRL-01) catches: the breakdown
    // must add back to the headline total, to the cent.
    expect(r.totals.total).toBe(sumOfEntities);
    expect(r.totals.total).toBe(60.03);
  });

  it('headline total equals bank + crypto pots', () => {
    const r = getCashPosition();
    expect(r.totals.total).toBe(round2(r.totals.bank + r.totals.crypto));
  });

  it('per-pot totals also tie to their entity breakdown', () => {
    const r = getCashPosition();
    const sumBank = round2(r.by_company.reduce((s, c) => s + c.bank, 0));
    const sumCrypto = round2(r.by_company.reduce((s, c) => s + c.crypto, 0));
    expect(r.totals.bank).toBe(sumBank);
    expect(r.totals.crypto).toBe(sumCrypto);
  });
});
