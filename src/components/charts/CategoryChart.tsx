"use client";

import { Card, Title, DonutChart } from "@tremor/react";
import { PieChart } from "lucide-react";

interface CategoryChartProps {
  data: any[];
}

export default function CategoryChart({ data }: CategoryChartProps) {
  return (
    <Card className="backdrop-blur-md bg-opacity-70 bg-black/60 border border-fuchsia-500/20 shadow-[0_0_20px_rgba(217,70,239,0.05)] ring-0 rounded-none border-l-4 border-l-fuchsia-500 h-full flex flex-col">
      <div className="flex items-center gap-3 mb-6 border-b border-fuchsia-500/20 pb-4">
        <PieChart className="text-fuchsia-400 w-5 h-5 drop-shadow-[0_0_5px_rgba(217,70,239,0.8)]" />
        <Title className="text-fuchsia-100 font-bold uppercase tracking-widest text-sm drop-shadow-[0_0_5px_rgba(217,70,239,0.4)]">
          Distribuição de Carga
        </Title>
      </div>
      <div className="flex-1 flex items-center justify-center mt-4">
        <DonutChart
          className="h-60"
          data={data}
          category="value"
          index="name"
          valueFormatter={(number) => `R$ ${number.toFixed(2)}`}
          colors={["fuchsia", "cyan", "yellow", "purple", "emerald", "rose"]}
          showAnimation={true}
        />
      </div>
    </Card>
  );
}