import { NextResponse } from 'next/server';
import { BANK_ACCOUNT_BY_ID, isValidBankAccount } from '@/lib/banks';
import { supabase } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

type AdjustBalanceBody = {
  bankAccount?: string;
  targetBalance?: number;
};

export async function POST(request: Request) {
  const body = (await request.json()) as AdjustBalanceBody;
  const bankAccount = body.bankAccount;
  const targetBalance = Number(body.targetBalance);

  if (!bankAccount || !isValidBankAccount(bankAccount) || !Number.isFinite(targetBalance)) {
    return NextResponse.json({ error: 'Dados invalidos para ajuste de saldo.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, type')
    .eq('bank_account', bankAccount);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const currentBalance = (data ?? []).reduce((sum, item: { amount: number; type: string }) => {
    const amount = Number(item.amount);
    return item.type === 'income' ? sum + amount : sum - amount;
  }, 0);

  const difference = Number((targetBalance - currentBalance).toFixed(2));
  if (difference === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const account = BANK_ACCOUNT_BY_ID[bankAccount];
  const { error: insertError } = await supabase.from('transactions').insert([{
    description: 'Ajuste manual de saldo',
    amount: Math.abs(difference),
    type: difference > 0 ? 'income' : 'expense',
    entity: account.entity,
    bank_account: bankAccount,
  }]);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, currentBalance, targetBalance, difference });
}
