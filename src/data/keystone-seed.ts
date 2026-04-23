import Database from 'better-sqlite3';

export function seedKeystoneFoundation(db: Database.Database) {
  // Fix any previously-inserted incorrect rows
  const fixed = db.prepare(`
    UPDATE manual_balances
    SET account_name = 'Keystone Foundation',
        currency = 'USDC',
        account_code = 'KEYSTONE_USDC'
    WHERE entity = 'Keystone Foundation'
      AND account_name = 'PLAY ALGORITHM (BVI)'
  `).run();
  if (fixed.changes > 0) {
    console.log('[seed] Corrected ' + fixed.changes + ' existing Keystone Foundation row(s)');
  }

  const existing = db.prepare("SELECT COUNT(*) as count FROM manual_balances WHERE entity = 'Keystone Foundation'").get() as any;
  if (existing.count > 0) {
    console.log('[seed] Keystone Foundation data already exists, skipping');
    return;
  }

  console.log('[seed] Inserting Keystone Foundation placeholder row...');

  const now = new Date();
  const period = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  db.prepare(`
    INSERT INTO manual_balances (entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category)
    VALUES (?, ?, ?, ?, ?, 'USDC', ?, ?, ?)
  `).run('Keystone Foundation', 'KEYSTONE_USDC', 'Keystone Foundation', period, 0, 1, 0, 'Cash');

  console.log('[seed] Keystone Foundation placeholder inserted for period ' + period);
}
