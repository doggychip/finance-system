import Database from 'better-sqlite3';

export interface TrialBalanceRow {
  account_id: string;
  account_name: string;
  account_code: string;
  account_type: string;
  total_debits: number;
  total_credits: number;
  balance: number;
}

export interface BalanceSheetSection {
  accounts: TrialBalanceRow[];
  total: number;
}

export interface BalanceSheet {
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  is_balanced: boolean;
}

export interface IncomeStatement {
  revenue: BalanceSheetSection;
  expenses: BalanceSheetSection;
  net_income: number;
}

export class LedgerService {
  constructor(private db: Database.Database) {}

  getTrialBalance(asOfDate?: string): TrialBalanceRow[] {
    let query = `
      SELECT
        a.id as account_id,
        a.name as account_name,
        a.code as account_code,
        a.type as account_type,
        COALESCE(SUM(li.debit), 0) as total_debits,
        COALESCE(SUM(li.credit), 0) as total_credits,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM accounts a
      LEFT JOIN line_items li ON li.account_id = a.id
        AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted'`;

    const params: string[] = [];
    if (asOfDate) {
      query += ` AND date <= ?`;
      params.push(asOfDate);
    }

    query += `)
      WHERE a.is_active = 1
      GROUP BY a.id
      ORDER BY a.code`;

    return this.db.prepare(query).all(...params) as TrialBalanceRow[];
  }

  getBalanceSheet(asOfDate?: string): BalanceSheet {
    const rows = this.getTrialBalance(asOfDate);

    const assets = rows.filter(r => r.account_type === 'asset');
    const liabilities = rows.filter(r => r.account_type === 'liability');
    const equity = rows.filter(r => r.account_type === 'equity');

    const assetTotal = assets.reduce((sum, r) => sum + r.balance, 0);
    const liabilityTotal = liabilities.reduce((sum, r) => sum + Math.abs(r.balance), 0);
    const equityTotal = equity.reduce((sum, r) => sum + Math.abs(r.balance), 0);

    return {
      assets: { accounts: assets, total: assetTotal },
      liabilities: { accounts: liabilities, total: liabilityTotal },
      equity: { accounts: equity, total: equityTotal },
      is_balanced: Math.abs(assetTotal - (liabilityTotal + equityTotal)) < 0.01,
    };
  }

  getIncomeStatement(startDate?: string, endDate?: string): IncomeStatement {
    let query = `
      SELECT
        a.id as account_id,
        a.name as account_name,
        a.code as account_code,
        a.type as account_type,
        COALESCE(SUM(li.debit), 0) as total_debits,
        COALESCE(SUM(li.credit), 0) as total_credits,
        COALESCE(SUM(li.debit), 0) - COALESCE(SUM(li.credit), 0) as balance
      FROM accounts a
      LEFT JOIN line_items li ON li.account_id = a.id
        AND li.journal_entry_id IN (SELECT id FROM journal_entries WHERE status = 'posted'`;

    const params: string[] = [];
    if (startDate) {
      query += ` AND date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND date <= ?`;
      params.push(endDate);
    }

    query += `)
      WHERE a.type IN ('revenue', 'expense') AND a.is_active = 1
      GROUP BY a.id
      ORDER BY a.code`;

    const rows = this.db.prepare(query).all(...params) as TrialBalanceRow[];

    const revenue = rows.filter(r => r.account_type === 'revenue');
    const expenses = rows.filter(r => r.account_type === 'expense');

    const revenueTotal = revenue.reduce((sum, r) => sum + Math.abs(r.balance), 0);
    const expenseTotal = expenses.reduce((sum, r) => sum + r.balance, 0);

    return {
      revenue: { accounts: revenue, total: revenueTotal },
      expenses: { accounts: expenses, total: expenseTotal },
      net_income: revenueTotal - expenseTotal,
    };
  }

  getAccountLedger(accountId: string, startDate?: string, endDate?: string) {
    let query = `
      SELECT
        je.id as entry_id,
        je.date,
        je.description as entry_description,
        je.reference,
        li.debit,
        li.credit,
        li.description as line_description
      FROM line_items li
      INNER JOIN journal_entries je ON je.id = li.journal_entry_id AND je.status = 'posted'
      WHERE li.account_id = ?`;

    const params: (string)[] = [accountId];
    if (startDate) {
      query += ` AND je.date >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND je.date <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY je.date, je.created_at`;

    return this.db.prepare(query).all(...params);
  }
}
