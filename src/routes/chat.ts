import { Router } from 'express';
import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }
  return client;
}

export function chatRoutes(db: Database.Database): Router {
  const router = Router();

  router.post('/ask', async (req, res) => {
    console.log('[chat] Received question:', req.body?.question?.slice(0, 50));
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const question = req.body.question;
    if (!question) return res.status(400).json({ error: 'No question provided' });

    try {
      console.log('[chat] Building context...');
      const snap = db.prepare('SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date DESC LIMIT 1').get() as any;
      const snapDate = snap?.snapshot_date || 'unknown';
      console.log('[chat] Using snapshot:', snapDate);

      const companies = db.prepare(`
        SELECT DISTINCT company_name, company_id FROM account_balances WHERE snapshot_date = ? ORDER BY company_name
      `).all(snapDate) as any[];

      const cashSummary = db.prepare(`
        SELECT company_name, account_type, SUM(balance) as total
        FROM account_balances WHERE snapshot_date = ?
        AND account_type IN ('asset_cash', 'asset_receivable', 'asset_fixed', 'asset_non_current',
          'liability_current', 'liability_payable', 'liability_non_current', 'equity')
        GROUP BY company_name, account_type
      `).all(snapDate) as any[];

      const topCash = db.prepare(`
        SELECT company_name, account_code, account_name, balance
        FROM account_balances WHERE snapshot_date = ? AND account_type = 'asset_cash'
        AND ABS(balance) > 1000
        ORDER BY balance DESC LIMIT 30
      `).all(snapDate) as any[];

      const icBalances = db.prepare(`
        SELECT company_name, account_code, account_name, balance
        FROM account_balances WHERE snapshot_date = ? AND account_code LIKE '303%'
        AND ABS(balance) > 10000
        ORDER BY ABS(balance) DESC LIMIT 20
      `).all(snapDate) as any[];

      let context = `Financial data as of ${snapDate}.\n\n`;

      context += `=== DATA DEFINITIONS ===\n`;
      context += `Cash: Always means Fiat + Crypto combined.\n`;
      context += `- Fiat: Bank accounts with code prefix 100xxx\n`;
      context += `- Crypto: Digital token accounts with code prefix 10Wxxx\n`;
      context += `Net Assets: Total Assets + Total Liabilities (excluding Equity & P&L accounts).\n\n`;

      context += `=== ENTITY GROUPS ===\n`;
      context += `1. Foundation (Xterio Foundation): Company ID 22, manual entry, assets = $5,942,149, liabilities = $1,369,636, net assets = $4,572,513\n`;
      context += `2. Xterio: LTECH(1,23) + AOD/Gamephilos(5,6,7,10) + XLABS(17,18) + PRIVILEGE HK(21) + Foundation(22)\n`;
      context += `3. Holdings: CS/Shadowcay(2,3,4,12,13,14) + Palios(11,9) + LHOLDINGS(19,20) + QUANTUMMIND(8)\n`;
      context += `4. Overworld (OW): OW(15,16) + Reach(30) + Rough house(31) + Keystone(28)\n`;
      context += `   - OW Monthly Burn: $250,000\n\n`;

      context += `Companies: ${companies.map((c: any) => `${c.company_name}(${c.company_id})`).join(', ')}\n\n`;

      context += `Cash Balances by Company:\n`;
      const cashByCompany: Record<string, number> = {};
      for (const r of topCash) {
        cashByCompany[r.company_name] = (cashByCompany[r.company_name] || 0) + r.balance;
      }
      for (const [name, bal] of Object.entries(cashByCompany).sort((a, b) => b[1] - a[1])) {
        context += `  ${name}: $${Math.round(bal).toLocaleString()}\n`;
      }

      context += `\nTop Cash Accounts:\n`;
      for (const r of topCash.slice(0, 15)) {
        context += `  ${r.company_name} | ${r.account_code} ${r.account_name}: $${Math.round(r.balance).toLocaleString()}\n`;
      }

      context += `\nBalance Summary by Company:\n`;
      const bySummary: Record<string, Record<string, number>> = {};
      for (const r of cashSummary) {
        if (!bySummary[r.company_name]) bySummary[r.company_name] = {};
        bySummary[r.company_name][r.account_type] = r.total;
      }
      for (const [name, types] of Object.entries(bySummary)) {
        const assets = (types['asset_cash'] || 0) + (types['asset_receivable'] || 0) + (types['asset_fixed'] || 0) + (types['asset_non_current'] || 0);
        const liab = (types['liability_current'] || 0) + (types['liability_payable'] || 0) + (types['liability_non_current'] || 0);
        if (Math.abs(assets) > 1000 || Math.abs(liab) > 1000) {
          context += `  ${name}: Assets=$${Math.round(assets).toLocaleString()}, Liabilities=$${Math.round(liab).toLocaleString()}\n`;
        }
      }

      if (icBalances.length > 0) {
        context += `\nIntercompany Balances (>$10K):\n`;
        for (const r of icBalances) {
          context += `  ${r.company_name} | ${r.account_code} ${r.account_name}: $${Math.round(r.balance).toLocaleString()}\n`;
        }
      }

      const allSnaps = db.prepare(`SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date`).all() as any[];
      context += `\nHistorical Cash Balances by Snapshot Date:\n`;
      for (const s of allSnaps) {
        const cashTotal = db.prepare(`
          SELECT SUM(balance) as total FROM account_balances
          WHERE snapshot_date = ? AND account_type = 'asset_cash'
        `).get(s.snapshot_date) as any;
        const bankOnly = db.prepare(`
          SELECT SUM(balance) as total FROM account_balances
          WHERE snapshot_date = ? AND account_type = 'asset_cash' AND account_code LIKE '100%'
        `).get(s.snapshot_date) as any;
        context += `  ${s.snapshot_date}: Total Cash=$${Math.round(cashTotal?.total || 0).toLocaleString()}, Bank Cash (100xxx)=$${Math.round(bankOnly?.total || 0).toLocaleString()}\n`;
      }

      const systemPrompt = `You are a CFO assistant for a group of companies. You have access to the following financial data from the Odoo accounting system. Answer questions concisely and accurately using the data provided. Use numbers from the data — don't make up figures. Format currency with $ and commas. If you don't have enough data to answer, say so.\n\n${context}`;

      console.log('[chat] Calling Claude API...');
      const response = await getClient().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      });

      const answer = response.content[0].type === 'text' ? response.content[0].text : 'No response';
      console.log('[chat] Got response, length:', answer.length);
      res.json({ answer, snapshot_date: snapDate });
    } catch (err: any) {
      console.error('[chat] Error:', err.message);
      res.status(500).json({ error: err.message || 'Unknown error' });
    }
  });

  return router;
}
