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
  { name: 'Xterio Foundation', company_ids: [22] },
  { name: 'Xterio Total', company_ids: [], is_subtotal: true, subtotal_groups: ['LTECH, LTECH W3', 'XLABS, XLAB W3', 'PRIVILEGE HK', 'Xterio Foundation'] },

  { name: 'AOD', company_ids: [5, 6, 7, 10] },
  { name: 'CS', company_ids: [2, 3, 4, 12, 13, 14] },
  { name: 'Palios', company_ids: [11, 9] },
  { name: 'LHOLDINGS', company_ids: [19, 20] },
  { name: 'QUANTUMMIND', company_ids: [8] },

  { name: 'Non OW Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Xterio Total', 'AOD', 'CS', 'Palios', 'LHOLDINGS', 'QUANTUMMIND'] },

  { name: 'Lholding Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Non OW Total'] },

  { name: 'OW', company_ids: [15, 16] },
  { name: 'Reach', company_ids: [30] },
  { name: 'Rough house', company_ids: [31] },
  { name: 'Keystone', company_ids: [28] },

  { name: 'OW & Reach Total', company_ids: [], is_subtotal: true, subtotal_groups: ['OW', 'Reach', 'Rough house', 'Keystone'] },

  { name: 'Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Non OW Total', 'OW & Reach Total'] },
];

export interface BSLineItem {
  code: string;
  label: string;
  indent: number;
  is_total?: boolean;
  is_section?: boolean;
  odoo_types?: string[];
  account_codes?: string[];
  computed_from?: string[];
  date_filter?: 'current_year' | 'prior_years';
}

export const BS_LINES: BSLineItem[] = [
  // ===== ASSETS =====
  { code: 'ASSETS', label: 'ASSETS', indent: 0, is_section: true, computed_from: ['CURRENT_ASSETS', 'FIXED_ASSETS', 'NON_CURRENT_ASSETS'] },

  { code: 'CURRENT_ASSETS', label: 'Current Assets', indent: 1, is_total: true, computed_from: ['BANK_CASH', 'DIGITAL_TOKEN', 'RECEIVABLES_TOTAL', 'PREPAYMENTS_TOTAL'] },

  { code: 'BANK_CASH', label: 'Bank and Cash Accounts', indent: 1, odoo_types: ['asset_cash'] },
  { code: 'DIGITAL_TOKEN', label: 'Digital Token', indent: 2, account_codes: ['107030'] },

  { code: 'RECEIVABLES_TOTAL', label: 'Receivables', indent: 1, is_total: true, computed_from: ['A_107010', 'A_101000', 'A_101010'] },
  { code: 'A_107010', label: '107010 GST Control', indent: 2, account_codes: ['107010'] },
  { code: 'A_101000', label: '101000 Accounts Receivable', indent: 2, account_codes: ['101000'] },
  { code: 'A_101010', label: '101010 Other Receivable', indent: 2, account_codes: ['101010'] },

  { code: 'PREPAYMENTS_TOTAL', label: 'Prepayments', indent: 1, is_total: true, computed_from: ['A_102000'] },
  { code: 'A_102000', label: '102000 Prepayment', indent: 2, account_codes: ['102000'] },

  { code: 'FIXED_ASSETS', label: 'Plus Fixed Assets', indent: 1, odoo_types: ['asset_fixed'] },

  { code: 'NON_CURRENT_ASSETS', label: 'Plus Non-current Assets', indent: 1, is_total: true, computed_from: ['A_107030_OTHER', 'A_200000', 'A_202000'] },
  { code: 'A_107030_OTHER', label: '107030 Other Assets', indent: 2, account_codes: ['107030'] },
  { code: 'A_200000', label: '200000 Investment', indent: 2, account_codes: ['200000'] },
  { code: 'A_202000', label: '202000 Deposits', indent: 2, account_codes: ['202000'] },

  // ===== LIABILITIES =====
  { code: 'LIABILITIES', label: 'LIABILITIES', indent: 0, is_section: true, computed_from: ['TOTAL_CURRENT_LIAB', 'PAYABLES_TOTAL', 'NON_CURRENT_LIAB'] },

  { code: 'TOTAL_CURRENT_LIAB', label: 'Total Current Liabilities', indent: 1, is_total: true, computed_from: ['CURRENT_LIAB_RELATED', 'CURRENT_LIAB_NON_RELATED', 'CURRENT_LIAB_OTHER'] },

  { code: 'CURRENT_LIAB_RELATED', label: 'Current Liabilities- Related entities', indent: 1, odoo_types: ['liability_current', 'liability_credit_card'] },

  { code: 'CURRENT_LIAB_NON_RELATED', label: 'Current Liabilities- Non-Related', indent: 1, is_total: true, computed_from: ['A_303100', 'A_303031'] },
  { code: 'A_303100', label: '303100 Amount due to/from FunPlus', indent: 2, account_codes: ['303100'] },
  { code: 'A_303031', label: '303031 Amount due to/from Xterio', indent: 2, account_codes: ['303031'] },

  { code: 'CURRENT_LIAB_OTHER', label: 'Current Liabilities- Other', indent: 1, is_total: true, computed_from: ['A_301000', 'A_300000', 'A_302010'] },
  { code: 'A_301000', label: '301000 Accrued Expenses', indent: 2, account_codes: ['301000'] },
  { code: 'A_300000', label: '300000 Accounts Payable', indent: 2, account_codes: ['300000'] },
  { code: 'A_302010', label: '302010 Deferred Revenue - Gas Fee', indent: 2, account_codes: ['302010'] },

  { code: 'PAYABLES_TOTAL', label: 'Payables', indent: 1, is_total: true, computed_from: ['A_300030'] },
  { code: 'A_300030', label: '300030 Trade Payables', indent: 2, account_codes: ['300030'] },

  { code: 'NON_CURRENT_LIAB', label: 'Plus Non-current Liabilities', indent: 1, is_total: true, computed_from: ['A_300040', 'A_303030'] },
  { code: 'A_300040', label: '300040 Other Payables (non-trade)', indent: 2, account_codes: ['300040'] },
  { code: 'A_303030', label: '303030 Amount due to/from Xterio Foundation', indent: 2, account_codes: ['303030'] },

  // ===== EQUITY =====
  { code: 'EQUITY', label: 'EQUITY', indent: 0, is_section: true, computed_from: ['ACCUMULATE_PL', 'CURRENT_YEAR_PL', 'SHARE_CAPITALS'] },

  { code: 'ACCUMULATE_PL', label: 'Accumulate P/L', indent: 1, odoo_types: ['equity'], date_filter: 'prior_years' },
  { code: 'CURRENT_YEAR_PL', label: 'Current Year Unallocated Earnings', indent: 1, odoo_types: ['income', 'income_other', 'expense', 'expense_direct_cost', 'equity_unaffected'], date_filter: 'current_year' },
  { code: 'SHARE_CAPITALS', label: 'Share Capitals', indent: 1, account_codes: ['310000'] },

  // ===== TOTALS =====
  { code: 'LIAB_EQUITY', label: 'LIABILITIES + EQUITY', indent: 0, is_section: true, computed_from: ['LIABILITIES', 'EQUITY'] },
];
