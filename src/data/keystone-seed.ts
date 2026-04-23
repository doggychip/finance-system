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

export function seedKeystoneFoundation(db: Database.Database) {
  // Fix any previously-inserted incorrect rows
  const fixed = db.prepare(`
    UPDATE manual_balances
    SET account_name = 'Keystone Foundation',
        currency = 'USDC',
        account_code = 'KEYSTONE_USDC'
    WHERE entity = 'Keystone Foundation'
      AND (account_name != 'Keystone Foundation'
           OR currency != 'USDC'
           OR account_code != 'KEYSTONE_USDC')
  `).run();
  if (fixed.changes > 0) {
    console.log('[seed] Corrected ' + fixed.changes + ' existing Keystone Foundation row(s)');
  }

  const periods = generatePeriods(START_PERIOD, new Date());

  const existsStmt = db.prepare(
    "SELECT 1 FROM manual_balances WHERE entity = 'Keystone Foundation' AND period = ? LIMIT 1"
  );
  const insert = db.prepare(`
    INSERT INTO manual_balances (entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category)
    VALUES (?, ?, ?, ?, ?, 'USDC', ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    let inserted = 0;
    for (const period of periods) {
      if (existsStmt.get(period)) continue;
      insert.run('Keystone Foundation', 'KEYSTONE_USDC', 'Keystone Foundation', period, 0, 1, 0, 'Cash');
      inserted++;
    }
    return inserted;
  });

  const count = tx();
  if (count > 0) {
    console.log('[seed] Keystone Foundation: inserted ' + count + ' placeholder row(s) from ' + START_PERIOD);
  } else {
    console.log('[seed] Keystone Foundation: all periods already present');
  }
}
