# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0.0] - 2026-04-10

### Added
- Multi-entity finance dashboard consolidating 27 companies from Odoo 18
- Consolidated balance sheet with entity groupings and intercompany eliminations
- Cash position tracking with bank-only and digital token breakdown
- Cash flow statement matching spreadsheet layout
- Intercompany reconciliation report
- Odoo XML-RPC sync: accounts, journal entries, invoices, payments, balances
- Xterio Foundation manual data integration (CHF to USD conversion)
- CEO executive dashboard with cash overview and P&L summary
- Per-company and consolidated balance sheets with as-of date picker
- DeepSeek AI chat sidebar with financial context
- User management with login, password reset, and role-based access
- Kanban task board with priority grouping, filters, and due dates
- Excel export across all report views
- Clickable Odoo deep links on all dashboard pages
- Historical balance sync using Odoo read_group API

### Fixed
- Odoo XML-RPC connection drops: fresh connections per RPC call instead of shared socket
- Journal sync batch size reduced to 200 with 1-second delay between batches
- RPC timeout increased to 120 seconds for large syncs
- Cash position entity totals correctly use bank-only (100xxx) codes
- Balance sheet defaults to latest snapshot instead of hardcoded dates
- Revenue/expenses sign convention corrected across all views

### Changed
- Unified navigation bar across all 17 dashboard pages
- Consolidated tabs from 8 to 4 with cleaner management view
- Dashboard-wide login with persistent sessions
