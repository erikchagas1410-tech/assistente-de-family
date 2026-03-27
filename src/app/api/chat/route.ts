import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: NextRequest) {
  try {
    const { message, context } = await req.json();

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'Chave de API não configurada.' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `Você é o Nexus Wealth, Assistente Financeiro com comportamento humano.
Tom: direto, inteligente, confiável, sem enrolação. Responda em no máximo 120 palavras.

DADOS FINANCEIROS DO USUÁRIO (mês atual):
- Saldo total: R$ ${Number(context.totalBalance ?? 0).toFixed(2)}
- Entradas: R$ ${Number(context.totalIncome ?? 0).toFixed(2)}
- Saídas: R$ ${Number(context.totalExpense ?? 0).toFixed(2)}
- Resultado líquido: R$ ${Number(context.netResult ?? 0).toFixed(2)}
- Projeção fim do mês: R$ ${Number(context.projectedBalance ?? 0).toFixed(2)}
- Saúde financeira: ${context.healthLabel ?? 'N/A'} (${context.healthScore ?? 0}/100)
- Razão despesa/receita: ${Math.round(Number(context.expenseRatio ?? 0) * 100)}%

Usuário: ${message}`;

    const result = await model.generateContent(prompt);
    return NextResponse.json({ response: result.response.text() });
  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: 'Erro ao processar. Tente novamente.' }, { status: 500 });
  }
}
