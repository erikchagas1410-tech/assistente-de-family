import { Card, Text, Metric, Grid } from "@tremor/react";

interface KpiCardsProps {
  balance: number;
  income: number;
  expense: number;
}

export default function KpiCards({ balance, income, expense }: KpiCardsProps) {
  // Lógica de cores baseada em 90%
  const expenseRatio = income > 0 ? expense / income : 0;
  const isOverBudget = expenseRatio > 0.9;
  const cardClass = "backdrop-blur-md bg-opacity-70 bg-black/60 shadow-lg ring-0 rounded-none transform transition-all hover:scale-[1.02] duration-300";

  return (
    <Grid numItemsSm={1} numItemsLg={3} className="gap-6">
      <Card className={`decoration-cyan-400 decoration-2 border border-cyan-500/30 shadow-[0_0_15px_rgba(0,240,255,0.1)] border-l-4 border-l-cyan-400 ${cardClass}`}>
        <Text className="text-cyan-200/70 font-bold uppercase tracking-widest text-xs">Créditos Disponíveis</Text>
        <Metric className="text-cyan-400 font-black drop-shadow-[0_0_10px_rgba(0,240,255,0.6)]">R$ {balance.toFixed(2)}</Metric>
      </Card>

      <Card className={`decoration-yellow-400 decoration-2 border border-yellow-500/30 shadow-[0_0_15px_rgba(250,204,21,0.1)] border-l-4 border-l-yellow-400 ${cardClass}`}>
        <Text className="text-yellow-200/70 font-bold uppercase tracking-widest text-xs">Upload de Fundos</Text>
        <Metric className="text-yellow-400 font-black drop-shadow-[0_0_10px_rgba(250,204,21,0.6)]">R$ {income.toFixed(2)}</Metric>
      </Card>

      <Card className={`decoration-2 ${isOverBudget ? 'decoration-fuchsia-600 shadow-[0_0_25px_rgba(217,70,239,0.3)] border-fuchsia-500/60 bg-fuchsia-950/30' : 'decoration-fuchsia-500 border-fuchsia-500/30 shadow-[0_0_15px_rgba(217,70,239,0.1)]'} border-l-4 border-l-fuchsia-500 ${cardClass}`}>
        <Text className={`${isOverBudget ? 'text-fuchsia-300' : 'text-fuchsia-200/70'} font-bold uppercase tracking-widest text-xs`}>Queima de Créditos</Text>
        <Metric className={`font-black ${isOverBudget ? 'text-fuchsia-500 drop-shadow-[0_0_12px_rgba(217,70,239,0.8)]' : 'text-fuchsia-400 drop-shadow-[0_0_10px_rgba(217,70,239,0.5)]'}`}>
          R$ {expense.toFixed(2)}
        </Metric>
      </Card>
    </Grid>
  );
}