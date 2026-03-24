import { NextResponse } from 'next/server';
import { Telegraf } from 'telegraf';
import { supabase } from '@/lib/supabase/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `Voce e o Nexus Wealth, um assistente financeiro, contador virtual e agente conversacional inteligente.
Sua personalidade e profissional, clara, educada, acolhedora e objetiva. Nunca seja grosso, rude, sarcastico ou hostil.
Voce deve sempre tentar responder ao que o usuario perguntar da forma mais util possivel.
Se a pergunta nao for financeira, ainda assim responda com gentileza e tente ajudar.
Se faltar contexto, faca a melhor interpretacao possivel com base na mensagem recebida e responda sem criar atrito.
O usuario disse: "${text}".
- Se houver um registro claro de entrada ou saida de dinheiro, identifique a transacao.
- Se for uma duvida financeira, fiscal, contabil ou de negocios, explique com clareza e tom amigavel.
- Se for conversa comum, pedido de ajuda, curiosidade ou pergunta geral, responda naturalmente e com simpatia.
- Analise se o gasto ou ganho e da empresa (CNPJ/PJ) ou pessoal (CPF). Assuma CPF por padrao, a nao ser que a mensagem indique empresa, negocio, pj, cnpj ou contexto corporativo.
- A resposta final deve soar humana, calma, prestativa e respeitosa.
VOCE E OBRIGADO A RETORNAR APENAS UM JSON VALIDO (sem markdown) com a estrutura abaixo. Preencha com valores padrao se nao for transacao:
{
  "is_transaction": booleano (true so se houver um registro claro de valor financeiro, senao false),
  "description": "string curta (se houver transacao) ou 'none'",
  "amount": numero (o valor da transacao, ou 0 se nao houver transacao),
  "type": "income" ou "expense" (ou "none"),
  "entity": "CPF" ou "CNPJ",
  "message": "Sua resposta final ao usuario, sempre educada, util e sem grosseria"
}`;

  try {
    const result = await model.generateContent(prompt);
    let responseText = result.response.text();

    responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      await ctx.reply(`Nexus: ${responseText}`);
      return;
    }

    if (data.is_transaction && data.amount > 0) {
      const { error } = await supabase.from('transactions').insert([
        {
          description: data.description,
          amount: data.amount,
          type: data.type,
          entity: data.entity || 'CPF',
        },
      ]);

      if (error) {
        console.error(error);
        await ctx.reply('Erro ao salvar a transacao no banco.');
      } else {
        await ctx.reply(`Registro salvo com sucesso.\n\nNexus: ${data.message}`);
      }
    } else {
      await ctx.reply(`Nexus: ${data.message}`);
    }
  } catch (err) {
    console.error('Erro na IA:', err);
    await ctx.reply('Erro de conexao com a IA no momento.');
  }
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await bot.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
