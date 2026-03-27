'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

type DeleteTransactionButtonProps = {
  id: string;
  description: string;
};

export default function DeleteTransactionButton({ id, description }: DeleteTransactionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onDelete = () => {
    if (!window.confirm(`Remover o lancamento "${description}"?`)) return;

    startTransition(async () => {
      const response = await fetch('/api/transactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        window.alert('Nao consegui remover o lancamento.');
        return;
      }

      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={isPending}
      className="rounded-full border border-rose-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-rose-300/80 transition hover:border-rose-400/40 hover:bg-rose-500/10 disabled:opacity-50"
    >
      {isPending ? '...' : 'Remover'}
    </button>
  );
}
