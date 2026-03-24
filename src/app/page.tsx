import KpiCards from "@/components/charts/KpiCards";
import TelemetryChart from "@/components/charts/TelemetryChart";
import CategoryChart from "@/components/charts/CategoryChart";
import { supabase } from "@/lib/supabase/client";
import { Transaction } from "@/types/finance";
import { Card, Title, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from "@tremor/react";
import { AlertTriangle, Terminal } from "lucide-react";

export const dynamic = 'force-dynamic'; // Desabilita o cache (Garante dados em realtime)
export const revalidate = 0; // Desabilita agressivamente o cache de rotas do Next.js

export default async function Home() {
  // Buscar transações (dados reais) do Supabase
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Erro ao buscar dados do Supabase:", error);
  }

  // Calculando saldos e métricas
  let incomeCpf = 0, expenseCpf = 0;
  let incomeCnpj = 0, expenseCnpj = 0;

  if (transactions) {
    transactions.forEach((t: Transaction) => {
      if (t.entity === 'CNPJ') {
        if (t.type === 'income') incomeCnpj += Number(t.amount);
        if (t.type === 'expense') expenseCnpj += Number(t.amount);
      } else {
        if (t.type === 'income') incomeCpf += Number(t.amount);
        if (t.type === 'expense') expenseCpf += Number(t.amount);
      }
    });
  }

  const balanceCpf = incomeCpf - expenseCpf;
  const balanceCnpj = incomeCnpj - expenseCnpj;

  // Processamento de dados para o Gráfico de Telemetria (Linha do Tempo)
  const chartData = (transactions || []).reduce((acc: any[], t: Transaction) => {
    const date = new Date(t.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const existing = acc.find((item) => item.date === date);
    if (existing) {
      if (t.type === 'income') existing.Entradas += Number(t.amount);
      if (t.type === 'expense') existing.Saídas += Number(t.amount);
    } else {
      acc.push({
        date,
        Entradas: t.type === 'income' ? Number(t.amount) : 0,
        Saídas: t.type === 'expense' ? Number(t.amount) : 0,
      });
    }
    return acc;
  }, []).reverse(); // Inverte para ficar em ordem cronológica (da esquerda pra direita)

  // Lógica do Sistema de Alerta (Soma total dos gastos > 85% da renda total)
  const totalIncome = incomeCpf + incomeCnpj;
  const totalExpense = expenseCpf + expenseCnpj;
  const isCritical = totalIncome > 0 && (totalExpense / totalIncome) > 0.85;

  // Processamento do Gráfico Circular (Agrupando maiores despesas)
  const expensesByCategory = (transactions || [])
    .filter((t: Transaction) => t.type === 'expense')
    .reduce((acc: any[], t: Transaction) => {
      const categoryName = t.description; 
      const existing = acc.find((item: any) => item.name === categoryName);
      if (existing) {
        existing.value += Number(t.amount);
      } else {
        acc.push({ name: categoryName, value: Number(t.amount) });
      }
      return acc;
    }, [])
    .sort((a: any, b: any) => b.value - a.value)
    .slice(0, 5); // Pega apenas o Top 5 maiores vazamentos de caixa

  return (
    <main className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-8">
      {/* Cabeçalho Estilo HUD */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 border-b border-white/5 pb-6">
        <div>
          <h1 className="text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-500 to-fuchsia-500 drop-shadow-[0_0_15px_rgba(0,240,255,0.4)]">NEXUS CHROME</h1>
          <p className="text-yellow-400/80 uppercase tracking-[0.3em] text-xs font-bold mt-2 flex items-center gap-2">
            <Terminal className="w-4 h-4" /> Constructo Financeiro Ativo
          </p>
        </div>
        <div className="mt-4 md:mt-0 px-4 py-2 bg-black/60 border border-cyan-500/40 rounded-none backdrop-blur-md flex items-center gap-3 shadow-[0_0_15px_rgba(0,240,255,0.2)]">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-sm bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-sm h-3 w-3 bg-cyan-500 shadow-[0_0_8px_rgba(0,240,255,1)]"></span>
            </span>
            <span className="text-cyan-400 text-xs font-bold uppercase tracking-widest">Uplink Estabelecido</span>
        </div>
      </div>

      {/* Alerta Crítico Neon */}
      {isCritical && (
        <div className="mb-8 bg-fuchsia-950/40 border border-fuchsia-500/50 shadow-[0_0_30px_rgba(217,70,239,0.3)] p-6 rounded-none flex items-start gap-4 backdrop-blur-md relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-fuchsia-500 shadow-[0_0_15px_rgba(217,70,239,1)]"></div>
          <AlertTriangle className="text-fuchsia-500 w-8 h-8 flex-shrink-0 animate-pulse drop-shadow-[0_0_10px_rgba(217,70,239,0.8)]" />
          <div>
            <h3 className="text-fuchsia-500 font-black uppercase tracking-widest text-lg drop-shadow-[0_0_8px_rgba(217,70,239,0.8)]">Aviso: Sobrecarga de Sistema (High Tech, Low Cash)</h3>
            <p className="text-fuchsia-300/80 text-sm mt-1 font-medium tracking-wide">Os níveis de cyber-implantes (despesas) ultrapassaram 85% dos seus créditos. Risco iminente de falência no submundo. Reduza o consumo.</p>
          </div>
        </div>
      )}

      {/* Painéis de KPI em Grid Lado a Lado (Em telas grandes) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h2 className="text-sm font-black text-cyan-500/80 tracking-[0.3em] uppercase border-b border-cyan-500/20 pb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-cyan-500/80 shadow-[0_0_5px_rgba(0,240,255,0.8)]"></span>
            Patrimônio Físico (CPF)
          </h2>
          <KpiCards balance={balanceCpf} income={incomeCpf} expense={expenseCpf} />
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-black text-purple-400/80 tracking-[0.3em] uppercase border-b border-purple-500/20 pb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-purple-500/80 shadow-[0_0_5px_rgba(168,85,247,0.8)]"></span>
            Caixa Corporativo (CNPJ)
          </h2>
          <KpiCards balance={balanceCnpj} income={incomeCnpj} expense={expenseCnpj} />
        </div>
      </div>

      {/* Gráficos de Inteligência em Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        <div className="lg:col-span-2">
          <TelemetryChart chartData={chartData} />
        </div>
        <div className="lg:col-span-1">
          <CategoryChart data={expensesByCategory} />
        </div>
      </div>

      {/* Tabela de Transações */}
      <Card className="backdrop-blur-md bg-opacity-70 bg-black/60 border border-fuchsia-500/20 shadow-[0_0_20px_rgba(217,70,239,0.05)] ring-0 mt-8 rounded-none border-l-4 border-l-fuchsia-500">
        <Title className="text-fuchsia-100 font-bold uppercase tracking-widest text-sm flex items-center gap-3 border-b border-fuchsia-500/20 pb-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-sm bg-fuchsia-400 opacity-75"></span>
            <span className="relative inline-flex rounded-sm h-2 w-2 bg-fuchsia-500 shadow-[0_0_5px_rgba(217,70,239,1)]"></span>
          </span>
          Registro Neural de Transações
        </Title>
        <Table className="mt-5">
          <TableHead>
            <TableRow>
              <TableHeaderCell className="text-slate-400">Descrição</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Valor</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Entidade</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Tipo</TableHeaderCell>
              <TableHeaderCell className="text-slate-400">Data</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions?.map((item: Transaction) => (
              <TableRow key={item.id}>
                <TableCell className="text-slate-300">{item.description}</TableCell>
                <TableCell className="text-slate-300">R$ {Number(item.amount).toFixed(2)}</TableCell>
                <TableCell>
                  <Badge color={item.entity === 'CNPJ' ? 'purple' : 'cyan'} className="uppercase font-bold tracking-wider text-[10px] rounded-none border border-current">
                    {item.entity || 'CPF'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge color={item.type === 'income' ? 'yellow' : 'fuchsia'} className="uppercase font-bold tracking-wider text-[10px] rounded-none border border-current">
                    {item.type === 'income' ? 'Entrada' : 'Saída'}
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