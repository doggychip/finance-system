import Database from 'better-sqlite3';

const WEEKLY_DATA = [
  { date: '2025-03-23', total: 28469856, plat: 1019940, aod: 2204063, xlabs: 0, lh: 3441434, ow: 10940457, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-04-14', total: 26152257, plat: 973316, aod: 1728486, xlabs: 0, lh: 3090633, ow: 9361357, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-06-23', total: 25200566, plat: 2610705, aod: 965604, xlabs: 0, lh: 1221363, ow: 11753673, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-07-14', total: 27315752, plat: 5321921, aod: 320937, xlabs: 0, lh: 9910114, ow: 4489472, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-08-27', total: 25699937, plat: 3206564, aod: 552622, xlabs: 0, lh: 10854899, ow: 3994347, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-09-11', total: 24797973, plat: 2816786, aod: 446410, xlabs: 0, lh: 10709590, ow: 3962218, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-10-15', total: 23304816, plat: 2406496, aod: 713377, xlabs: 0, lh: 9714030, ow: 3671767, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-10-22', total: 23018243, plat: 2927436, aod: 648750, xlabs: 0, lh: 9001242, ow: 3671668, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-10-29', total: 22299902, plat: 2780376, aod: 522740, xlabs: 0, lh: 8602367, ow: 3672066, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-11-12', total: 21262447, plat: 1956003, aod: 541173, xlabs: 0, lh: 8567337, ow: 3372568, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-12-10', total: 21056305, plat: 2267697, aod: 520431, xlabs: 0, lh: 8262687, ow: 3373976, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-12-17', total: 20554175, plat: 2212872, aod: 444890, xlabs: 0, lh: 8260791, ow: 3067564, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-12-25', total: 20537514, plat: 2221282, aod: 425136, xlabs: 0, lh: 8257900, ow: 3067846, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2025-12-31', total: 20376358, plat: 1352223, aod: 189330, xlabs: 0, lh: 3468315, ow: 8843496, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-01-14', total: 19867408, plat: 1148075, aod: 154627, xlabs: 0, lh: 7160129, ow: 5165031, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-01-21', total: 20118292, plat: 1092159, aod: 487677, xlabs: 0, lh: 7146421, ow: 5163689, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-01-31', total: 19808602, plat: 932454, aod: 470570, xlabs: 0, lh: 7074651, ow: 5172928, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-02-04', total: 19778945, plat: 927730, aod: 469426, xlabs: 0, lh: 7051914, ow: 5170702, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-02-28', total: 19387024, plat: 978139, aod: 412183, xlabs: 0, lh: 7635076, ow: 4073918, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-03-05', total: 19406267, plat: 1579922, aod: 411775, xlabs: 0, lh: 7041346, ow: 4074313, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-03-19', total: 19389661, plat: 1581672, aod: 412773, xlabs: 0, lh: 7065069, ow: 3772868, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-03-25', total: 19226844, plat: 1575362, aod: 385063, xlabs: 0, lh: 7055370, ow: 3769865, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-03-31', total: 18923528, plat: 1373265, aod: 385568, xlabs: 0, lh: 7016538, ow: 3779443, reach: 0, foundation: 0, cs: 0, palio: 0 },
  { date: '2026-04-09', total: 12978870, plat: 1349247, aod: 385007, xlabs: 6997, lh: 7023670, ow: 3755125, reach: 196073, foundation: 0, cs: 7856, palio: 0 },
];

const MONTHLY_BS_DATA = [
  { month_end: '2025-01-31', plat: 12938381, aod: 0, lh: 9399081, ow: 2991091, non_ow: 0, ow_reach: 0, close: 15194263 },
  { month_end: '2025-02-28', plat: 11136636, aod: 0, lh: 8953661, ow: 2663230, non_ow: 0, ow_reach: 0, close: 16226655 },
  { month_end: '2025-03-31', plat: 10984131, aod: 0, lh: 10544968, ow: 2385340, non_ow: 0, ow_reach: 0, close: 17289140 },
  { month_end: '2025-04-30', plat: 10387304, aod: 0, lh: 9287439, ow: 28, non_ow: 0, ow_reach: 0, close: 27175633 },
  { month_end: '2025-05-31', plat: 10233847, aod: 0, lh: 11367845, ow: 28, non_ow: 0, ow_reach: 0, close: 28974110 },
  { month_end: '2025-06-30', plat: 9064481, aod: 0, lh: 6923904, ow: 16012, non_ow: 0, ow_reach: 0, close: 81770 },
  { month_end: '2025-07-31', plat: 9751546, aod: 0, lh: 10831319, ow: 4480679, non_ow: 0, ow_reach: 0, close: 26318108 },
  { month_end: '2025-08-31', plat: 9056669, aod: 0, lh: 10766571, ow: 3962308, non_ow: 0, ow_reach: 0, close: 24386452 },
  { month_end: '2025-09-30', plat: 8918667, aod: 0, lh: 9574650, ow: 3672266, non_ow: 0, ow_reach: 0, close: 24376310 },
  { month_end: '2025-10-31', plat: 8828934, aod: 0, lh: 8553651, ow: 3674090, non_ow: 0, ow_reach: 0, close: 22039899 },
  { month_end: '2025-11-30', plat: 8488244, aod: 0, lh: 8261142, ow: 3381082, non_ow: 0, ow_reach: 0, close: 22411970 },
  { month_end: '2025-12-31', plat: 7279877, aod: 0, lh: 3468315, ow: 8843496, non_ow: 0, ow_reach: 0, close: 21204862 },
  { month_end: '2026-01-31', plat: 6872119, aod: 0, lh: 7074651, ow: 5172928, non_ow: 0, ow_reach: 0, close: 20661228 },
  { month_end: '2026-02-28', plat: 6927285, aod: 0, lh: 7635076, ow: 4073918, non_ow: 0, ow_reach: 0, close: 19115813 },
  { month_end: '2026-03-31', plat: 7321494, aod: 0, lh: 7016538, ow: 3779443, non_ow: 0, ow_reach: 0, close: 18644169 },
];

const PL_DATA = [
  { month: '2024-01', rev: 7166470, exp: 1413194, net: 4490072 },
  { month: '2024-02', rev: 524651, exp: -610893, net: 695544 },
  { month: '2024-03', rev: 401186, exp: 1948219, net: -1847339 },
  { month: '2024-04', rev: 6967176, exp: 2665295, net: 3040735 },
  { month: '2024-05', rev: 415511, exp: -596169, net: 658510 },
  { month: '2024-06', rev: 1222318, exp: 2580759, net: -1663899 },
  { month: '2024-07', rev: 467106, exp: 2133906, net: -2402815 },
  { month: '2024-08', rev: 558743, exp: 3534802, net: -3125061 },
  { month: '2024-09', rev: 622049, exp: -673665, net: 953093 },
  { month: '2024-10', rev: 188036, exp: 2368441, net: -2201956 },
  { month: '2024-11', rev: 781047, exp: -21261, net: 155328 },
  { month: '2024-12', rev: 479957, exp: 2212617, net: -1897439 },
];

export function seedHistoricalCash(db: Database.Database) {
  console.log('[seed] Inserting historical cash data...');

  const tx = db.transaction(() => {
    // Weekly cash snapshots
    const insertWeekly = db.prepare(`
      INSERT OR REPLACE INTO historical_cash_weekly
        (snapshot_date, grand_total, platform_total, aod_total, xlabs_total, lholding_total, overworld_total, reach_total, foundation_total, cs_total, palio_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const w of WEEKLY_DATA) {
      insertWeekly.run(w.date, w.total, w.plat, w.aod, w.xlabs, w.lh, w.ow, w.reach, w.foundation, w.cs, w.palio);
    }

    // Monthly BS closings
    const insertBS = db.prepare(`
      INSERT OR REPLACE INTO historical_bs_monthly
        (month_end, platform_cash, aod_cash, lholding_cash, overworld_cash, non_ow_closing, ow_reach_closing, total_closing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of MONTHLY_BS_DATA) {
      insertBS.run(b.month_end, b.plat, b.aod, b.lh, b.ow, b.non_ow, b.ow_reach, b.close);
    }

    // Fiat deposits
    db.prepare(`
      INSERT OR REPLACE INTO historical_fiat_deposits
        (snapshot_date, svb_mma, foundation_usd, foundation_eur, fiat_total)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-04-09', 5010217.79, 5535000, 234230.74, 10779448.53);

    // Crypto deposits
    db.prepare(`
      INSERT OR REPLACE INTO historical_crypto_deposits
        (snapshot_date, usdc_amount, usdt_amount, total_fixed)
      VALUES (?, ?, ?, ?)
    `).run('2026-04-09', 6563645.80, 312671.91, 7564607.34);

    // Monthly P&L
    const insertPL = db.prepare(`
      INSERT OR REPLACE INTO historical_pl_monthly
        (month_start, revenue, expenses, net_profit)
      VALUES (?, ?, ?, ?)
    `);
    for (const p of PL_DATA) {
      insertPL.run(p.month, p.rev, p.exp, p.net);
    }
  });

  tx();
  console.log('[seed] Historical cash data inserted');
}
