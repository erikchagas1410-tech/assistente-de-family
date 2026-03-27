'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BankAccountId } from '@/types/finance';

type AccountBalanceEditorProps = {
  accountId: BankAccountId;
  currentBalance: number;
};

export default function AccountBalanceEditor({ accountId, currentBalance }: AccountBalanceEditorProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [targetBalance, setTargetBalance] = useState(currentBalance.toFixed(2));
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    startTransition(async () => {
      const response = await fetch('/api/accounts/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccount: accountId,
          targetBalance: Number(targetBalance),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Nao consegui ajustar o saldo.');
        return;
      }

      setIsOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45 transition hover:border-white/20 hover:text-white"
      >
        Ajustar Saldo
      </button>

      {isOpen && (
        <form onSubmit={onSubmit} className="mt-3 space-y-2">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">Saldo desejado</span>
            <input
              value={targetBalance}
              onChange={(event) => setTargetBalance(event.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-lime-400/40"
            />
          </label>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1.5 text-xs font-semibold text-lime-300 transition hover:border-lime-400/50 disabled:opacity-60"
            >
              {isPending ? 'Ajustando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetBalance(currentBalance.toFixed(2));
                setIsOpen(false);
                setError('');
              }}
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-white/20 hover:text-white"
            >
              Fechar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
