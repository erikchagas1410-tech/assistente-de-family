'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BankAccountId, EntityType, TransactionType } from '@/types/finance';

type BankOption = {
  id: BankAccountId;
  label: string;
  entity: EntityType;
};

type TransactionComposerProps = {
  bankAccounts: BankOption[];
};

export default function TransactionComposer({ bankAccounts }: TransactionComposerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<TransactionType>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [entity, setEntity] = useState<EntityType>('CPF');
  const [bankAccount, setBankAccount] = useState<string>('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const title = useMemo(() => (type === 'income' ? 'Nova Entrada' : 'Nova Saida'), [type]);

  const resetForm = () => {
    setDescription('');
    setAmount('');
    setEntity('CPF');
    setBankAccount('');
    setError('');
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    startTransition(async () => {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          amount: Number(amount),
          type,
          entity,
          bank_account: bankAccount || null,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Nao consegui salvar o lancamento.');
        return;
      }

      resetForm();
      setIsOpen(false);
      router.refresh();
    });
  };

  const onBankChange = (value: string) => {
    setBankAccount(value);
    const selected = bankAccounts.find((account) => account.id === value);
    if (selected) setEntity(selected.entity);
  };

  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/30">
          Lancamentos
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setType('income');
              setIsOpen((current) => (type === 'income' ? !current : true));
            }}
            className="rounded-full border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400/50 hover:bg-emerald-500/10"
          >
            Adicionar Entrada
          </button>
          <button
            type="button"
            onClick={() => {
              setType('expense');
              setIsOpen((current) => (type === 'expense' ? !current : true));
            }}
            className="rounded-full border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:border-rose-400/50 hover:bg-rose-500/10"
          >
            Adicionar Saida
          </button>
        </div>
      </div>

      {isOpen && (
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1 xl:col-span-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Descricao</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={type === 'income' ? 'Ex.: Recebimento cliente' : 'Ex.: Uber'}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400/40"
              required
            />
          </label>

          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Valor</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400/40"
              required
            />
          </label>

          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Conta</span>
            <select
              value={bankAccount}
              onChange={(event) => onBankChange(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400/40"
            >
              <option value="">Sem banco</option>
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Entidade</span>
            <select
              value={entity}
              onChange={(event) => setEntity(event.target.value as EntityType)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400/40"
            >
              <option value="CPF">CPF</option>
              <option value="CNPJ">CNPJ</option>
            </select>
          </label>

          <div className="md:col-span-2 xl:col-span-5 flex flex-wrap items-center gap-3">
            <p className="text-xs text-white/40">{title}</p>
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  resetForm();
                }}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-white/20 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1.5 text-xs font-semibold text-lime-300 transition hover:border-lime-400/50 disabled:opacity-60"
              >
                {isPending ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
