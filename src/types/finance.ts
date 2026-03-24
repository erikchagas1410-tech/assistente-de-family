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
  type: 'income' | 'expense';
  entity: 'CPF' | 'CNPJ';
  category_id: string;
}