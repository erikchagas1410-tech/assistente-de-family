import { Telegraf } from 'telegraf';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '@/lib/supabase/client';

// Define the response structure from the AI
interface NexusResponse {
  is_transaction: boolean;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'none';
  entity: 'CPF' | 'CNPJ';
  message: string;
}

// Function to generate the AI prompt
const getNexusPrompt = (text: string) => `Voce e o Nexus Wealth, um assistente financeiro, contador virtual e agente conversacional inteligente.
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

// Validate environment variables at initialization
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!telegramBotToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in environment variables.');
}
if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY is not defined in environment variables.');
}

// Initialize clients
const bot = new Telegraf(telegramBotToken);
const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash', // Corrected model name
  generationConfig: { responseMimeType: 'application/json' },
});

// Define the main text handler logic
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const prompt = getNexusPrompt(text);

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let data: NexusResponse;
    try {
      data = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError, 'Raw text:', cleanedText);
      await ctx.reply('Desculpe, não consegui processar sua solicitação. Poderia tentar novamente?');
      return;
    }

    if (data.is_transaction && data.amount > 0) {
      const { error } = await supabase.from('transactions').insert([{ description: data.description, amount: data.amount, type: data.type, entity: data.entity || 'CPF' }]);

      if (error) {
        console.error('Supabase Error:', error);
        await ctx.reply('Ocorreu um erro ao salvar sua transação. Por favor, tente novamente.');
      } else {
        await ctx.reply(`Registro salvo com sucesso!\n\nNexus: ${data.message}`);
      }
    } else {
      await ctx.reply(`Nexus: ${data.message}`);
    }
  } catch (err) {
    console.error('Gemini AI Error:', err);
    await ctx.reply('Desculpe, estou com problemas para me conectar à inteligência artificial no momento. Tente novamente mais tarde.');
  }
});

export const telegramWebhookHandler = async (body: any) => {
  await bot.handleUpdate(body);
};