import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';

export async function POST(req: NextRequest) {
  try {
    const { message, context } = await req.json();

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY não configurada.' }, { status: 500 });
    }

    const groq = new Groq({ apiKey: groqApiKey });

    const prompt = `Você é o Nexus Wealth, Assistente Financeiro com comportamento humano.
Tom: direto, inteligente, confiável, sem enrolação. Máximo 120 palavras.

DADOS FINANCEIROS DO USUÁRIO (mês atual):
- Saldo total: R$ ${Number(context.totalBalance ?? 0).toFixed(2)}
- Entradas: R$ ${Number(context.totalIncome ?? 0).toFixed(2)}
- Saídas: R$ ${Number(context.totalExpense ?? 0).toFixed(2)}
- Resultado líquido: R$ ${Number(context.netResult ?? 0).toFixed(2)}
- Projeção fim do mês: R$ ${Number(context.projectedBalance ?? 0).toFixed(2)}
- Saúde financeira: ${context.healthLabel ?? 'N/A'} (${context.healthScore ?? 0}/100)
- Razão despesa/receita: ${Math.round(Number(context.expenseRatio ?? 0) * 100)}%

Usuário: ${message}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 512,
    });

    const response = completion.choices[0]?.message?.content ?? 'Sem resposta.';
    return NextResponse.json({ response });
  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: 'Erro ao processar. Tente novamente.' }, { status: 500 });
  }
}
