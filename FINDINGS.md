# Findings During UX/UI Improvement Work

## Phase 1 Findings

### Fixed
- **1.1** `/consolidated.html` 404 → Added server redirect to `/consolidated-bs.html`
- **1.1** No 404 page → Created branded `404.html` with dark theme
- **1.2** Cash Distribution donut legend showed "Cash, Cash, Cash..." → Now shows entity name (company_name + account_name)
- **1.3** Per-Account Balance chart labels now include company_name for disambiguation
- **1.5** Created shared `format.js` with `formatCurrency()` utility (parentheses notation for negatives)

### Noted for review
- **1.4** Cash Balance Monthly chart negative values: This appears to be correct data — the chart shows net cash flow which includes outflows. The data source (cash-history API) computes `balance` as cumulative debit-credit which can be negative for companies with more expenses than income. Not a bug, but could benefit from a tooltip explaining "Net cumulative cash flow includes both inflows and outflows."
- The `fmt()` function is duplicated across 10+ HTML files. Each page has its own copy. Future work: replace all with shared `format.js`.
- Several pages still reference `var(--text-dim)` at `#8b8fa3` which is below WCAG AA contrast. The Overview page was updated to `#b0b8c4` but other pages weren't.
