import { GoogleGenerativeAI } from '@google/generative-ai';
import { Telegraf } from 'telegraf';
import { Update } from 'telegraf/types';
import { BANK_ACCOUNTS, BANK_ACCOUNT_BY_ID, isValidBankAccount } from '@/lib/banks';
import { supabase } from '@/lib/supabase/client';
import { BankAccountId, EntityType, TransactionType } from '@/types/finance';

interface NexusResponse {
  is_transaction: boolean;
  description: string;
  amount: number;
  type: TransactionType | 'none';
  entity: EntityType;
  bank_account: BankAccountId | 'none';
  needs_bank: boolean;
  message: string;
}

interface PendingTransaction {
  description: string;
  amount: number;
  type: TransactionType;
  entity: EntityType;
}

interface TelegramRuntime {
  bot: Telegraf;
  model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
}

const pendingTransactions = new Map<number, PendingTransaction>();
const supportedBankList = BANK_ACCOUNTS.map((account) => `${account.id} (${account.label})`).join(', ');

let runtime: TelegramRuntime | null = null;

const getNexusPrompt = (text: string) => `Voce e o Nexus Wealth, um assistente financeiro, contador virtual e agente conversacional inteligente.
Sua personalidade e profissional, clara, educada, acolhedora e objetiva.
O usuario disse: "${text}".
- Se houver um registro claro de entrada ou saida de dinheiro, identifique a transacao.
- Se for uma duvida financeira, fiscal, contabil ou de negocios, explique com clareza.
- Se for conversa geral, responda naturalmente.
- Analise se a transacao e PF/CPF ou PJ/CNPJ. Assuma CPF por padrao, a nao ser que a mensagem indique empresa, negocio, pj, cnpj ou contexto corporativo.
- Identifique o banco da transacao apenas entre as opcoes suportadas: ${supportedBankList}.
- Se a mensagem mencionar banco sem indicar PF/PJ, use a entidade da transacao para inferir a conta correta quando existir. Exemplo: "Bradesco" com CNPJ vira "bradesco_pj".
- Santander existe apenas como santander_pf.
- Se houver transacao, mas o banco nao estiver claro, retorne "needs_bank": true e "bank_account": "none".
- Se houver lancamento positivo, trate como "income" e preserve o banco correto para esse banco especifico.
VOCE E OBRIGADO A RETORNAR APENAS UM JSON VALIDO (sem markdown) com a estrutura abaixo:
{
  "is_transaction": boolean,
  "description": "string curta ou 'none'",
  "amount": number,
  "type": "income" | "expense" | "none",
  "entity": "CPF" | "CNPJ",
  "bank_account": "bradesco_pf" | "bradesco_pj" | "c6_pf" | "c6_pj" | "santander_pf" | "none",
  "needs_bank": boolean,
  "message": "resposta final ao usuario"
}`;

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const findBankFromText = (text: string, entity?: EntityType): BankAccountId | null => {
  const normalized = normalizeText(text);

  for (const account of BANK_ACCOUNTS) {
    const matchedAlias = account.aliases.some((alias) => normalized.includes(alias));
    if (!matchedAlias) continue;

    if (
      normalized.includes('pf') ||
      normalized.includes('pessoa fisica') ||
      normalized.includes('pessoal')
    ) {
      if (account.entity === 'CPF') return account.id;
      continue;
    }

    if (
      normalized.includes('pj') ||
      normalized.includes('pessoa juridica') ||
      normalized.includes('empresa')
    ) {
      if (account.entity === 'CNPJ') return account.id;
      continue;
    }

    if (account.bank === 'Santander') return 'santander_pf';

    if (entity) {
      const inferred = BANK_ACCOUNTS.find(
        (option) => option.bank === account.bank && option.entity === entity,
      );
      if (inferred) return inferred.id;
    }

    return account.id;
  }

  return null;
};

const getBankQuestion = () =>
  [
    'De qual banco foi essa transacao? Responda com uma destas opcoes:',
    'Bradesco PF',
    'Bradesco PJ',
    'C6 PF',
    'C6 PJ',
    'Santander PF',
  ].join('\n');

const saveTransaction = async (
  transaction: PendingTransaction & { bank_account: BankAccountId },
) => {
  const account = BANK_ACCOUNT_BY_ID[transaction.bank_account];

  return supabase.from('transactions').insert([
    {
      description: transaction.description,
      amount: transaction.amount,
      type: transaction.type,
      entity: account.entity,
      bank_account: transaction.bank_account,
    },
  ]);
};

const getGeminiUserMessage = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('api key')) {
      return 'A chave do Gemini configurada no deploy parece invalida. Verifique a GEMINI_API_KEY na Vercel.';
    }

    if (
      message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('resource has been exhausted') ||
      message.includes('429')
    ) {
      return 'O Gemini atingiu limite de uso no momento. Tente novamente em alguns instantes.';
    }

    if (message.includes('fetch failed')) {
      return 'Nao consegui alcancar a API do Gemini a partir do servidor.';
    }

    if (
      message.includes('candidate') ||
      message.includes('response') ||
      message.includes('json') ||
      message.includes('parse')
    ) {
      return 'O Gemini respondeu em um formato que nao consegui interpretar. Tente reformular a mensagem.';
    }

    return `Erro no Gemini: ${error.message}`;
  }

  return 'Estou com problemas para me conectar a inteligencia artificial no momento. Tente novamente mais tarde.';
};

const registerHandlers = (bot: Telegraf, model: TelegramRuntime['model']) => {
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;
    const pending = pendingTransactions.get(chatId);

    if (pending) {
      const bankAccount = findBankFromText(text, pending.entity);

      if (!bankAccount) {
        await ctx.reply(`Nao consegui identificar o banco.\n\n${getBankQuestion()}`);
        return;
      }

      const { error } = await saveTransaction({ ...pending, bank_account: bankAccount });

      if (error) {
        console.error('Supabase Error:', error);
        await ctx.reply(
          'Ocorreu um erro ao salvar sua transacao. Verifique se a coluna bank_account existe na tabela transactions.',
        );
        return;
      }

      pendingTransactions.delete(chatId);
      await ctx.reply(
        `Registro salvo com sucesso no banco ${BANK_ACCOUNT_BY_ID[bankAccount].label}.`,
      );
      return;
    }

    const prompt = getNexusPrompt(text);

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

      let data: NexusResponse;
      try {
        data = JSON.parse(cleanedText) as NexusResponse;
      } catch (parseError) {
        console.error('JSON Parse Error:', parseError, 'Raw text:', cleanedText);
        await ctx.reply('Nao consegui processar sua solicitacao. Tente novamente.');
        return;
      }

      if (data.is_transaction && data.amount > 0 && data.type !== 'none') {
        const inferredBank =
          (isValidBankAccount(data.bank_account) ? data.bank_account : null) ||
          findBankFromText(text, data.entity);

        if (!inferredBank || data.needs_bank) {
          pendingTransactions.set(chatId, {
            description: data.description,
            amount: data.amount,
            type: data.type,
            entity: data.entity || 'CPF',
          });

          await ctx.reply(`${data.message}\n\n${getBankQuestion()}`);
          return;
        }

        const { error } = await saveTransaction({
          description: data.description,
          amount: data.amount,
          type: data.type,
          entity: data.entity || 'CPF',
          bank_account: inferredBank,
        });

        if (error) {
          console.error('Supabase Error:', error);
          await ctx.reply(
            'Ocorreu um erro ao salvar sua transacao. Verifique se a coluna bank_account existe na tabela transactions.',
          );
          return;
        }

        await ctx.reply(
          `Registro salvo com sucesso em ${BANK_ACCOUNT_BY_ID[inferredBank].label}.\n\nNexus: ${data.message}`,
        );
        return;
      }

      await ctx.reply(`Nexus: ${data.message}`);
    } catch (err) {
      console.error('Gemini API Error:', {
        error: err,
        text,
        chatId,
      });
      await ctx.reply(getGeminiUserMessage(err));
    }
  });
};

const getTelegramRuntime = (): TelegramRuntime => {
  if (runtime) return runtime;

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not defined in environment variables.');
  }

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not defined in environment variables.');
  }

  const bot = new Telegraf(telegramBotToken);
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  registerHandlers(bot, model);
  runtime = { bot, model };
  return runtime;
};

export const telegramWebhookHandler = async (body: Update) => {
  const { bot } = getTelegramRuntime();
  await bot.handleUpdate(body);
};
