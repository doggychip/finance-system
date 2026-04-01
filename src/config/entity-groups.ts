export interface EntityGroup {
  name: string;
  company_ids: number[];
  is_subtotal?: boolean;
  is_manual?: boolean;
  subtotal_groups?: string[];
}

export const ENTITY_GROUPS: EntityGroup[] = [
  { name: 'LTECH, LTECH W3', company_ids: [1, 23] },
  { name: 'XLABS, XLAB W3', company_ids: [17, 18] },
  { name: 'PRIVILEGE HK', company_ids: [21] },
  { name: 'Xterio Foundation', company_ids: [22], is_manual: true },
  { name: 'Xterio Total', company_ids: [], is_subtotal: true, subtotal_groups: ['LTECH, LTECH W3', 'XLABS, XLAB W3', 'PRIVILEGE HK', 'Xterio Foundation'] },

  { name: 'AOD', company_ids: [5, 6, 7, 10] },
  { name: 'CS', company_ids: [2, 3, 4, 12, 13, 14] },
  { name: 'Palios', company_ids: [11, 9] },
  { name: 'LHOLDINGS', company_ids: [19, 20] },
  { name: 'QUANTUMMIND', company_ids: [8] },

  { name: 'Lholding Total', company_ids: [], is_subtotal: true, subtotal_groups: ['AOD', 'CS', 'Palios', 'LHOLDINGS', 'QUANTUMMIND'] },

  { name: 'Non OW Total', company_ids: [], is_subtotal: true, subtotal_groups: ['Xterio Total', 'Lholding Total'] },

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
  account_codes_prefix?: string;
  computed_from?: string[];
  date_filter?: 'current_year' | 'prior_years';
}

// Balance sheet lines — use odoo_types for totals, no double-counting
// Sub-lines with account_codes are DISPLAY ONLY (not used in computed_from totals)
export const BS_LINES: BSLineItem[] = [
  // ===== ASSETS =====
  { code: 'ASSETS', label: 'ASSETS', indent: 0, is_section: true, odoo_types: ['asset_cash', 'asset_receivable', 'asset_current', 'asset_prepayments', 'asset_fixed', 'asset_non_current'] },

  { code: 'CURRENT_ASSETS', label: 'Current Assets', indent: 1, is_total: true, odoo_types: ['asset_cash', 'asset_receivable', 'asset_current', 'asset_prepayments'] },

  { code: 'BANK_CASH', label: 'Bank and Cash Accounts', indent: 1, odoo_types: ['asset_cash'] },
  { code: 'CASH', label: 'Cash', indent: 2, account_codes_prefix: '100' },
  { code: 'DIGITAL_TOKEN', label: 'Digital Token', indent: 2, account_codes_prefix: '10W' },

  { code: 'RECEIVABLES', label: 'Receivables', indent: 1, odoo_types: ['asset_receivable'] },
  { code: 'A_107010', label: '107010 GST Control', indent: 2, account_codes: ['107010'] },
  { code: 'A_101000', label: '101000 Accounts Receivable', indent: 2, account_codes: ['101000'] },
  { code: 'A_101010', label: '101010 Other Receivable', indent: 2, account_codes: ['101010'] },

  { code: 'CURRENT_ASSETS_OTHER', label: 'Current Assets', indent: 1, odoo_types: ['asset_current'] },
  { code: 'PREPAYMENTS', label: 'Prepayments', indent: 1, odoo_types: ['asset_prepayments'] },

  { code: 'FIXED_ASSETS', label: 'Plus Fixed Assets', indent: 1, odoo_types: ['asset_fixed'] },

  { code: 'NON_CURRENT_ASSETS', label: 'Plus Non-current Assets', indent: 1, odoo_types: ['asset_non_current'] },
  { code: 'A_200000', label: '200000 Investment', indent: 2, account_codes: ['200000'] },
  { code: 'A_202000', label: '202000 Deposits', indent: 2, account_codes: ['202000'] },

  // ===== LIABILITIES =====
  { code: 'LIABILITIES', label: 'LIABILITIES', indent: 0, is_section: true, odoo_types: ['liability_current', 'liability_credit_card', 'liability_payable', 'liability_non_current'] },

  { code: 'CURRENT_LIABILITIES', label: 'Current Liabilities', indent: 1, odoo_types: ['liability_current', 'liability_credit_card'] },
  { code: 'A_303010', label: '303010 Amount due to/from Holding', indent: 2, account_codes: ['303010'] },
  { code: 'A_303011', label: '303011 Amount due to/from Holding W3', indent: 2, account_codes: ['303011'] },
  { code: 'A_303020', label: '303020 Amount due to/from Libecciotech', indent: 2, account_codes: ['303020'] },
  { code: 'A_303021', label: '303021 Amount due to/from Libecciotech W3', indent: 2, account_codes: ['303021'] },
  { code: 'A_303031', label: '303031 Amount due to/from Xterio Fdn W3', indent: 2, account_codes: ['303031'] },
  { code: 'A_303040', label: '303040 Amount due to/from Xterlabs', indent: 2, account_codes: ['303040'] },
  { code: 'A_303041', label: '303041 Amount due to/from Xterlabs W3', indent: 2, account_codes: ['303041'] },
  { code: 'A_303050', label: '303050 Amount due to/from Overworld', indent: 2, account_codes: ['303050'] },
  { code: 'A_303051', label: '303051 Amount due to/from Overworld W3', indent: 2, account_codes: ['303051'] },
  { code: 'A_303060', label: '303060 Amount due to/from Quantummind', indent: 2, account_codes: ['303060'] },
  { code: 'A_303061', label: '303061 Amount due to/from PALIO W3', indent: 2, account_codes: ['303061'] },
  { code: 'A_303070', label: '303070 Amount due to/from Shadowcay', indent: 2, account_codes: ['303070'] },
  { code: 'A_303071', label: '303071 Amount due to/from Shadowcay W3', indent: 2, account_codes: ['303071'] },
  { code: 'A_303080', label: '303080 Amount due to/from Gamephilos', indent: 2, account_codes: ['303080'] },
  { code: 'A_303081', label: '303081 Amount due to/from Gamephilos W3', indent: 2, account_codes: ['303081'] },
  { code: 'A_303090', label: '303090 Amount due to/from COS Games', indent: 2, account_codes: ['303090'] },
  { code: 'A_303091', label: '303091 Amount due to/from COS Games W3', indent: 2, account_codes: ['303091'] },
  { code: 'A_303100', label: '303100 Amount due to/from FunPlus', indent: 2, account_codes: ['303100'] },
  { code: 'A_303110', label: '303110 Amount due to/from Privilege HK', indent: 2, account_codes: ['303110'] },
  { code: 'A_303120', label: '303120 Amount due to/from collected on behalf of Other Entities', indent: 2, account_codes: ['303120'] },
  { code: 'A_303150', label: '303150 Amount due to/from Libecciotech Station', indent: 2, account_codes: ['303150'] },
  { code: 'A_303160', label: '303160 Amount due to/from Play Algorithm (BVI)', indent: 2, account_codes: ['303160'] },
  { code: 'A_303170', label: '303170 Amount due to/from Rough House Games', indent: 2, account_codes: ['303170'] },
  { code: 'A_303171', label: '303171 Amount due to/from Rough House Games W3', indent: 2, account_codes: ['303171'] },
  { code: 'A_303180', label: '303180 Amount due to/from REACH LABS', indent: 2, account_codes: ['303180'] },
  { code: 'A_303181', label: '303181 Amount due to/from REACH LABS W3', indent: 2, account_codes: ['303181'] },
  { code: 'A_301000', label: '301000 Accrued Expenses', indent: 2, account_codes: ['301000'] },
  { code: 'A_302010', label: '302010 Deferred Revenue', indent: 2, account_codes: ['302010'] },

  { code: 'PAYABLES', label: 'Payables', indent: 1, odoo_types: ['liability_payable'] },
  { code: 'A_300000', label: '300000 Accounts Payable', indent: 2, account_codes: ['300000'] },
  { code: 'A_300030', label: '300030 Trade Payables', indent: 2, account_codes: ['300030'] },

  { code: 'NON_CURRENT_LIABILITIES', label: 'Plus Non-current Liabilities', indent: 1, odoo_types: ['liability_non_current'] },
  { code: 'A_300040', label: '300040 Other Payables (non-trade)', indent: 2, account_codes: ['300040'] },
  { code: 'A_300050', label: '300050 Other Payables - Fiat/Crypto', indent: 2, account_codes: ['300050'] },
  { code: 'A_303030', label: '303030 Amount due to/from Xterio Fdn', indent: 2, account_codes: ['303030'] },

  // ===== EQUITY =====
  { code: 'EQUITY', label: 'EQUITY', indent: 0, is_section: true, odoo_types: ['equity', 'equity_unaffected', 'income', 'income_other', 'expense', 'expense_direct_cost', 'expense_depreciation'] },

  { code: 'EQUITY_RETAINED', label: 'Retained Earnings', indent: 1, odoo_types: ['equity'] },
  { code: 'A_RETAINED_EARNINGS', label: 'Retained Earnings', indent: 2, account_codes: ['500000'] },
  { code: 'A_SHARE_CAPITALS', label: 'Share Capitals', indent: 2, account_codes: ['310000'] },
  { code: 'A_CAPITAL_IN_WALLET', label: 'Capital in Wallet', indent: 2, account_codes: ['201000'] },
  { code: 'CURRENT_YEAR_PL', label: 'Current Year Unallocated Earnings', indent: 1, odoo_types: ['equity_unaffected', 'income', 'income_other', 'expense', 'expense_direct_cost', 'expense_depreciation'] },

  // ===== TOTALS =====
  { code: 'LIAB_EQUITY', label: 'LIABILITIES + EQUITY', indent: 0, is_section: true, computed_from: ['LIABILITIES', 'EQUITY'] },
];
