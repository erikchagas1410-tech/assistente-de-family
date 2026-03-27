export type EntityType = 'CPF' | 'CNPJ';
export type TransactionType = 'income' | 'expense';
export type BankAccountId =
  | 'bradesco_pf'
  | 'bradesco_pj'
  | 'c6_pf'
  | 'c6_pj'
  | 'santander_pf';

export interface Category {
  id: string;
  name: string;
  budget: number;
  color: string;
}

export interface Transaction {
  id: string;
  created_at: Date;
  description: string;
  amount: number;
  type: TransactionType;
  entity: EntityType;
  bank_account?: BankAccountId | null;
  category_id: string | null;
}

export interface Bill {
  id: string;
  created_at: Date;
  description: string;
  amount: number;
  due_date: string; // ISO date YYYY-MM-DD
  paid_at: Date | null;
  entity: EntityType;
  bank_account?: BankAccountId | null;
  notes?: string | null;
}
