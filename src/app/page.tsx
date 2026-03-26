import Link from 'next/link';
import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Title,
} from '@tremor/react';
import { AlertTriangle, Landmark, Terminal } from 'lucide-react';
import CategoryChart from '@/components/charts/CategoryChart';
import KpiCards from '@/components/charts/KpiCards';
import TelemetryChart from '@/components/charts/TelemetryChart';
import { BANK_ACCOUNTS, getBankAccountLabel } from '@/lib/banks';
import { supabase } from '@/lib/supabase/client';
import { BankAccountId, Transaction } from '@/types/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type HomeProps = {
  searchParams?: {
    tab?: string;
  };
};

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const tabClassName = (isActive: boolean) =>
  `px-4 py-2 text-xs font-black uppercase tracking-[0.3em] border transition ${
    isActive
      ? 'border-cyan-400 bg-cyan-400/10 text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.15)]'
      : 'border-white/10 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-200'
  }`;

export default async function Home({ searchParams }: HomeProps) {
  const activeTab = searchParams?.tab === 'bancos' ? 'bancos' : 'resumo';

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Erro ao buscar dados do Supabase:', error);
  }

  const transactions = (data || []) as Transaction[];

  let incomeCpf = 0;
  let expenseCpf = 0;
  let incomeCnpj = 0;
  let expenseCnpj = 0;

  for (const transaction of transactions) {
    if (transaction.entity === 'CNPJ') {
      if (transaction.type === 'income') incomeCnpj += Number(transaction.amount);
      if (transaction.type === 'expense') expenseCnpj += Number(transaction.amount);
      continue;
    }

    if (transaction.type === 'income') incomeCpf += Number(transaction.amount);
    if (transaction.type === 'expense') expenseCpf += Number(transaction.amount);
  }

  const balanceCpf = incomeCpf - expenseCpf;
  const balanceCnpj = incomeCnpj - expenseCnpj;

  const chartData = transactions
    .reduce((acc: { date: string; Entradas: number; Saidas: number }[], transaction) => {
      const date = new Date(transaction.created_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
      });
      const existing = acc.find((item) => item.date === date);

      if (existing) {
        if (transaction.type === 'income') existing.Entradas += Number(transaction.amount);
        if (transaction.type === 'expense') existing.Saidas += Number(transaction.amount);
        return acc;
      }

      acc.push({
        date,
        Entradas: transaction.type === 'income' ? Number(transaction.amount) : 0,
        Saidas: transaction.type === 'expense' ? Number(transaction.amount) : 0,
      });

      return acc;
    }, [])
    .reverse();

  const expensesByCategory = transactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((acc: { name: string; value: number }[], transaction) => {
      const categoryName = transaction.description;
      const existing = acc.find((item) => item.name === categoryName);

      if (existing) {
        existing.value += Number(transaction.amount);
        return acc;
      }

      acc.push({ name: categoryName, value: Number(transaction.amount) });
      return acc;
    }, [])
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const totalIncome = incomeCpf + incomeCnpj;
  const totalExpense = expenseCpf + expenseCnpj;
  const isCritical = totalIncome > 0 && totalExpense / totalIncome > 0.85;

  const bankSummaries = BANK_ACCOUNTS.map((account) => {
    const accountTransactions = transactions.filter(
      (transaction) => transaction.bank_account === account.id,
    );

    const income = accountTransactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

    const expense = accountTransactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

    return {
      ...account,
      income,
      expense,
      balance: income - expense,
      count: accountTransactions.length,
    };
  });

  const pfBanks = bankSummaries.filter((account) => account.entity === 'CPF');
  const pjBanks = bankSummaries.filter((account) => account.entity === 'CNPJ');
  const unassignedTransactions = transactions.filter((transaction) => !transaction.bank_account);

  return (
    <main className="max-w-[1400px] mx-auto space-y-8 p-4 md:p-8">
      <div className="flex flex-col gap-6 border-b border-white/5 pb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="bg-gradient-to-r from-cyan-400 via-purple-500 to-fuchsia-500 bg-clip-text text-5xl font-black tracking-tighter text-transparent drop-shadow-[0_0_15px_rgba(0,240,255,0.4)]">
            NEXUS CHROME
          </h1>
          <p className="mt-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-yellow-400/80">
            <Terminal className="h-4 w-4" /> Constructo Financeiro Ativo
          </p>
        </div>

        <div className="flex flex-col items-start gap-4 md:items-end">
          <div className="flex items-center gap-3 rounded-none border border-cyan-500/40 bg-black/60 px-4 py-2 shadow-[0_0_15px_rgba(0,240,255,0.2)] backdrop-blur-md">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-sm bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-sm bg-cyan-500 shadow-[0_0_8px_rgba(0,240,255,1)]"></span>
            </span>
            <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">
              Uplink Estabelecido
            </span>
          </div>

          <div className="flex gap-2">
            <Link href="/" className={tabClassName(activeTab === 'resumo')}>
              Resumo
            </Link>
            <Link href="/?tab=bancos" className={tabClassName(activeTab === 'bancos')}>
              Bancos
            </Link>
          </div>
        </div>
      </div>

      {isCritical && (
        <div className="relative flex items-start gap-4 overflow-hidden rounded-none border border-fuchsia-500/50 bg-fuchsia-950/40 p-6 shadow-[0_0_30px_rgba(217,70,239,0.3)] backdrop-blur-md">
          <div className="absolute left-0 top-0 h-full w-1 bg-fuchsia-500 shadow-[0_0_15px_rgba(217,70,239,1)]"></div>
          <AlertTriangle className="h-8 w-8 flex-shrink-0 animate-pulse text-fuchsia-500 drop-shadow-[0_0_10px_rgba(217,70,239,0.8)]" />
          <div>
            <h3 className="text-lg font-black uppercase tracking-widest text-fuchsia-500 drop-shadow-[0_0_8px_rgba(217,70,239,0.8)]">
              Aviso: Sobrecarga de Sistema
            </h3>
            <p className="mt-1 text-sm font-medium tracking-wide text-fuchsia-300/80">
              As despesas superaram 85% das entradas totais. Vale revisar os lancamentos
              mais pesados antes de fechar o periodo.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'resumo' ? (
        <>
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 border-b border-cyan-500/20 pb-2 text-sm font-black uppercase tracking-[0.3em] text-cyan-500/80">
                <span className="h-2 w-2 rounded-sm bg-cyan-500/80 shadow-[0_0_5px_rgba(0,240,255,0.8)]"></span>
                Patrimonio Fisico (CPF)
              </h2>
              <KpiCards balance={balanceCpf} income={incomeCpf} expense={expenseCpf} />
            </div>

            <div className="space-y-4">
              <h2 className="flex items-center gap-2 border-b border-purple-500/20 pb-2 text-sm font-black uppercase tracking-[0.3em] text-purple-400/80">
                <span className="h-2 w-2 rounded-sm bg-purple-500/80 shadow-[0_0_5px_rgba(168,85,247,0.8)]"></span>
                Caixa Corporativo (CNPJ)
              </h2>
              <KpiCards balance={balanceCnpj} income={incomeCnpj} expense={expenseCnpj} />
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TelemetryChart chartData={chartData} />
            </div>
            <div className="lg:col-span-1">
              <CategoryChart data={expensesByCategory} />
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
            <Card className="rounded-none border border-cyan-500/20 border-l-4 border-l-cyan-400 bg-black/60 shadow-[0_0_20px_rgba(34,211,238,0.08)] ring-0 backdrop-blur-md">
              <Title className="mb-5 flex items-center gap-3 border-b border-cyan-500/20 pb-4 text-sm font-bold uppercase tracking-widest text-cyan-100">
                <Landmark className="h-4 w-4 text-cyan-400" />
                Bancos PF
              </Title>

              <div className="space-y-4">
                {pfBanks.map((account) => (
                  <div
                    key={account.id}
                    className="border border-cyan-500/10 bg-cyan-500/5 p-4 shadow-[0_0_18px_rgba(34,211,238,0.04)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
                          {account.label}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-500">
                          {account.count} lancamentos
                        </p>
                      </div>
                      <Badge color="cyan" className="rounded-none border border-current text-[10px] font-bold uppercase tracking-wider">
                        {account.bank}
                      </Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
                          Entradas
                        </p>
                        <p className="mt-1 text-lg font-semibold text-emerald-300">
                          {formatCurrency(account.income)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
                          Saidas
                        </p>
                        <p className="mt-1 text-lg font-semibold text-rose-300">
                          {formatCurrency(account.expense)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
                          Saldo
                        </p>
                        <p className="mt-1 text-lg font-semibold text-cyan-100">
                          {formatCurrency(account.balance)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="rounded-none border border-purple-500/20 border-l-4 border-l-purple-400 bg-black/60 shadow-[0_0_20px_rgba(168,85,247,0.08)] ring-0 backdrop-blur-md">
              <Title className="mb-5 flex items-center gap-3 border-b border-purple-500/20 pb-4 text-sm font-bold uppercase tracking-widest text-purple-100">
                <Landmark className="h-4 w-4 text-purple-400" />
                Bancos PJ
              </Title>

              <div className="space-y-4">
                {pjBanks.map((account) => (
                  <div
                    key={account.id}
                    className="border border-purple-500/10 bg-purple-500/5 p-4 shadow-[0_0_18px_rgba(168,85,247,0.04)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-purple-200">
                          {account.label}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-500">
                          {account.count} lancamentos
                        </p>
                      </div>
                      <Badge color="violet" className="rounded-none border border-current text-[10px] font-bold uppercase tracking-wider">
                        {account.bank}
                      </Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
                          Entradas
                        </p>
                        <p className="mt-1 text-lg font-semibold text-emerald-300">
                          {formatCurrency(account.income)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
                          Saidas
                        </p>
                        <p className="mt-1 text-lg font-semibold text-rose-300">
                          {formatCurrency(account.expense)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
                          Saldo
                        </p>
                        <p className="mt-1 text-lg font-semibold text-purple-100">
                          {formatCurrency(account.balance)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {unassignedTransactions.length > 0 && (
            <Card className="rounded-none border border-amber-500/20 border-l-4 border-l-amber-400 bg-black/60 ring-0 backdrop-blur-md">
              <Title className="mb-2 text-sm font-bold uppercase tracking-widest text-amber-100">
                Lancamentos sem banco
              </Title>
              <p className="text-sm text-amber-200/80">
                {unassignedTransactions.length} transacao(oes) ainda nao tem banco vinculado.
                Os novos lancamentos pelo Telegram agora vao exigir esse dado antes de salvar.
              </p>
            </Card>
          )}
        </div>
      )}

      <Card className="mt-8 rounded-none border border-fuchsia-500/20 border-l-4 border-l-fuchsia-500 bg-black/60 shadow-[0_0_20px_rgba(217,70,239,0.05)] ring-0 backdrop-blur-md">
        <Title className="flex items-center gap-3 border-b border-fuchsia-500/20 pb-4 text-sm font-bold uppercase tracking-widest text-fuchsia-100">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-sm bg-fuchsia-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-sm bg-fuchsia-500 shadow-[0_0_5px_rgba(217,70,239,1)]"></span>
          </span>
          Registro Neural de Transacoes
        </Title>

        <Table className="mt-5">
          <TableHead>
            <TableRow>
              <TableHeaderCell className="text-slate-400">Descricao</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Valor</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Entidade</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Banco</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Tipo</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Data</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="text-slate-300">{item.description}</TableCell>
                <TableCell className="text-slate-300">
                  {formatCurrency(Number(item.amount))}
                </TableCell>
                <TableCell>
                  <Badge
                    color={item.entity === 'CNPJ' ? 'violet' : 'cyan'}
                    className="rounded-none border border-current text-[10px] font-bold uppercase tracking-wider"
                  >
                    {item.entity || 'CPF'}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  {item.bank_account ? (
                    <Badge
                      color="gray"
                      className="rounded-none border border-current text-[10px] font-bold uppercase tracking-wider"
                    >
                      {getBankAccountLabel(item.bank_account as BankAccountId)}
                    </Badge>
                  ) : (
                    <span className="text-amber-300">Nao informado</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    color={item.type === 'income' ? 'emerald' : 'fuchsia'}
                    className="rounded-none border border-current text-[10px] font-bold uppercase tracking-wider"
                  >
                    {item.type === 'income' ? 'Entrada' : 'Saida'}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  {new Date(item.created_at).toLocaleDateString('pt-BR')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </main>
  );
}
