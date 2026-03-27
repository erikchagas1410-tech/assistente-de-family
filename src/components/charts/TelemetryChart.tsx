'use client';

import { AreaChart } from '@tremor/react';
import { Activity } from 'lucide-react';

interface TelemetryChartProps {
  chartData: { date: string; Entradas: number; Saidas: number }[];
}

export default function TelemetryChart({ chartData }: TelemetryChartProps) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5 h-full">
      <div className="flex items-center gap-2.5 mb-5">
        <Activity className="h-4 w-4 text-lime-400" />
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/50">
          Fluxo de Caixa
        </p>
      </div>
      <AreaChart
        className="h-64"
        data={chartData}
        index="date"
        categories={['Entradas', 'Saidas']}
        colors={['emerald', 'rose']}
        valueFormatter={(n) =>
          n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        }
        showLegend
        showGridLines={false}
        showAnimation
        curveType="monotone"
      />
    </div>
  );
}
