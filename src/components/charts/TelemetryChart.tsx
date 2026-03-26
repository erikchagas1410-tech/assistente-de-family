"use client";

import { AreaChart, Card, Title } from "@tremor/react";
import { Activity } from "lucide-react";

interface TelemetryChartProps {
  chartData: any[];
}

export default function TelemetryChart({ chartData }: TelemetryChartProps) {
  return (
    <Card className="backdrop-blur-md bg-opacity-70 bg-black/60 border border-cyan-500/20 shadow-[0_0_20px_rgba(0,240,255,0.05)] ring-0 rounded-none border-l-4 border-l-cyan-500 h-full">
      <div className="mb-6 flex items-center gap-3 border-b border-cyan-500/20 pb-4">
        <Activity className="h-5 w-5 text-cyan-400 drop-shadow-[0_0_5px_rgba(0,240,255,0.8)]" />
        <Title className="text-sm font-bold uppercase tracking-widest text-cyan-100 drop-shadow-[0_0_5px_rgba(0,240,255,0.4)]">
          Scanner Neural de Fluxo Financeiro
        </Title>
      </div>
      <AreaChart
        className="mt-4 h-80"
        data={chartData}
        index="date"
        categories={["Entradas", "Saidas"]}
        colors={["yellow", "fuchsia"]}
        valueFormatter={(number) => `R$ ${number.toFixed(2)}`}
        showLegend={true}
        showGridLines={false}
        showAnimation={true}
        curveType="monotone"
      />
    </Card>
  );
}
