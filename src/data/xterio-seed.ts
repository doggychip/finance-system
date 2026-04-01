import Database from 'better-sqlite3';

// Xterio Foundation data (not in Odoo, CHF-based)
// Exchange rates CHF/USD per month
const FX_RATES: Record<string, number> = {
  '2025-05': 1.22,
  '2025-06': 1.26,
  '2025-07': 1.22,
  '2025-08': 1.25,
  '2025-09': 1.25,
  '2025-10': 1.24,
  '2025-11': 1.25,
  '2025-12': 1.26,
  '2026-01': 1.29,
  '2026-02': 1.28,
};

interface AccountData {
  code: string;
  name: string;
  category: string;
  values: Record<string, number>; // period -> CHF amount
}

const XTERIO_ACCOUNTS: AccountData[] = [
  // Corporate Premium
  { code: '200001', name: 'Current acc', category: 'Corporate Premium',
    values: { '2025-05': 8142.46, '2025-06': 7642.46, '2025-07': 7642.46, '2025-08': 514.81, '2025-09': 514.81, '2025-10': 514.81, '2025-11': 514.81, '2025-12': 514.81, '2026-01': 514.81, '2026-02': -2389.4 } },
  { code: '201333', name: 'Current acc', category: 'Corporate Premium',
    values: { '2025-05': 1006373.24, '2025-06': 82361.86, '2025-07': 35058.25, '2025-08': -2244.9, '2025-09': 4078.03, '2025-10': 1384.18, '2025-11': 1375.42, '2025-12': 7722.46, '2026-01': 2103.46, '2026-02': 33275.53 } },
  { code: '500333', name: 'Safekeeping acc', category: 'Corporate Premium',
    values: { '2025-05': 0, '2025-06': 0, '2025-07': 0, '2025-08': 0, '2025-09': 0, '2025-10': 0, '2025-11': 0, '2025-12': 0, '2026-01': 0, '2026-02': 0 } },

  // Liquidity Optimizer
  { code: '202001', name: 'Liquidity Optimizer', category: 'Liquidity Optimizer',
    values: { '2025-05': 0, '2025-06': 0, '2025-07': 0, '2025-08': 0, '2025-09': 0, '2025-10': 0, '2025-11': 0, '2025-12': 0, '2026-01': 0, '2026-02': 0 } },
  { code: '203814', name: 'Liquidity Optimizer', category: 'Liquidity Optimizer',
    values: { '2025-05': 7084.03, '2025-06': 7059.05, '2025-07': 7007.39, '2025-08': 7065.10, '2025-09': 7060.72, '2025-10': 7024.06, '2025-11': 16386.73, '2025-12': 16314.48, '2026-01': 16104.34, '2026-02': 15914.16 } },
  { code: '204333', name: 'Liquidity Optimizer', category: 'Liquidity Optimizer',
    values: { '2025-05': 413.17, '2025-06': 10213.53, '2025-07': 10474.22, '2025-08': 1631.30, '2025-09': 6819.49, '2025-10': 90380.40, '2025-11': -214707.55, '2025-12': -151201.64, '2026-01': 11318.87, '2026-02': 23245.94 } },
  { code: '502333', name: 'Liquidity Optimizer', category: 'Liquidity Optimizer',
    values: { '2025-05': 5023692.31, '2025-06': 4910006.64, '2025-07': 5003205.70, '2025-08': 4933353.48, '2025-09': 4898541.29, '2025-10': 4824169.37, '2025-11': 5076471.02, '2025-12': 4838967.96, '2026-01': 4584865.79, '2026-02': 4557371.91 } },

  // Foreign exchange forward
  { code: '600814', name: 'Foreign exchange forward', category: 'FX Forward',
    values: { '2025-05': -2484050.12, '2025-06': -2475288.29, '2025-07': -2457175.34, '2025-08': -2477411.01, '2025-09': -1167865.16, '2025-10': -176594.01, '2025-11': -186665.81, '2025-12': -185842.76, '2026-01': -183449.03, '2026-02': -181282.59 } },
  { code: '601333', name: 'Foreign exchange forward', category: 'FX Forward',
    values: { '2025-05': 2483900.27, '2025-06': 2392993.37, '2025-07': 2454071.40, '2025-08': 2468710.60, '2025-09': 1140192.08, '2025-10': 151225.04, '2025-11': 185456.83, '2025-12': 183694.56, '2026-01': 179540.41, '2026-02': 183617.06 } },
];

export function seedXterioFoundation(db: Database.Database) {
  const existing = db.prepare("SELECT COUNT(*) as count FROM manual_balances WHERE entity = 'Xterio Foundation'").get() as any;
  if (existing.count > 0) {
    console.log('[seed] Xterio Foundation data already exists, skipping');
    return;
  }

  console.log('[seed] Inserting Xterio Foundation manual data...');

  const insert = db.prepare(`
    INSERT INTO manual_balances (entity, account_code, account_name, period, amount_local, currency, exchange_rate, amount_usd, category)
    VALUES (?, ?, ?, ?, ?, 'CHF', ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const acct of XTERIO_ACCOUNTS) {
      for (const [period, chfAmount] of Object.entries(acct.values)) {
        const rate = FX_RATES[period] || 1.25;
        const usdAmount = chfAmount * rate;
        insert.run('Xterio Foundation', acct.code, acct.name, period, chfAmount, rate, usdAmount, acct.category);
      }
    }
  });

  tx();
  console.log('[seed] Xterio Foundation data inserted');
}
