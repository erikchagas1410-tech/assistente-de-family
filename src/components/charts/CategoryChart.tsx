'use client';

import { DonutChart } from '@tremor/react';
import { PieChart } from 'lucide-react';

interface CategoryChartProps {
  data: { name: string; value: number }[];
}

export default function CategoryChart({ data }: CategoryChartProps) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-5 h-full flex flex-col">
      <div className="flex items-center gap-2.5 mb-5">
        <PieChart className="h-4 w-4 text-lime-400" />
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/50">
          Por Categoria
        </p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {data.length > 0 ? (
          <DonutChart
            className="h-52"
            data={data}
            category="value"
            index="name"
            valueFormatter={(n) =>
              n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            }
            colors={['lime', 'emerald', 'amber', 'rose', 'violet']}
            showAnimation
          />
        ) : (
          <p className="text-[11px] text-white/20">Sem despesas registradas</p>
        )}
      </div>
    </div>
  );
}
