"use client";

import { Card, Title, AreaChart } from "@tremor/react";
import { Activity } from "lucide-react";

interface TelemetryChartProps {
  chartData: any[];
}

export default function TelemetryChart({ chartData }: TelemetryChartProps) {
  return (
    <Card className="backdrop-blur-md bg-opacity-70 bg-black/60 border border-cyan-500/20 shadow-[0_0_20px_rgba(0,240,255,0.05)] ring-0 rounded-none border-l-4 border-l-cyan-500 h-full">
      <div className="flex items-center gap-3 mb-6 border-b border-cyan-500/20 pb-4">
        <Activity className="text-cyan-400 w-5 h-5 drop-shadow-[0_0_5px_rgba(0,240,255,0.8)]" />
        <Title className="text-cyan-100 font-bold uppercase tracking-widest text-sm drop-shadow-[0_0_5px_rgba(0,240,255,0.4)]">
          Scanner Neural de Fluxo Financeiro
        </Title>
      </div>
      <AreaChart
        className="h-80 mt-4"
        data={chartData}
        index="date"
        categories={["Entradas", "Saídas"]}
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