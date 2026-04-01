import { z } from 'zod';

export const AccountType = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);
export type AccountType = z.infer<typeof AccountType>;

export const CreateAccountSchema = z.object({
  name: z.string().min(1).max(255),
  type: AccountType,
  code: z.string().min(1).max(20),
  parent_id: z.string().optional(),
  description: z.string().default(''),
});

export const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
});

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  code: string;
  parent_id: string | null;
  description: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}
