'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, ChevronRight } from 'lucide-react';

export interface FinancialContext {
  totalBalance: number;
  totalIncome: number;
  totalExpense: number;
  netResult: number;
  projectedBalance: number;
  healthScore: number;
  healthLabel: string;
  expenseRatio: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AiPanelProps {
  context: FinancialContext;
  insights: string[];
}

const QUICK_ACTIONS = [
  { label: 'Analisar minhas finanças', message: 'Como está minha saúde financeira? Dê um diagnóstico completo.' },
  { label: 'Resumo do mês', message: 'Me dá um resumo financeiro detalhado do mês atual.' },
  { label: 'Onde posso economizar', message: 'Com base nos meus gastos, onde posso economizar mais?' },
];

function getHealthColor(score: number): string {
  if (score >= 80) return '#a3e635';
  if (score >= 60) return '#34d399';
  if (score >= 40) return '#fbbf24';
  if (score >= 20) return '#f97316';
  return '#f43f5e';
}

function getHealthTextClass(score: number): string {
  if (score >= 80) return 'text-lime-400';
  if (score >= 60) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  if (score >= 20) return 'text-orange-400';
  return 'text-rose-400';
}

export default function AiPanel({ context, insights }: AiPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const r = 38;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - context.healthScore / 100);
  const ringColor = getHealthColor(context.healthScore);
  const labelColor = getHealthTextClass(context.healthScore);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response ?? data.error ?? 'Sem resposta.' },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Não foi possível conectar ao Nexus. Tente novamente.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#07070a] border-l border-white/[0.05]">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-6 pb-4 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime-400" />
          </span>
          <span className="text-[11px] font-black uppercase tracking-[0.35em] text-lime-400">
            Nexus AI
          </span>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/20">
          Copiloto Financeiro
        </p>
      </div>

      {/* Health Score */}
      <div className="flex-shrink-0 px-5 py-5 border-b border-white/[0.04]">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/25 mb-4">
          Saúde Financeira
        </p>
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0">
            <svg width="80" height="80" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="7"
              />
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={ringColor}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 50 50)"
                style={{ filter: `drop-shadow(0 0 5px ${ringColor}88)` }}
              />
              <text
                x="50"
                y="56"
                textAnchor="middle"
                fill={ringColor}
                fontSize="20"
                fontWeight="900"
                fontFamily="monospace"
              >
                {context.healthScore}
              </text>
            </svg>
          </div>
          <div>
            <p className={`text-xl font-black ${labelColor}`}>{context.healthLabel}</p>
            <p className="text-[11px] text-white/35 mt-1 leading-relaxed">
              {context.expenseRatio > 0
                ? `${Math.round(context.expenseRatio * 100)}% das entradas comprometidas`
                : 'Sem transações no período'}
            </p>
          </div>
        </div>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="flex-shrink-0 px-5 py-4 border-b border-white/[0.04]">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/25 mb-3">
            Insights
          </p>
          <div className="space-y-2.5">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2">
                <ChevronRight className="w-3 h-3 text-lime-400/60 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-white/50 leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-white/[0.04]">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/25 mb-3">
          Ações Rápidas
        </p>
        <div className="space-y-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => sendMessage(action.message)}
              disabled={loading}
              className="w-full text-left text-[11px] px-3 py-2 rounded border border-lime-500/15 text-lime-400/70 hover:border-lime-500/35 hover:text-lime-300 hover:bg-lime-500/[0.04] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-h-0 px-5 pt-4">
        <p className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.25em] text-white/25 mb-3">
          Chat
        </p>

        <div className="flex-1 overflow-y-auto space-y-3 pr-0.5 min-h-0">
          {messages.length === 0 && (
            <p className="text-[11px] text-white/20 text-center pt-6 leading-relaxed">
              Pergunte qualquer coisa sobre suas finanças ou use as ações rápidas acima.
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] text-[11px] px-3 py-2 rounded-lg leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-lime-500/15 text-lime-100 rounded-br-sm border border-lime-500/20'
                    : 'bg-white/[0.04] text-white/60 rounded-bl-sm border border-white/[0.06]'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/[0.04] border border-white/[0.06] rounded-lg rounded-bl-sm px-3 py-2.5">
                <div className="flex gap-1 items-center">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="w-1.5 h-1.5 rounded-full bg-lime-400/60 animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="flex-shrink-0 pb-5 pt-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte ao Nexus..."
              className="flex-1 text-[11px] bg-white/[0.03] border border-white/[0.07] rounded-lg px-3 py-2 text-white/70 placeholder-white/20 focus:outline-none focus:border-lime-500/35 focus:bg-white/[0.05] transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-lime-500/15 hover:bg-lime-500/25 border border-lime-500/25 hover:border-lime-500/45 rounded-lg text-lime-400 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
