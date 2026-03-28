import { Router } from 'express';
import Database from 'better-sqlite3';
import https from 'https';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';

function queryDeepSeek(messages: any[], apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    });

    const url = new URL(DEEPSEEK_API);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices?.[0]?.message?.content || 'No response');
        } catch (e) {
          reject(new Error('Failed to parse DeepSeek response: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('DeepSeek API timeout')); });
    req.write(body);
    req.end();
  });
}

export function chatRoutes(db: Database.Database): Router {
  const router = Router();

  router.post('/ask', async (req, res) => {
    console.log('[chat] Received question:', req.body?.question?.slice(0, 50));
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not set' });

    const question = req.body.question;
    if (!question) return res.status(400).json({ error: 'No question provided' });

    try {
      console.log('[chat] Building context...');
      // Get latest snapshot
      const snap = db.prepare('SELECT DISTINCT snapshot_date FROM account_balances ORDER BY snapshot_date DESC LIMIT 1').get() as any;
      const snapDate = snap?.snapshot_date || 'unknown';
      console.log('[chat] Using snapshot:', snapDate);

      // Build financial context
      const companies = db.prepare(`
        SELECT DISTINCT company_name, company_id FROM account_balances WHERE snapshot_date = ? ORDER BY company_name
      `).all(snapDate) as any[];

      // Cash by entity group
      const cashSummary = db.prepare(`
        SELECT company_name, account_type, SUM(balance) as total
        FROM account_balances WHERE snapshot_date = ?
        AND account_type IN ('asset_cash', 'asset_receivable', 'asset_fixed', 'asset_non_current',
          'liability_current', 'liability_payable', 'liability_non_current', 'equity')
        GROUP BY company_name, account_type
      `).all(snapDate) as any[];

      // Top cash accounts
      const topCash = db.prepare(`
        SELECT company_name, account_code, account_name, balance
        FROM account_balances WHERE snapshot_date = ? AND account_type = 'asset_cash'
        AND ABS(balance) > 1000
        ORDER BY balance DESC LIMIT 30
      `).all(snapDate) as any[];

      // IC balances
      const icBalances = db.prepare(`
        SELECT company_name, account_code, account_name, balance
        FROM account_balances WHERE snapshot_date = ? AND account_code LIKE '303%'
        AND ABS(balance) > 10000
        ORDER BY ABS(balance) DESC LIMIT 20
      `).all(snapDate) as any[];

      // Build context string
      let context = `Financial data as of ${snapDate}.\n\n`;
      context += `Companies: ${companies.map((c: any) => c.company_name).join(', ')}\n\n`;

      context += `Entity Groups:\n`;
      context += `- Xterio: LTECH, LTECH W3, XLABS, XLABS W3, PRIVILEGE HK, Xterio Foundation (manual: $5,942,149 cash)\n`;
      context += `- AOD/Gamephilos: GAMEPHILOS, GAMEPHILOS W3, MAOFAN, DIFANHA\n`;
      context += `- CS/Shadowcay: SHADOWCAY, SHADOWCAY W3, CHAOYING, DIREWOLF, COS GAMES, COS GAMES W3\n`;
      context += `- Palios: PALIO W3, BJ TUDONG, QUANTUMMIND SOLUTIONS HK\n`;
      context += `- Holdings: LHOLDINGS, LHOLDINGS W3\n`;
      context += `- Overworld: OVERWORLD, OVERWORLD W3, REACH LABS, ROUGH HOUSE, PLAY ALGORITHM (BVI)\n\n`;

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

      const messages = [
        {
          role: 'system',
          content: `You are a CFO assistant for a group of companies. You have access to the following financial data from the Odoo accounting system. Answer questions concisely and accurately using the data provided. Use numbers from the data — don't make up figures. Format currency with $ and commas. If you don't have enough data to answer, say so.\n\n${context}`
        },
        { role: 'user', content: question }
      ];

      console.log('[chat] Calling DeepSeek API...');
      const answer = await queryDeepSeek(messages, apiKey);
      console.log('[chat] Got response, length:', answer.length);
      res.json({ answer, snapshot_date: snapDate });
    } catch (err: any) {
      console.error('[chat] Error:', err.message);
      res.status(500).json({ error: err.message || 'Unknown error' });
    }
  });

  return router;
}
