import { z } from 'zod';
import {
  getCashPosition,
  getCashHistory,
  getCompany,
  listRecentJournalEntries,
  searchJournalEntries,
  getJournalEntry,
  listPayments,
} from './db';

import path from 'path';

/*
 * The MCP SDK's registerTool() uses deep Zod-compat generics that trigger
 * TS2589 ("type instantiation excessively deep") with TypeScript 5.7+ and
 * the legacy `moduleResolution: node` used by finance-system.
 *
 * We also can't use `require('@modelcontextprotocol/sdk/dist/cjs/server/mcp')`
 * directly because the SDK's "./*" wildcard in its exports map doubles the
 * prefix at runtime (dist/cjs/server/mcp → dist/cjs/dist/cjs/server/mcp).
 *
 * Fix: resolve the SDK's main CJS entry via the explicit "." export, then
 * navigate to the specific file with an absolute path (absolute paths bypass
 * the exports map entirely).
 */
interface McpServerInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerTool(name: string, config: object, cb: (args: any) => Promise<any>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect(transport: any): Promise<void>;
  close(): void | Promise<void>;
}
/* eslint-disable @typescript-eslint/no-require-imports */
// Use explicit "./server" export (physically exists at dist/cjs/server/index.js).
// The "." export points to dist/cjs/index.js which does NOT exist in the package.
// Two dirname() calls: dist/cjs/server/index.js → dist/cjs/server/ → dist/cjs/
const _sdkCjsDir = path.dirname(path.dirname(require.resolve('@modelcontextprotocol/sdk/server')));
const { McpServer: McpServerClass } = require(
  path.join(_sdkCjsDir, 'server/mcp.js')
) as { McpServer: new (config: { name: string; version: string }) => McpServerInstance };
/* eslint-enable @typescript-eslint/no-require-imports */

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Date in YYYY-MM-DD format');

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Wrap a structured result into the SDK's dual text+structured response. */
const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  structuredContent: data as Record<string, unknown>,
});

export function buildServer(): McpServerInstance {
  const server = new McpServerClass({ name: 'xter-finance-mcp-server', version: '1.0.0' });

  server.registerTool(
    'get_cash_position',
    {
      title: 'Cash position',
      description:
        "Aggregate cash position per company or consolidated. Cash = accounts with account_type='asset_cash' in the latest account_balances snapshot. Account codes 100xxx are bank accounts, 10Wxxx are crypto wallets. Balances in USD.",
      inputSchema: {
        as_of_date: DATE.optional().describe('As-of date. Defaults to latest snapshot.'),
        company_id: z.number().int().optional().describe('Filter to one company. Omit for consolidated.'),
      },
      annotations: READ_ONLY,
    },
    async (args: { as_of_date?: string; company_id?: number }) =>
      ok(getCashPosition(args.as_of_date, args.company_id))
  );

  server.registerTool(
    'get_cash_history',
    {
      title: 'Cash history',
      description:
        'Weekly cash trend from historical_cash_weekly. Returns per-bucket totals plus grand_total by snapshot_date, descending.',
      inputSchema: {
        start_date: DATE.optional(),
        end_date: DATE.optional(),
        limit: z.number().int().min(1).max(500).default(52),
      },
      annotations: READ_ONLY,
    },
    async (args: { start_date?: string; end_date?: string; limit: number }) =>
      ok(getCashHistory(args.start_date, args.end_date, args.limit))
  );

  server.registerTool(
    'get_company',
    {
      title: 'Company detail',
      description:
        'Detail for one company: every account with its latest snapshot balance, plus a rollup by account_type. Resolve by company_id or exact company_name.',
      inputSchema: {
        company_id: z.number().int().optional().describe('Odoo company_id.'),
        company_name: z.string().optional().describe('Exact company name.'),
      },
      annotations: READ_ONLY,
    },
    async (args: { company_id?: number; company_name?: string }) =>
      ok(getCompany({ companyId: args.company_id, companyName: args.company_name }))
  );

  server.registerTool(
    'list_recent_journal_entries',
    {
      title: 'Recent journal entries',
      description:
        'List journal entries ordered by date descending, with filters by company, status, date range, and minimum size. Each row includes total_debit / total_credit / line_count (computed). Paginated; returns total_matching for the filter.',
      inputSchema: {
        company_id: z.number().int().optional(),
        status: z.enum(['posted', 'draft', 'void', 'all']).default('posted'),
        start_date: DATE.optional(),
        end_date: DATE.optional(),
        min_amount_usd: z.number().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: READ_ONLY,
    },
    async (a: {
      company_id?: number;
      status: string;
      start_date?: string;
      end_date?: string;
      min_amount_usd?: number;
      limit: number;
      offset: number;
    }) =>
      ok(
        listRecentJournalEntries({
          companyId: a.company_id,
          status: a.status,
          startDate: a.start_date,
          endDate: a.end_date,
          minAmountUsd: a.min_amount_usd,
          limit: a.limit,
          offset: a.offset,
        })
      )
  );

  server.registerTool(
    'search_journal_entries',
    {
      title: 'Search journal entries',
      description:
        'Substring search over journal entries — matches header description/reference and any line-item description (case-insensitive). Returns the same summary shape as list_recent_journal_entries.',
      inputSchema: {
        query: z.string().min(1).describe('Substring to match.'),
        company_id: z.number().int().optional(),
        status: z.enum(['posted', 'draft', 'void', 'all']).default('posted'),
        start_date: DATE.optional(),
        end_date: DATE.optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: READ_ONLY,
    },
    async (a: {
      query: string;
      company_id?: number;
      status: string;
      start_date?: string;
      end_date?: string;
      limit: number;
      offset: number;
    }) =>
      ok(
        searchJournalEntries({
          query: a.query,
          companyId: a.company_id,
          status: a.status,
          startDate: a.start_date,
          endDate: a.end_date,
          limit: a.limit,
          offset: a.offset,
        })
      )
  );

  server.registerTool(
    'get_journal_entry',
    {
      title: 'Journal entry detail',
      description:
        'Full detail on one journal entry — header fields plus every line item with account code, debit/credit (USD), and original-currency amount. Resolve by journal_entry_id (UUID) or odoo_id.',
      inputSchema: {
        journal_entry_id: z.string().optional(),
        odoo_id: z.number().int().optional(),
      },
      annotations: READ_ONLY,
    },
    async (args: { journal_entry_id?: string; odoo_id?: number }) =>
      ok(getJournalEntry({ journalEntryId: args.journal_entry_id, odooId: args.odoo_id }))
  );

  server.registerTool(
    'list_payments',
    {
      title: 'List payments',
      description:
        'List payments (money in / money out) with filters by direction, state, partner, date range, and minimum size. The `amount` field is in the payment currency (USD for most entries).',
      inputSchema: {
        payment_type: z.enum(['inbound', 'outbound', 'all']).default('all'),
        state: z.string().optional(),
        partner_contains: z.string().optional(),
        start_date: DATE.optional(),
        end_date: DATE.optional(),
        min_amount: z.number().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: READ_ONLY,
    },
    async (a: {
      payment_type: string;
      state?: string;
      partner_contains?: string;
      start_date?: string;
      end_date?: string;
      min_amount?: number;
      limit: number;
      offset: number;
    }) =>
      ok(
        listPayments({
          paymentType: a.payment_type,
          state: a.state,
          partnerContains: a.partner_contains,
          startDate: a.start_date,
          endDate: a.end_date,
          minAmount: a.min_amount,
          limit: a.limit,
          offset: a.offset,
        })
      )
  );

  return server;
}
