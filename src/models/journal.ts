import { z } from 'zod';

export const LineItemSchema = z.object({
  account_id: z.string().min(1),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  description: z.string().default(''),
});

export const CreateJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  reference: z.string().default(''),
  line_items: z.array(LineItemSchema).min(2),
});

export interface JournalEntry {
  id: string;
  date: string;
  description: string;
  reference: string;
  status: 'draft' | 'posted' | 'void';
  created_at: string;
  updated_at: string;
  posted_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface LineItem {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  amount_currency: number;
  currency: string;
  description: string;
}
