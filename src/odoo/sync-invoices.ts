import Database from 'better-sqlite3';
import crypto from 'crypto';
import { OdooClient } from './client';

export interface InvoiceSyncResult {
  invoices: { created: number; updated: number; total: number };
  payments: { created: number; updated: number; total: number };
  errors: string[];
}

export async function syncInvoices(
  odoo: OdooClient,
  db: Database.Database,
  options: { limit?: number; dateFrom?: string; dateTo?: string } = {}
): Promise<InvoiceSyncResult> {
  const result: InvoiceSyncResult = {
    invoices: { created: 0, updated: 0, total: 0 },
    payments: { created: 0, updated: 0, total: 0 },
    errors: [],
  };

  // --- Sync Invoices (account.move with move_type in invoice types) ---
  const invoiceDomain: unknown[][] = [
    ['move_type', 'in', ['out_invoice', 'in_invoice', 'out_refund', 'in_refund']],
  ];
  if (options.dateFrom) invoiceDomain.push(['invoice_date', '>=', options.dateFrom]);
  if (options.dateTo) invoiceDomain.push(['invoice_date', '<=', options.dateTo]);

  const odooInvoices = await odoo.searchRead(
    'account.move',
    invoiceDomain,
    [
      'id', 'name', 'partner_id', 'move_type', 'state',
      'invoice_date', 'invoice_date_due', 'amount_total',
      'amount_residual', 'currency_id',
    ],
    { order: 'invoice_date desc', limit: options.limit }
  );

  result.invoices.total = odooInvoices.length;

  const getEntryByOdooId = db.prepare('SELECT id FROM journal_entries WHERE odoo_id = ?');

  const upsertInvoice = db.prepare(`
    INSERT INTO invoices (id, odoo_id, number, partner_name, partner_id, type, state, date, due_date, amount_total, amount_due, currency, journal_entry_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(odoo_id) DO UPDATE SET
      number = excluded.number,
      partner_name = excluded.partner_name,
      state = excluded.state,
      amount_total = excluded.amount_total,
      amount_due = excluded.amount_due,
      journal_entry_id = excluded.journal_entry_id,
      updated_at = datetime('now')
  `);

  const getInvoiceByOdooId = db.prepare('SELECT id FROM invoices WHERE odoo_id = ?');

  const invoiceTx = db.transaction(() => {
    for (const inv of odooInvoices) {
      try {
        const odooId = inv.id as number;
        const name = (inv.name as string) || '';
        const partnerRef = inv.partner_id as [number, string] | false;
        const partnerName = partnerRef ? partnerRef[1] : 'Unknown';
        const partnerId = partnerRef ? partnerRef[0] : null;
        const moveType = inv.move_type as string;
        const state = inv.state as string;
        const date = (inv.invoice_date as string) || '';
        const dueDate = (inv.invoice_date_due as string | false) || null;
        const amountTotal = (inv.amount_total as number) || 0;
        const amountDue = (inv.amount_residual as number) || 0;
        const currencyRef = inv.currency_id as [number, string] | false;
        const currency = currencyRef ? currencyRef[1] : 'USD';

        // Link to local journal entry if synced
        const localEntry = getEntryByOdooId.get(odooId) as { id: string } | undefined;
        const journalEntryId = localEntry?.id || null;

        const existing = getInvoiceByOdooId.get(odooId) as { id: string } | undefined;
        const id = existing?.id || crypto.randomUUID();

        upsertInvoice.run(
          id, odooId, name, partnerName, partnerId,
          moveType, state, date, dueDate,
          amountTotal, amountDue, currency, journalEntryId
        );

        if (existing) result.invoices.updated++;
        else result.invoices.created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Invoice ${inv.name} (${inv.id}): ${msg}`);
      }
    }
  });

  invoiceTx();

  // --- Sync Payments (account.payment) ---
  const paymentDomain: unknown[][] = [];
  if (options.dateFrom) paymentDomain.push(['date', '>=', options.dateFrom]);
  if (options.dateTo) paymentDomain.push(['date', '<=', options.dateTo]);

  const odooPayments = await odoo.searchRead(
    'account.payment',
    paymentDomain,
    [
      'id', 'name', 'partner_id', 'amount', 'date',
      'payment_type', 'state', 'ref', 'currency_id', 'move_id',
    ],
    { order: 'date desc', limit: options.limit }
  );

  result.payments.total = odooPayments.length;

  const upsertPayment = db.prepare(`
    INSERT INTO payments (id, odoo_id, partner_name, partner_id, amount, date, payment_type, state, reference, currency, journal_entry_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(odoo_id) DO UPDATE SET
      partner_name = excluded.partner_name,
      amount = excluded.amount,
      state = excluded.state,
      reference = excluded.reference,
      journal_entry_id = excluded.journal_entry_id,
      updated_at = datetime('now')
  `);

  const getPaymentByOdooId = db.prepare('SELECT id FROM payments WHERE odoo_id = ?');

  const paymentTx = db.transaction(() => {
    for (const pmt of odooPayments) {
      try {
        const odooId = pmt.id as number;
        const partnerRef = pmt.partner_id as [number, string] | false;
        const partnerName = partnerRef ? partnerRef[1] : 'Unknown';
        const partnerId = partnerRef ? partnerRef[0] : null;
        const amount = (pmt.amount as number) || 0;
        const date = pmt.date as string;
        const paymentType = pmt.payment_type as string;
        const state = pmt.state as string;
        const ref = (pmt.ref as string | false) || '';
        const currencyRef = pmt.currency_id as [number, string] | false;
        const currency = currencyRef ? currencyRef[1] : 'USD';

        // Link to local journal entry via move_id
        const moveRef = pmt.move_id as [number, string] | false;
        const localEntry = moveRef ? getEntryByOdooId.get(moveRef[0]) as { id: string } | undefined : undefined;
        const journalEntryId = localEntry?.id || null;

        const existing = getPaymentByOdooId.get(odooId) as { id: string } | undefined;
        const id = existing?.id || crypto.randomUUID();

        upsertPayment.run(
          id, odooId, partnerName, partnerId,
          amount, date, paymentType, state, ref, currency, journalEntryId
        );

        if (existing) result.payments.updated++;
        else result.payments.created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Payment ${pmt.name} (${pmt.id}): ${msg}`);
      }
    }
  });

  paymentTx();

  return result;
}
