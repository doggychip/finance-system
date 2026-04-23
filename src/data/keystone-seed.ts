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
  // Migrate legacy single-row periods: if a period has only one row with the old
  // KEYSTONE_USDC code, keep it as the crypto row but ensure account_name matches
  // the new naming. The fiat row will be inserted below if missing.
  const fixedUsdc = db.prepare(`
    UPDATE manual_balances
    SET account_name = 'Keystone Foundation (USDC)',
        currency = 'USDC',
        account_code = 'KEYSTONE_USDC'
    WHERE entity = 'Keystone Foundation'
      AND account_code = 'KEYSTONE_USDC'
      AND (account_name != 'Keystone Foundation (USDC)' OR currency != 'USDC')
  `).run();
  if (fixedUsdc.changes > 0) {
    console.log('[seed] Corrected ' + fixedUsdc.changes + ' existing Keystone USDC row(s)');
  }

  const fixedFiat = db.prepare(`
    UPDATE manual_balances
    SET account_name = 'Keystone Foundation (USD)',
        currency = 'USD',
        account_code = 'KEYSTONE_FIAT'
    WHERE entity = 'Keystone Foundation'
      AND account_code = 'KEYSTONE_FIAT'
      AND (account_name != 'Keystone Foundation (USD)' OR currency != 'USD')
  `).run();
  if (fixedFiat.changes > 0) {
    console.log('[seed] Corrected ' + fixedFiat.changes + ' existing Keystone Fiat row(s)');
  }

  const periods = generatePeriods(START_PERIOD, new Date());

  const existsStmt = db.prepare(
    "SELECT 1 FROM manual_balances WHERE entity = 'Keystone Foundation' AND period = ? AND account_code = ? LIMIT 1"
  );
  const insert = db.prepare(`
    INSERT INTO manual_balances (entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    let inserted = 0;
    for (const period of periods) {
      if (!existsStmt.get(period, 'KEYSTONE_FIAT')) {
        insert.run('Keystone Foundation', 'KEYSTONE_FIAT', 'Keystone Foundation (USD)', period, 0, 'USD', 1, 0, 'Cash');
        inserted++;
      }
      if (!existsStmt.get(period, 'KEYSTONE_USDC')) {
        insert.run('Keystone Foundation', 'KEYSTONE_USDC', 'Keystone Foundation (USDC)', period, 0, 'USDC', 1, 0, 'Cash');
        inserted++;
      }
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
