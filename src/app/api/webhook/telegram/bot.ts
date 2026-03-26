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
  openRouterApiKey: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

class OpenRouterRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenRouterRequestError';
    this.status = status;
  }
}

const pendingTransactions = new Map<number, PendingTransaction>();
const supportedBankList = BANK_ACCOUNTS.map((account) => `${account.id} (${account.label})`).join(', ');
const openRouterModels = [
  'qwen/qwen3-4b:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'qwen/qwen3-coder:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'minimax/minimax-m2.5:free',
];

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
VOCE E OBRIGADO A RETORNAR APENAS UM JSON VALIDO com a estrutura abaixo:
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

const getProviderUserMessage = (error: unknown) => {
  if (error instanceof OpenRouterRequestError) {
    if (error.status === 401) {
      return 'A chave da OpenRouter configurada no deploy parece invalida. Verifique a OPENROUTER_API_KEY na Vercel.';
    }

    if (error.status === 429) {
      return 'Os modelos gratuitos da OpenRouter estao com limite de uso no momento. Tente novamente em alguns instantes.';
    }

    if (error.status === 400) {
      return 'A OpenRouter rejeitou a requisicao enviada pelo bot. Revise a configuracao do modelo e da chave.';
    }

    return `A OpenRouter retornou erro ${error.status ?? 'desconhecido'}.`;
  }

  if (error instanceof Error) {
    if (error.message.includes('fetch failed')) {
      return 'Nao consegui alcancar a API da OpenRouter a partir do servidor.';
    }

    if (error.message.includes('empty response')) {
      return 'A OpenRouter respondeu vazia e nao consegui interpretar a resposta.';
    }
  }

  return 'Estou com problemas para me conectar a inteligencia artificial no momento. Tente novamente mais tarde.';
};

const extractJsonObject = (content: string) => {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as NexusResponse;
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('OpenRouter returned a non-JSON response.');
    }

    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as NexusResponse;
  }
};

const getOpenRouterResponse = async (
  prompt: string,
  openRouterApiKey: string,
): Promise<NexusResponse> => {
  let lastError: Error | null = null;

  for (const model of openRouterModels) {
    for (const useJsonMode of [true, false]) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterApiKey}`,
          'HTTP-Referer': 'https://assistente-de-family.vercel.app',
          'X-Title': 'Assistente de Family',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      const body = (await response.json()) as OpenRouterChatResponse;

      if (!response.ok) {
        const message =
          body.error?.message || `OpenRouter request failed with status ${response.status}`;
        const error = new OpenRouterRequestError(message, response.status);

        if (
          response.status === 400 &&
          useJsonMode &&
          /json mode|response_format|structured/i.test(message)
        ) {
          lastError = error;
          continue;
        }

        if (response.status === 404 || response.status === 429) {
          lastError = error;
          break;
        }

        throw error;
      }

      const content = body.choices?.[0]?.message?.content?.trim();

      if (!content) {
        lastError = new Error(`OpenRouter returned an empty response for model ${model}.`);
        break;
      }

      return extractJsonObject(content);
    }
  }

  throw lastError || new Error('No OpenRouter models returned a valid response.');
};

const registerHandlers = (bot: Telegraf, openRouterApiKey: string) => {
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
      const data = await getOpenRouterResponse(prompt, openRouterApiKey);

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
      console.error('OpenRouter API Error:', err);
      await ctx.reply(getProviderUserMessage(err));
    }
  });
};

const getTelegramRuntime = (): TelegramRuntime => {
  if (runtime) return runtime;

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;

  if (!telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not defined in environment variables.');
  }

  if (!openRouterApiKey) {
    throw new Error('OPENROUTER_API_KEY is not defined in environment variables.');
  }

  const bot = new Telegraf(telegramBotToken);
  registerHandlers(bot, openRouterApiKey);
  runtime = { bot, openRouterApiKey };
  return runtime;
};

export const telegramWebhookHandler = async (body: Update) => {
  const { bot } = getTelegramRuntime();
  await bot.handleUpdate(body);
};
