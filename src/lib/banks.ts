import { BankAccountId, EntityType } from '@/types/finance';

export interface BankAccountOption {
  id: BankAccountId;
  bank: 'Bradesco' | 'C6' | 'Santander';
  entity: EntityType;
  label: string;
  aliases: string[];
}

export const BANK_ACCOUNTS: BankAccountOption[] = [
  {
    id: 'bradesco_pf',
    bank: 'Bradesco',
    entity: 'CPF',
    label: 'Bradesco PF',
    aliases: ['bradesco pf', 'bradesco pessoa fisica', 'bradesco pessoal', 'bradesco'],
  },
  {
    id: 'bradesco_pj',
    bank: 'Bradesco',
    entity: 'CNPJ',
    label: 'Bradesco PJ',
    aliases: ['bradesco pj', 'bradesco pessoa juridica', 'bradesco empresa'],
  },
  {
    id: 'c6_pf',
    bank: 'C6',
    entity: 'CPF',
    label: 'C6 PF',
    aliases: ['c6 pf', 'c6 pessoa fisica', 'c6 pessoal', 'c6'],
  },
  {
    id: 'c6_pj',
    bank: 'C6',
    entity: 'CNPJ',
    label: 'C6 PJ',
    aliases: ['c6 pj', 'c6 pessoa juridica', 'c6 empresa'],
  },
  {
    id: 'santander_pf',
    bank: 'Santander',
    entity: 'CPF',
    label: 'Santander PF',
    aliases: ['santander pf', 'santander pessoa fisica', 'santander'],
  },
];

export const BANK_ACCOUNT_BY_ID = Object.fromEntries(
  BANK_ACCOUNTS.map((account) => [account.id, account]),
) as Record<BankAccountId, BankAccountOption>;

export const isValidBankAccount = (value: string | null | undefined): value is BankAccountId =>
  !!value && value in BANK_ACCOUNT_BY_ID;

export const getBankAccountLabel = (value: BankAccountId | null | undefined) =>
  value && isValidBankAccount(value) ? BANK_ACCOUNT_BY_ID[value].label : 'Nao informado';
