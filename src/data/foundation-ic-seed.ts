import Database from 'better-sqlite3';

const START_PERIOD = '2025-05';

function generatePeriods(start: string, endDate: Date): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const ey = endDate.getFullYear();
  const em = endDate.getMonth() + 1;
  const startIdx = sy * 12 + sm;
  const endIdx = ey * 12 + em;
  const periods: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const y = Math.floor((i - 1) / 12);
    const m = ((i - 1) % 12) + 1;
    periods.push(y + '-' + String(m).padStart(2, '0'));
  }
  return periods;
}

export function seedFoundationIC(db: Database.Database) {
  const periods = generatePeriods(START_PERIOD, new Date());

  const existsStmt = db.prepare(
    "SELECT 1 FROM manual_balances WHERE entity = 'Xterio Foundation' AND period = ? AND account_code = 'FOUNDATION_IC' LIMIT 1"
  );
  const insert = db.prepare(`
    INSERT INTO manual_balances (entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    let inserted = 0;
    for (const period of periods) {
      if (!existsStmt.get(period)) {
        insert.run('Xterio Foundation', 'FOUNDATION_IC', 'IC Payable (USD)', period, 0, 'USD', 1, 0, 'IC');
        inserted++;
      }
    }
    return inserted;
  });

  const count = tx();
  if (count > 0) {
    console.log('[seed] Foundation IC: inserted ' + count + ' placeholder row(s) from ' + START_PERIOD);
  } else {
    console.log('[seed] Foundation IC: all periods already present');
  }
}
