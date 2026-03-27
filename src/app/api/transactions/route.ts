import { NextResponse } from 'next/server';
import { BANK_ACCOUNT_BY_ID, isValidBankAccount } from '@/lib/banks';
import { supabase } from '@/lib/supabase/client';
import { EntityType, TransactionType } from '@/types/finance';

export const dynamic = 'force-dynamic';

type CreateTransactionBody = {
  description?: string;
  amount?: number;
  type?: TransactionType;
  entity?: EntityType;
  bank_account?: string | null;
};

export async function POST(request: Request) {
  const body = (await request.json()) as CreateTransactionBody;
  const description = body.description?.trim();
  const amount = Number(body.amount);
  const type = body.type;

  if (!description || !Number.isFinite(amount) || amount <= 0 || (type !== 'income' && type !== 'expense')) {
    return NextResponse.json({ error: 'Dados invalidos para criar lancamento.' }, { status: 400 });
  }

  const bankAccount = body.bank_account && isValidBankAccount(body.bank_account) ? body.bank_account : null;
  const entity = bankAccount
    ? BANK_ACCOUNT_BY_ID[bankAccount].entity
    : body.entity === 'CNPJ'
    ? 'CNPJ'
    : 'CPF';

  const { data, error } = await supabase
    .from('transactions')
    .insert([{
      description,
      amount,
      type,
      entity,
      bank_account: bankAccount,
    }])
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(request: Request) {
  const { id } = (await request.json()) as { id?: string };

  if (!id) {
    return NextResponse.json({ error: 'Id do lancamento e obrigatorio.' }, { status: 400 });
  }

  const { error } = await supabase.from('transactions').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
