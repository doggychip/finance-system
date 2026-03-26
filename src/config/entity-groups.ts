// Entity groupings matching the consolidated balance sheet structure

export interface EntityGroup {
  name: string;
  company_ids: number[];
  is_subtotal?: boolean;
  subtotal_groups?: string[];
}

export const ENTITY_GROUPS: EntityGroup[] = [
  { name: 'LTECH, LTECH W3', company_ids: [1, 23] },
  { name: 'XLABS, XLAB W3', company_ids: [17, 18] },
  { name: 'PRIVILEGE HK', company_ids: [21] },
  { name: 'Xterio Total', company_ids: [], is_subtotal: true, subtotal_groups: ['LTECH, LTECH W3', 'XLABS, XLAB W3', 'PRIVILEGE HK'] },

  { name: 'AOD', company_ids: [5, 6, 7, 10] },
  { name: 'CS', company_ids: [2, 3, 4, 12, 13, 14] },
  { name: 'Palios', company_ids: [11, 9] },
  { name: 'LHOLDINGS', company_ids: [19, 20] },
  { name: 'QUANTUMMIND', company_ids: [8] },
  { name: 'LSTATION', company_ids: [22] },

  { name: 'Non OW Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Xterio Total', 'AOD', 'CS', 'Palios', 'LHOLDINGS', 'QUANTUMMIND', 'LSTATION'] },

  { name: 'OW', company_ids: [15, 16] },
  { name: 'Reach', company_ids: [30] },
  { name: 'Rough house', company_ids: [31] },
  { name: 'PLAY ALGORITHM', company_ids: [28] },

  { name: 'OW & Reach Total', company_ids: [], is_subtotal: true, subtotal_groups: ['OW', 'Reach', 'Rough house', 'PLAY ALGORITHM'] },

  { name: 'Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Non OW Total', 'OW & Reach Total'] },
];

// Balance sheet line items
// Use odoo_types to capture ALL accounts of that type (no gaps)
export interface BSLineItem {
  code: string;
  label: string;
  indent: number;
  is_total?: boolean;
  is_section?: boolean;
  odoo_types?: string[];
  account_codes?: string[];
  computed_from?: string[];
}

export const BS_LINES: BSLineItem[] = [
  // ===== ASSETS =====
  { code: 'ASSETS', label: 'ASSETS', indent: 0, is_section: true, computed_from: ['CURRENT_ASSETS', 'FIXED_ASSETS', 'NON_CURRENT_ASSETS'] },

  { code: 'CURRENT_ASSETS', label: 'Current Assets', indent: 1, is_total: true, computed_from: ['BANK_CASH', 'RECEIVABLES', 'CURRENT_ASSETS_OTHER', 'PREPAYMENTS'] },

  { code: 'BANK_CASH', label: 'Bank and Cash Accounts', indent: 1, odoo_types: ['asset_cash'] },
  { code: 'RECEIVABLES', label: 'Receivables', indent: 1, odoo_types: ['asset_receivable'] },
  { code: 'CURRENT_ASSETS_OTHER', label: 'Current Assets', indent: 1, odoo_types: ['asset_current'] },
  { code: 'PREPAYMENTS', label: 'Prepayments', indent: 1, odoo_types: ['asset_prepayments'] },

  { code: 'FIXED_ASSETS', label: 'Plus Fixed Assets', indent: 1, odoo_types: ['asset_fixed'] },
  { code: 'NON_CURRENT_ASSETS', label: 'Plus Non-current Assets', indent: 1, odoo_types: ['asset_non_current'] },

  // ===== LIABILITIES =====
  { code: 'LIABILITIES', label: 'LIABILITIES', indent: 0, is_section: true, computed_from: ['CURRENT_LIABILITIES', 'PAYABLES', 'NON_CURRENT_LIABILITIES'] },

  { code: 'CURRENT_LIABILITIES', label: 'Current Liabilities', indent: 1, odoo_types: ['liability_current', 'liability_credit_card'] },
  { code: 'PAYABLES', label: 'Payables', indent: 1, odoo_types: ['liability_payable'] },
  { code: 'NON_CURRENT_LIABILITIES', label: 'Plus Non-current Liabilities', indent: 1, odoo_types: ['liability_non_current'] },

  // ===== EQUITY =====
  { code: 'EQUITY', label: 'EQUITY', indent: 0, is_section: true, computed_from: ['EQUITY_RETAINED', 'EQUITY_UNAFFECTED'] },

  { code: 'EQUITY_RETAINED', label: 'Retained Earnings', indent: 1, odoo_types: ['equity'] },
  { code: 'EQUITY_UNAFFECTED', label: 'Current Year Unallocated Earnings', indent: 1, odoo_types: ['equity_unaffected'] },

  // ===== P&L (flows into equity) =====
  { code: 'PL', label: 'P&L (Income - Expense)', indent: 0, is_section: true, computed_from: ['INCOME', 'INCOME_OTHER', 'EXPENSE', 'EXPENSE_DIRECT'] },

  { code: 'INCOME', label: 'Income', indent: 1, odoo_types: ['income'] },
  { code: 'INCOME_OTHER', label: 'Other Income', indent: 1, odoo_types: ['income_other'] },
  { code: 'EXPENSE', label: 'Expenses', indent: 1, odoo_types: ['expense'] },
  { code: 'EXPENSE_DIRECT', label: 'Direct Costs', indent: 1, odoo_types: ['expense_direct_cost'] },

  // ===== TOTALS =====
  { code: 'LIAB_EQUITY_PL', label: 'LIABILITIES + EQUITY + P&L', indent: 0, is_section: true, computed_from: ['LIABILITIES', 'EQUITY', 'PL'] },
];
