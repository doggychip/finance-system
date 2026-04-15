import Database from 'better-sqlite3';

export function migrateHistoricalCash(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS historical_cash_weekly (
      snapshot_date TEXT NOT NULL UNIQUE,
      grand_total REAL NOT NULL DEFAULT 0,
      platform_total REAL NOT NULL DEFAULT 0,
      aod_total REAL NOT NULL DEFAULT 0,
      xlabs_total REAL NOT NULL DEFAULT 0,
      lholding_total REAL NOT NULL DEFAULT 0,
      overworld_total REAL NOT NULL DEFAULT 0,
      reach_total REAL NOT NULL DEFAULT 0,
      foundation_total REAL NOT NULL DEFAULT 0,
      cs_total REAL NOT NULL DEFAULT 0,
      palio_total REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_historical_cash_weekly_date ON historical_cash_weekly(snapshot_date);

    CREATE TABLE IF NOT EXISTS historical_bs_monthly (
      month_end TEXT NOT NULL UNIQUE,
      platform_cash REAL NOT NULL DEFAULT 0,
      aod_cash REAL NOT NULL DEFAULT 0,
      lholding_cash REAL NOT NULL DEFAULT 0,
      overworld_cash REAL NOT NULL DEFAULT 0,
      non_ow_closing REAL NOT NULL DEFAULT 0,
      ow_reach_closing REAL NOT NULL DEFAULT 0,
      total_closing REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_historical_bs_monthly_date ON historical_bs_monthly(month_end);

    CREATE TABLE IF NOT EXISTS historical_fiat_deposits (
      snapshot_date TEXT NOT NULL UNIQUE,
      svb_mma REAL NOT NULL DEFAULT 0,
      foundation_usd REAL NOT NULL DEFAULT 0,
      foundation_eur REAL NOT NULL DEFAULT 0,
      fiat_total REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_historical_fiat_deposits_date ON historical_fiat_deposits(snapshot_date);

    CREATE TABLE IF NOT EXISTS historical_crypto_deposits (
      snapshot_date TEXT NOT NULL UNIQUE,
      usdc_amount REAL NOT NULL DEFAULT 0,
      usdt_amount REAL NOT NULL DEFAULT 0,
      total_fixed REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_historical_crypto_deposits_date ON historical_crypto_deposits(snapshot_date);

    CREATE TABLE IF NOT EXISTS historical_pl_monthly (
      month_start TEXT NOT NULL UNIQUE,
      revenue REAL NOT NULL DEFAULT 0,
      expenses REAL NOT NULL DEFAULT 0,
      net_profit REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_historical_pl_monthly_date ON historical_pl_monthly(month_start);
  `);
}
