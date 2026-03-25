import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../db';
import { AccountService } from '../services/account-service';
import { JournalService } from '../services/journal-service';
import { LedgerService } from '../services/ledger-service';
import Database from 'better-sqlite3';

let db: Database.Database;
let accounts: AccountService;
let journal: JournalService;
let ledger: LedgerService;

beforeEach(() => {
  db = initDb(':memory:');
  accounts = new AccountService(db);
  journal = new JournalService(db);
  ledger = new LedgerService(db);
});

describe('AccountService', () => {
  it('should create an account', () => {
    const account = accounts.create({ name: 'Cash', type: 'asset', code: '1000' });
    expect(account.name).toBe('Cash');
    expect(account.type).toBe('asset');
    expect(account.code).toBe('1000');
  });

  it('should reject duplicate account codes', () => {
    accounts.create({ name: 'Cash', type: 'asset', code: '1000' });
    expect(() => accounts.create({ name: 'Other', type: 'asset', code: '1000' })).toThrow('already exists');
  });

  it('should create child accounts with same type', () => {
    const parent = accounts.create({ name: 'Assets', type: 'asset', code: '1000' });
    const child = accounts.create({ name: 'Cash', type: 'asset', code: '1001', parent_id: parent.id });
    expect(child.parent_id).toBe(parent.id);
  });

  it('should reject child accounts with different type', () => {
    const parent = accounts.create({ name: 'Assets', type: 'asset', code: '1000' });
    expect(() => accounts.create({ name: 'Revenue', type: 'revenue', code: '4000', parent_id: parent.id }))
      .toThrow('same type');
  });

  it('should update an account', () => {
    const account = accounts.create({ name: 'Cash', type: 'asset', code: '1000' });
    const updated = accounts.update(account.id, { name: 'Petty Cash' });
    expect(updated.name).toBe('Petty Cash');
  });

  it('should delete an account without transactions', () => {
    const account = accounts.create({ name: 'Temp', type: 'asset', code: '9999' });
    accounts.delete(account.id);
    expect(accounts.getById(account.id)).toBeUndefined();
  });
});

describe('JournalService', () => {
  let cashId: string;
  let revenueId: string;

  beforeEach(() => {
    cashId = accounts.create({ name: 'Cash', type: 'asset', code: '1000' }).id;
    revenueId = accounts.create({ name: 'Revenue', type: 'revenue', code: '4000' }).id;
  });

  it('should create a balanced journal entry', () => {
    const entry = journal.create({
      date: '2025-01-15',
      description: 'Sale',
      line_items: [
        { account_id: cashId, debit: 100, credit: 0 },
        { account_id: revenueId, debit: 0, credit: 100 },
      ],
    });
    expect(entry.status).toBe('draft');
    expect(entry.line_items).toHaveLength(2);
  });

  it('should reject unbalanced entries', () => {
    expect(() => journal.create({
      date: '2025-01-15',
      description: 'Bad',
      line_items: [
        { account_id: cashId, debit: 100, credit: 0 },
        { account_id: revenueId, debit: 0, credit: 50 },
      ],
    })).toThrow('must equal');
  });

  it('should post a draft entry', () => {
    const entry = journal.create({
      date: '2025-01-15',
      description: 'Sale',
      line_items: [
        { account_id: cashId, debit: 100, credit: 0 },
        { account_id: revenueId, debit: 0, credit: 100 },
      ],
    });
    const posted = journal.post(entry.id);
    expect(posted.status).toBe('posted');
    expect(posted.posted_at).not.toBeNull();
  });

  it('should void a posted entry with reversal', () => {
    const entry = journal.create({
      date: '2025-01-15',
      description: 'Sale',
      line_items: [
        { account_id: cashId, debit: 100, credit: 0 },
        { account_id: revenueId, debit: 0, credit: 100 },
      ],
    });
    journal.post(entry.id);
    const voided = journal.void(entry.id, 'Error');
    expect(voided.status).toBe('void');
  });
});

describe('LedgerService', () => {
  let cashId: string;
  let revenueId: string;
  let expenseId: string;
  let liabilityId: string;

  beforeEach(() => {
    cashId = accounts.create({ name: 'Cash', type: 'asset', code: '1000' }).id;
    revenueId = accounts.create({ name: 'Sales Revenue', type: 'revenue', code: '4000' }).id;
    expenseId = accounts.create({ name: 'Rent Expense', type: 'expense', code: '5000' }).id;
    liabilityId = accounts.create({ name: 'Accounts Payable', type: 'liability', code: '2000' }).id;

    // Post a sale: debit cash, credit revenue
    const sale = journal.create({
      date: '2025-01-15',
      description: 'Sale',
      line_items: [
        { account_id: cashId, debit: 1000, credit: 0 },
        { account_id: revenueId, debit: 0, credit: 1000 },
      ],
    });
    journal.post(sale.id);

    // Post an expense: debit expense, credit cash
    const rent = journal.create({
      date: '2025-01-20',
      description: 'Rent',
      line_items: [
        { account_id: expenseId, debit: 300, credit: 0 },
        { account_id: cashId, debit: 0, credit: 300 },
      ],
    });
    journal.post(rent.id);
  });

  it('should produce a trial balance', () => {
    const tb = ledger.getTrialBalance();
    const cash = tb.find(r => r.account_code === '1000');
    expect(cash?.balance).toBe(700); // 1000 - 300
  });

  it('should produce a balance sheet', () => {
    const bs = ledger.getBalanceSheet();
    expect(bs.assets.total).toBe(700);
  });

  it('should produce an income statement', () => {
    const is_ = ledger.getIncomeStatement();
    expect(is_.revenue.total).toBe(1000);
    expect(is_.expenses.total).toBe(300);
    expect(is_.net_income).toBe(700);
  });

  it('should produce an account ledger', () => {
    const entries = ledger.getAccountLedger(cashId);
    expect(entries).toHaveLength(2);
  });
});
