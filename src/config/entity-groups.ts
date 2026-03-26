// Entity groupings matching the consolidated balance sheet structure
// Each group has a display name and the Odoo company IDs it includes

export interface EntityGroup {
  name: string;
  company_ids: number[];
  is_subtotal?: boolean;  // computed from other groups
  subtotal_groups?: string[];  // names of groups to sum
}

export const ENTITY_GROUPS: EntityGroup[] = [
  { name: 'LTECH, LTECH W3', company_ids: [1, 23] },
  { name: 'XLABS, XLAB W3', company_ids: [17, 18] },
  { name: 'PRIVILEGE HK', company_ids: [21] },
  // Xterio Total = sum of LTECH + XLABS + PRIVILEGE
  { name: 'Xterio Total', company_ids: [], is_subtotal: true, subtotal_groups: ['LTECH, LTECH W3', 'XLABS, XLAB W3', 'PRIVILEGE HK'] },

  { name: 'AOD', company_ids: [5, 6, 7, 10] },  // GAMEPHILOS, GAMEPHILOS W3, MAOFAN, DIFANHA
  { name: 'CS', company_ids: [2, 3, 4, 12, 13, 14] },  // SHADOWCAY, SHADOWCAY W3, CHAOYING, COS GAMES, COS GAMES W3, DIREWOLF
  { name: 'Palios', company_ids: [11, 9] },  // PALIO W3, BJ TUDONG
  { name: 'LHOLDINGS', company_ids: [19, 20] },  // LHOLDINGS, LHOLDINGS W3
  { name: 'QUANTUMMIND', company_ids: [8] },

  // Non OW Total = Xterio Total + AOD + CS + Palios + LHOLDINGS + QUANTUMMIND
  { name: 'Non OW Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Xterio Total', 'AOD', 'CS', 'Palios', 'LHOLDINGS', 'QUANTUMMIND'] },

  { name: 'OW', company_ids: [15, 16] },  // OVERWORLD, OVERWORLD W3
  { name: 'Reach', company_ids: [30] },
  { name: 'Rough house', company_ids: [31] },
  { name: 'PLAY ALGORITHM', company_ids: [28] },

  // OW & Reach Total = OW + Reach + Rough house + PLAY ALGORITHM
  { name: 'OW & Reach Total', company_ids: [], is_subtotal: true, subtotal_groups: ['OW', 'Reach', 'Rough house', 'PLAY ALGORITHM'] },

  // Total = Non OW Total + OW & Reach Total
  { name: 'Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Non OW Total', 'OW & Reach Total'] },
];

// Balance sheet line items structure
export interface BSLineItem {
  code: string;       // account code or section key
  label: string;
  indent: number;     // 0 = section header, 1 = sub-section, 2 = detail line
  is_total?: boolean;
  is_section?: boolean;
  odoo_types?: string[];   // which odoo_type values to sum
  account_codes?: string[]; // specific account codes to include
  computed_from?: string[]; // sum of other line codes
}

export const BS_LINES: BSLineItem[] = [
  { code: 'ASSETS', label: 'ASSETS', indent: 0, is_section: true, computed_from: ['CURRENT_ASSETS', 'FIXED_ASSETS', 'NON_CURRENT_ASSETS'] },

  { code: 'CURRENT_ASSETS', label: 'Current Assets', indent: 1, is_total: true, computed_from: ['BANK_CASH', 'RECEIVABLES_TOTAL', 'PREPAYMENTS_TOTAL'] },

  { code: 'BANK_CASH', label: 'Bank and Cash Accounts', indent: 1, is_total: true, odoo_types: ['asset_cash'] },

  { code: 'RECEIVABLES_TOTAL', label: 'Receivables', indent: 1, is_total: true, computed_from: ['107010', '101000', '101010'] },
  { code: '107010', label: '107010 GST Control', indent: 2, account_codes: ['107010'] },
  { code: '101000', label: '101000 Accounts Receivable', indent: 2, account_codes: ['101000'] },
  { code: '101010', label: '101010 Other Receivable', indent: 2, account_codes: ['101010'] },

  { code: 'PREPAYMENTS_TOTAL', label: 'Prepayments', indent: 1, is_total: true, odoo_types: ['asset_prepayments'] },
  { code: '102000', label: '102000 Prepayment', indent: 2, account_codes: ['102000'] },

  { code: 'FIXED_ASSETS', label: 'Plus Fixed Assets', indent: 1, is_total: true, odoo_types: ['asset_fixed'] },

  { code: 'NON_CURRENT_ASSETS', label: 'Plus Non-current Assets', indent: 1, is_total: true, computed_from: ['107030', '200000', '202000'] },
  { code: '107030', label: '107030 Other Assets', indent: 2, account_codes: ['107030'] },
  { code: '200000', label: '200000 Investment', indent: 2, account_codes: ['200000'] },
  { code: '202000', label: '202000 Deposits', indent: 2, account_codes: ['202000'] },

  { code: 'LIABILITIES', label: 'LIABILITIES', indent: 0, is_section: true, computed_from: ['CURRENT_LIABILITIES_TOTAL', 'PAYABLES_TOTAL', 'NON_CURRENT_LIABILITIES'] },

  { code: 'CURRENT_LIABILITIES_TOTAL', label: 'Total Current Liabilities', indent: 1, is_total: true, computed_from: ['CURRENT_LIAB_RELATED', 'CURRENT_LIAB_NON_RELATED', 'CURRENT_LIAB_OTHER'] },

  { code: 'CURRENT_LIAB_RELATED', label: 'Current Liabilities- Related entities', indent: 1, odoo_types: ['liability_current'] },

  { code: 'CURRENT_LIAB_NON_RELATED', label: 'Current Liabilities- Non-Related', indent: 1, is_total: true, computed_from: ['303100', '303031'] },
  { code: '303100', label: '303100 Amount due to/from Fund', indent: 2, account_codes: ['303100'] },
  { code: '303031', label: '303031 Amount due to/from Xterio', indent: 2, account_codes: ['303031'] },

  { code: 'CURRENT_LIAB_OTHER', label: 'Current Liabilities- Other', indent: 1, is_total: true, computed_from: ['301000', '300000', '302010'] },
  { code: '301000', label: '301000 Accrued Expenses', indent: 2, account_codes: ['301000'] },
  { code: '300000', label: '300000 Accounts Payable', indent: 2, account_codes: ['300000'] },
  { code: '302010', label: '302010 Deferred Revenue', indent: 2, account_codes: ['302010'] },

  { code: 'PAYABLES_TOTAL', label: 'Payables', indent: 1, is_total: true, computed_from: ['300030'] },
  { code: '300030', label: '300030 Trade Payables', indent: 2, account_codes: ['300030'] },

  { code: 'NON_CURRENT_LIABILITIES', label: 'Plus Non-current Liabilities', indent: 1, is_total: true, computed_from: ['300040', '303030'] },
  { code: '300040', label: '300040 Other Payables (non-trade)', indent: 2, account_codes: ['300040'] },
  { code: '303030', label: '303030 Amount due to/from Xterio', indent: 2, account_codes: ['303030'] },

  { code: 'EQUITY', label: 'EQUITY', indent: 0, is_section: true, computed_from: ['ACCUMULATE_PL', 'CURRENT_YEAR_EARNINGS', 'SHARE_CAPITALS'] },
  { code: 'ACCUMULATE_PL', label: 'Accumulate P/L', indent: 1, odoo_types: ['equity'] },
  { code: 'CURRENT_YEAR_EARNINGS', label: 'Current Year Unallocated Earnings', indent: 1, odoo_types: ['equity_unaffected'] },
  { code: 'SHARE_CAPITALS', label: 'Share Capitals', indent: 1, account_codes: ['310000'] },

  { code: 'LIAB_EQUITY', label: 'LIABILITIES + EQUITY', indent: 0, is_section: true, computed_from: ['LIABILITIES', 'EQUITY'] },
];
