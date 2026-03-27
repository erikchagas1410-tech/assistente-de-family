import { AlertTriangle, Landmark, TrendingDown, TrendingUp, Wallet, BarChart2, CalendarDays, Receipt } from 'lucide-react';
import CategoryChart from '@/components/charts/CategoryChart';
import TelemetryChart from '@/components/charts/TelemetryChart';
import AiPanel, { FinancialContext } from '@/components/AiPanel';
import { BANK_ACCOUNTS, getBankAccountLabel } from '@/lib/banks';
import { supabase } from '@/lib/supabase/client';
import { BankAccountId, Bill, Transaction } from '@/types/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmt = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ─── Data ─────────────────────────────────────────────────────────────────────

export default async function Home() {
  const [{ data, error }, { data: billsData }] = await Promise.all([
    supabase.from('transactions').select('*').order('created_at', { ascending: false }),
    supabase.from('bills').select('*').order('due_date', { ascending: true }),
  ]);

  if (error) console.error('Supabase error:', error);

  const transactions = (data ?? []) as Transaction[];
  const bills = (billsData ?? []) as Bill[];

  // ── Totals by entity ──────────────────────────────────────────────────────
  let incomeCpf = 0, expenseCpf = 0, incomeCnpj = 0, expenseCnpj = 0;

  for (const t of transactions) {
    const amount = Number(t.amount);
    if (t.entity === 'CNPJ') {
      if (t.type === 'income') incomeCnpj += amount;
      else expenseCnpj += amount;
    } else {
      if (t.type === 'income') incomeCpf += amount;
      else expenseCpf += amount;
    }
  }

  const totalIncome = incomeCpf + incomeCnpj;
  const totalExpense = expenseCpf + expenseCnpj;
  const totalBalance = totalIncome - totalExpense;
  const netResult = totalBalance;
  const expenseRatio = totalIncome > 0 ? totalExpense / totalIncome : 0;

  // ── Month projection ──────────────────────────────────────────────────────
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const dailyBurnRate = dayOfMonth > 0 ? totalExpense / dayOfMonth : 0;
  const remainingDays = daysInMonth - dayOfMonth;
  const projectedExpense = totalExpense + dailyBurnRate * remainingDays;
  const projectedBalance = totalIncome - projectedExpense;

  // ── Health score ──────────────────────────────────────────────────────────
  let healthScore: number;
  let healthLabel: string;

  if (totalIncome === 0 && totalExpense === 0) {
    healthScore = 50;
    healthLabel = 'Sem dados';
  } else if (totalIncome === 0) {
    healthScore = 5;
    healthLabel = 'Crítico';
  } else {
    const raw = Math.round((1 - expenseRatio) * 110); // slight amplification
    healthScore = Math.min(100, Math.max(0, raw));
    if (healthScore >= 80) healthLabel = 'Excelente';
    else if (healthScore >= 60) healthLabel = 'Saudável';
    else if (healthScore >= 40) healthLabel = 'Atenção';
    else if (healthScore >= 20) healthLabel = 'Em risco';
    else healthLabel = 'Crítico';
  }

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = transactions
    .reduce<{ date: string; Entradas: number; Saidas: number }[]>((acc, t) => {
      const date = new Date(t.created_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
      });
      const row = acc.find((r) => r.date === date);
      const amount = Number(t.amount);
      if (row) {
        if (t.type === 'income') row.Entradas += amount;
        else row.Saidas += amount;
      } else {
        acc.push({
          date,
          Entradas: t.type === 'income' ? amount : 0,
          Saidas: t.type === 'expense' ? amount : 0,
        });
      }
      return acc;
    }, [])
    .reverse();

  const expensesByCategory = transactions
    .filter((t) => t.type === 'expense')
    .reduce<{ name: string; value: number }[]>((acc, t) => {
      const row = acc.find((r) => r.name === t.description);
      if (row) row.value += Number(t.amount);
      else acc.push({ name: t.description, value: Number(t.amount) });
      return acc;
    }, [])
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // ── Bank summaries ────────────────────────────────────────────────────────
  const bankSummaries = BANK_ACCOUNTS.map((account) => {
    const txs = transactions.filter((t) => t.bank_account === account.id);
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    return { ...account, income, expense, balance: income - expense, count: txs.length };
  });

  const unassigned = transactions.filter((t) => !t.bank_account).length;

  // ── Bills status ──────────────────────────────────────────────────────────
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const in3Days = new Date(todayMidnight.getTime() + 3 * 86400000);

  const billsWithStatus = bills.map((bill) => {
    const due = new Date(bill.due_date + 'T00:00:00');
    let status: 'overdue' | 'due_soon' | 'pending' | 'paid';
    if (bill.paid_at) status = 'paid';
    else if (due < todayMidnight) status = 'overdue';
    else if (due <= in3Days) status = 'due_soon';
    else status = 'pending';
    const diffDays = Math.round((due.getTime() - todayMidnight.getTime()) / 86400000);
    return { ...bill, status, diffDays };
  });

  // Sort: overdue → due_soon → pending → paid
  const statusOrder = { overdue: 0, due_soon: 1, pending: 2, paid: 3 } as const;
  billsWithStatus.sort((a, b) => {
    const diff = statusOrder[a.status] - statusOrder[b.status];
    if (diff !== 0) return diff;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  const overdueBills = billsWithStatus.filter((b) => b.status === 'overdue');
  const dueSoonBills = billsWithStatus.filter((b) => b.status === 'due_soon');
  const unpaidBills  = billsWithStatus.filter((b) => b.status !== 'paid');

  // ── AI Insights ───────────────────────────────────────────────────────────
  const insights: string[] = [];

  if (expenseRatio > 0.85) {
    insights.push(`Despesas em ${Math.round(expenseRatio * 100)}% das entradas — risco de déficit.`);
  } else if (expenseRatio > 0.65) {
    insights.push(`${Math.round(expenseRatio * 100)}% das entradas já comprometidas com gastos.`);
  }
  if (expensesByCategory[0]) {
    insights.push(`"${expensesByCategory[0].name}" lidera os gastos: ${fmt(expensesByCategory[0].value)}.`);
  }
  const bestBank = [...bankSummaries].sort((a, b) => b.balance - a.balance)[0];
  if (bestBank?.balance > 0) {
    insights.push(`${bestBank.label} tem o melhor saldo: ${fmt(bestBank.balance)}.`);
  }
  if (projectedBalance < 0) {
    insights.push(`Projeção indica déficit de ${fmt(Math.abs(projectedBalance))} ao fechar o mês.`);
  }
  if (overdueBills.length > 0) {
    insights.push(`${overdueBills.length} conta(s) vencida(s) — total de ${fmt(overdueBills.reduce((s, b) => s + Number(b.amount), 0))}.`);
  }
  if (dueSoonBills.length > 0) {
    insights.push(`${dueSoonBills.length} conta(s) vencem em até 3 dias — total de ${fmt(dueSoonBills.reduce((s, b) => s + Number(b.amount), 0))}.`);
  }

  // ── AI Alert ─────────────────────────────────────────────────────────────
  let aiAlert: string | null = null;
  if (expenseRatio > 0.85) {
    aiAlert = `Despesas em ${Math.round(expenseRatio * 100)}% das suas entradas. Risco real de déficit no fim do período.`;
  } else if (projectedBalance < 0) {
    aiAlert = `Projeção indica déficit de ${fmt(Math.abs(projectedBalance))} no ritmo atual de gastos.`;
  } else if (expenseRatio > 0.7 && expensesByCategory[0]) {
    aiAlert = `"${expensesByCategory[0].name}" representa ${Math.round((expensesByCategory[0].value / totalExpense) * 100)}% das suas despesas. Vale revisar.`;
  } else if (overdueBills.length > 0) {
    aiAlert = `${overdueBills.length} conta(s) vencida(s) sem pagamento — total de ${fmt(overdueBills.reduce((s, b) => s + Number(b.amount), 0))}. Regularize para evitar juros.`;
  } else if (dueSoonBills.length > 0) {
    aiAlert = `${dueSoonBills.length} conta(s) vencem nos próximos 3 dias: ${dueSoonBills.map((b) => b.description).join(', ')}.`;
  }

  // ── Financial context for AI panel ───────────────────────────────────────
  const financialContext: FinancialContext = {
    totalBalance,
    totalIncome,
    totalExpense,
    netResult,
    projectedBalance,
    healthScore,
    healthLabel,
    expenseRatio,
  };

  const dateStr = today.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Background: faint grid + radial glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
        }}
      />
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_20%_20%,rgba(132,204,22,0.04)_0%,transparent_55%)]" />

      {/* Layout: main + fixed right panel */}
      <main className="lg:mr-[360px] px-5 py-7 lg:px-8 lg:py-8 space-y-6 relative z-10">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-white leading-none">
              NEXUS
              <span className="text-lime-400">.</span>
            </h1>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.35em] text-white/30">
              Constructo Financeiro Ativo
            </p>
          </div>

          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-2 text-[10px] text-white/30 uppercase tracking-widest">
              <CalendarDays className="w-3.5 h-3.5" />
              {dateStr}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 border border-lime-500/20 rounded-full bg-lime-500/[0.04]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-400" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-lime-400">
                Live
              </span>
            </div>
          </div>
        </header>

        {/* ── KPI Hero Cards (5) ──────────────────────────────────────── */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Total Balance */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1 bg-white/[0.03] border border-lime-500/15 rounded-xl p-4 hover:border-lime-500/30 transition-all">
            <div className="flex items-center gap-1.5 mb-3">
              <Wallet className="w-3.5 h-3.5 text-lime-400/70" />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
                Saldo Total
              </p>
            </div>
            <p
              className="text-2xl font-black text-lime-400 tabular-nums"
              style={{ textShadow: '0 0 20px rgba(163,230,53,0.3)' }}
            >
              {fmt(totalBalance)}
            </p>
            <p className="text-[10px] text-white/20 mt-1.5">CPF + CNPJ consolidado</p>
          </div>

          {/* Monthly Income */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 hover:border-emerald-500/20 transition-all">
            <div className="flex items-center gap-1.5 mb-3">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400/70" />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
                Entradas
              </p>
            </div>
            <p className="text-xl font-black text-emerald-400 tabular-nums">{fmt(totalIncome)}</p>
            <p className="text-[10px] text-white/20 mt-1.5">Receitas totais</p>
          </div>

          {/* Monthly Expenses */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 hover:border-rose-500/20 transition-all">
            <div className="flex items-center gap-1.5 mb-3">
              <TrendingDown className="w-3.5 h-3.5 text-rose-400/70" />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
                Saídas
              </p>
            </div>
            <p className="text-xl font-black text-rose-400 tabular-nums">{fmt(totalExpense)}</p>
            <p className="text-[10px] text-white/20 mt-1.5">
              {totalIncome > 0 ? `${Math.round(expenseRatio * 100)}% das entradas` : 'Sem entradas'}
            </p>
          </div>

          {/* Net Result */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 hover:border-white/10 transition-all">
            <div className="flex items-center gap-1.5 mb-3">
              <BarChart2 className="w-3.5 h-3.5 text-white/30" />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
                Resultado
              </p>
            </div>
            <p
              className={`text-xl font-black tabular-nums ${
                netResult >= 0 ? 'text-lime-400' : 'text-rose-400'
              }`}
            >
              {netResult >= 0 ? '+' : ''}
              {fmt(netResult)}
            </p>
            <p className="text-[10px] text-white/20 mt-1.5">Líquido do período</p>
          </div>

          {/* Projection */}
          <div
            className={`bg-white/[0.02] border rounded-xl p-4 transition-all ${
              projectedBalance < 0
                ? 'border-amber-500/20 hover:border-amber-500/35'
                : 'border-white/[0.05] hover:border-white/10'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-3">
              <CalendarDays
                className={`w-3.5 h-3.5 ${projectedBalance < 0 ? 'text-amber-400/70' : 'text-white/30'}`}
              />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
                Projeção
              </p>
            </div>
            <p
              className={`text-xl font-black tabular-nums ${
                projectedBalance < 0 ? 'text-amber-400' : 'text-white/70'
              }`}
            >
              {fmt(projectedBalance)}
            </p>
            <p className="text-[10px] text-white/20 mt-1.5">Estimativa fim do mês</p>
          </div>
        </section>

        {/* ── AI Alert ────────────────────────────────────────────────── */}
        {aiAlert && (
          <div className="relative flex items-start gap-4 rounded-xl border border-amber-500/25 bg-amber-950/20 px-5 py-4 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500/[0.06] to-transparent pointer-events-none" />
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400" style={{ boxShadow: '0 0 8px rgba(251,191,36,0.8)' }} />
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-400 mt-0.5" style={{ filter: 'drop-shadow(0 0 6px rgba(251,191,36,0.7))' }} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-400 mb-1">
                Alerta Nexus AI
              </p>
              <p className="text-sm text-amber-200/70 leading-relaxed">{aiAlert}</p>
            </div>
          </div>
        )}

        {/* ── Charts ──────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <TelemetryChart chartData={chartData} />
          </div>
          <div className="lg:col-span-1">
            <CategoryChart data={expensesByCategory} />
          </div>
        </section>

        {/* ── Bank Accounts ────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Landmark className="w-4 h-4 text-white/25" />
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/25">
              Contas Bancárias
            </p>
            {unassigned > 0 && (
              <span className="ml-auto text-[10px] text-amber-400/70 border border-amber-500/20 rounded-full px-2 py-0.5">
                {unassigned} sem banco
              </span>
            )}
          </div>

          {/* PF Banks */}
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/20 mb-2">Pessoa Física</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {bankSummaries
              .filter((a) => a.entity === 'CPF')
              .map((account) => {
                const ratio = account.income > 0 ? account.expense / account.income : 0;
                const barPct = Math.min(100, Math.round(ratio * 100));
                const barColor =
                  barPct > 85 ? 'bg-rose-500' : barPct > 70 ? 'bg-amber-400' : 'bg-lime-400';
                return (
                  <div
                    key={account.id}
                    className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 hover:border-lime-500/15 transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-white/80">{account.bank}</p>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-lime-400/70 bg-lime-500/[0.08] border border-lime-500/15 rounded px-1.5 py-0.5 mt-1 inline-block">
                          CPF
                        </span>
                      </div>
                      <p className="text-[10px] text-white/25">{account.count} tx</p>
                    </div>
                    <p
                      className={`text-xl font-black tabular-nums mb-3 ${
                        account.balance >= 0 ? 'text-white/90' : 'text-rose-400'
                      }`}
                    >
                      {fmt(account.balance)}
                    </p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] text-white/25">
                        <span className="text-emerald-400/60">↑ {fmt(account.income)}</span>
                        <span className="text-rose-400/60">↓ {fmt(account.expense)}</span>
                      </div>
                      {account.income > 0 && (
                        <div className="h-0.5 bg-white/[0.05] rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor} rounded-full`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* PJ Banks */}
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/20 mb-2">
            Pessoa Jurídica
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {bankSummaries
              .filter((a) => a.entity === 'CNPJ')
              .map((account) => {
                const ratio = account.income > 0 ? account.expense / account.income : 0;
                const barPct = Math.min(100, Math.round(ratio * 100));
                const barColor =
                  barPct > 85 ? 'bg-rose-500' : barPct > 70 ? 'bg-amber-400' : 'bg-violet-400';
                return (
                  <div
                    key={account.id}
                    className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 hover:border-violet-500/15 transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-sm font-bold text-white/80">{account.bank}</p>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400/70 bg-violet-500/[0.08] border border-violet-500/15 rounded px-1.5 py-0.5 mt-1 inline-block">
                          CNPJ
                        </span>
                      </div>
                      <p className="text-[10px] text-white/25">{account.count} tx</p>
                    </div>
                    <p
                      className={`text-xl font-black tabular-nums mb-3 ${
                        account.balance >= 0 ? 'text-white/90' : 'text-rose-400'
                      }`}
                    >
                      {fmt(account.balance)}
                    </p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] text-white/25">
                        <span className="text-emerald-400/60">↑ {fmt(account.income)}</span>
                        <span className="text-rose-400/60">↓ {fmt(account.expense)}</span>
                      </div>
                      {account.income > 0 && (
                        <div className="h-0.5 bg-white/[0.05] rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor} rounded-full`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>

        {/* ── Transactions ─────────────────────────────────────────────── */}
        <section>
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.04]">
              <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse" />
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/30">
                Transações Recentes
              </p>
              <span className="ml-auto text-[10px] text-white/20">
                {transactions.length} registros
              </span>
            </div>

            <div className="divide-y divide-white/[0.03]">
              {transactions.length === 0 ? (
                <p className="px-5 py-8 text-sm text-white/20 text-center">
                  Nenhuma transação registrada.
                </p>
              ) : (
                transactions.slice(0, 20).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.015] transition-colors"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        item.type === 'income' ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/70 truncate">{item.description}</p>
                      <p className="text-[10px] text-white/25 mt-0.5">
                        {getBankAccountLabel(item.bank_account as BankAccountId)} ·{' '}
                        {item.entity ?? 'CPF'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p
                        className={`text-sm font-semibold tabular-nums ${
                          item.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {item.type === 'income' ? '+' : '-'}
                        {fmt(Number(item.amount))}
                      </p>
                      <p className="text-[10px] text-white/20 mt-0.5">
                        {new Date(item.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
        {/* ── Bills ─────────────────────────────────────────────────── */}
        <section>
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.04]">
              <Receipt className="w-4 h-4 text-white/25" />
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/30">
                Contas a Pagar
              </p>
              <div className="ml-auto flex items-center gap-2">
                {overdueBills.length > 0 && (
                  <span className="text-[10px] font-bold text-rose-400 border border-rose-500/30 rounded-full px-2 py-0.5">
                    {overdueBills.length} vencida{overdueBills.length > 1 ? 's' : ''}
                  </span>
                )}
                {dueSoonBills.length > 0 && (
                  <span className="text-[10px] font-bold text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5">
                    {dueSoonBills.length} urgente{dueSoonBills.length > 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-[10px] text-white/20">{unpaidBills.length} pendentes</span>
              </div>
            </div>

            <div className="divide-y divide-white/[0.03]">
              {billsWithStatus.length === 0 ? (
                <p className="px-5 py-8 text-sm text-white/20 text-center">
                  Nenhuma conta cadastrada.
                </p>
              ) : (
                billsWithStatus.map((bill) => {
                  const isOverdue  = bill.status === 'overdue';
                  const isDueSoon  = bill.status === 'due_soon';
                  const isPaid     = bill.status === 'paid';

                  const rowBg = isOverdue
                    ? 'bg-rose-500/[0.04]'
                    : isDueSoon
                    ? 'bg-amber-500/[0.04]'
                    : isPaid
                    ? 'bg-emerald-500/[0.025]'
                    : '';

                  const dotColor = isOverdue
                    ? 'bg-rose-400'
                    : isDueSoon
                    ? 'bg-amber-400'
                    : isPaid
                    ? 'bg-emerald-400'
                    : 'bg-white/20';

                  const amountColor = isOverdue
                    ? 'text-rose-400'
                    : isDueSoon
                    ? 'text-amber-400'
                    : isPaid
                    ? 'text-emerald-400'
                    : 'text-white/50';

                  const dueLabel = isPaid
                    ? `paga em ${new Date(String(bill.paid_at)).toLocaleDateString('pt-BR')}`
                    : bill.diffDays < 0
                    ? `venceu há ${Math.abs(bill.diffDays)} dia${Math.abs(bill.diffDays) > 1 ? 's' : ''}`
                    : bill.diffDays === 0
                    ? 'vence hoje'
                    : `vence em ${bill.diffDays} dia${bill.diffDays > 1 ? 's' : ''}`;

                  return (
                    <div
                      key={bill.id}
                      className={`flex items-center gap-4 px-5 py-3 hover:bg-white/[0.015] transition-colors ${rowBg}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/70 truncate">{bill.description}</p>
                        <p className="text-[10px] text-white/25 mt-0.5">
                          {bill.entity}
                          {bill.bank_account ? ` · ${bill.bank_account}` : ''}
                          {bill.notes ? ` · ${bill.notes}` : ''}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-semibold tabular-nums ${amountColor}`}>
                          -{fmt(Number(bill.amount))}
                        </p>
                        <p className="text-[10px] text-white/20 mt-0.5">{dueLabel}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ── AI Copilot Panel (fixed right) ──────────────────────────── */}
      <aside className="hidden lg:flex fixed right-0 top-0 w-[360px] h-screen flex-col z-20">
        <AiPanel context={financialContext} insights={insights} />
      </aside>
    </div>
  );
}
