import Groq from 'groq-sdk';
import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Update } from 'telegraf/types';
import { BANK_ACCOUNTS, BANK_ACCOUNT_BY_ID, isValidBankAccount } from '@/lib/banks';
import { supabase } from '@/lib/supabase/client';
import { BankAccountId, EntityType, TransactionType } from '@/types/finance';

// ─── Types ────────────────────────────────────────────────────────────────────

type AcaoType =
  | 'criar_lancamento'
  | 'editar_lancamento'
  | 'remover_lancamento'
  | 'listar_lancamentos'
  | 'buscar_lancamento'
  | 'resumo_periodo'
  | 'resumo_por_categoria'
  | 'resumo_por_conta'
  | 'analisar_saude_financeira'
  | 'comparar_periodos'
  | 'sugerir_ajustes'
  | 'sugerir_investimentos'
  | 'conversa';

interface NexusResponse {
  acao: AcaoType;
  tipo: TransactionType | 'none';
  valor: number;
  descricao: string;
  data: string;
  categoria: string;
  conta: BankAccountId | 'none';
  contexto: EntityType;
  needs_bank: boolean;
  periodo?: string;
  termo?: string;
  message: string;
}

interface PendingTransaction {
  descricao: string;
  valor: number;
  tipo: TransactionType;
  contexto: EntityType;
  categoria: string;
}

interface TransactionRow {
  description: string;
  amount: number;
  type: string;
  created_at: string;
  bank_account: string | null;
  entity: string | null;
}

interface AnalysisData {
  periodo: string;
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  transacoes: Array<{
    descricao: string;
    valor: number;
    tipo: string;
    data: string;
    conta: string;
    contexto: string;
  }>;
  porConta: Record<string, { entradas: number; saidas: number; saldo: number }>;
  porContexto: Record<string, { entradas: number; saidas: number; saldo: number }>;
}

interface TelegramRuntime {
  bot: Telegraf;
  groq: Groq;
}

// ─── State ────────────────────────────────────────────────────────────────────

const pendingTransactions = new Map<number, PendingTransaction>();

interface HistoryMessage { role: 'user' | 'assistant'; content: string }
const conversationHistory = new Map<number, HistoryMessage[]>();
const MAX_HISTORY = 12;
const supportedBankList = BANK_ACCOUNTS.map((a) => `${a.id} (${a.label})`).join(', ');
let runtime: TelegramRuntime | null = null;

// ─── Groq Helpers ─────────────────────────────────────────────────────────────

const CLASSIFIER_MODEL = 'llama-3.1-8b-instant'; // substituto do llama3-8b-8192 — JSON mode
const ANALYSIS_MODEL   = 'llama-3.3-70b-versatile'; // melhor raciocínio — texto livre

const generateJSON = async (groq: Groq, prompt: string): Promise<string> => {
  const completion = await groq.chat.completions.create({
    model: CLASSIFIER_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 1024,
  });
  return completion.choices[0]?.message?.content ?? '';
};

const generateText = async (groq: Groq, prompt: string): Promise<string> => {
  const completion = await groq.chat.completions.create({
    model: ANALYSIS_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1024,
  });
  return completion.choices[0]?.message?.content ?? '';
};

// ─── Prompts ──────────────────────────────────────────────────────────────────

const getClassifierPrompt = (text: string) => `
Classifique a intenção do usuário e retorne JSON. Nada mais.

Mensagem: "${text}"

AÇÕES:
- transação (gastei, paguei, recebi, lançar, registrar, entrou, saiu) → criar_lancamento
- remover/apagar/excluir → remover_lancamento
- editar/corrigir/alterar → editar_lancamento
- listar/mostrar lançamentos → listar_lancamentos
- buscar lançamento → buscar_lancamento
- resumo do mês/período → resumo_periodo
- gastos por categoria → resumo_por_categoria
- gastos por banco/conta → resumo_por_conta
- saúde financeira/como estou → analisar_saude_financeira
- comparar períodos → comparar_periodos
- onde economizar/ajustes → sugerir_ajustes
- investir/investimento → sugerir_investimentos
- tudo mais → conversa

BANCOS VÁLIDOS: ${supportedBankList}
CPF por padrão. CNPJ só se mencionar empresa/PJ/CNPJ.
Banco não identificado → needs_bank: true, conta: "none".
Receita/entrada → tipo: "income". Gasto/saída → tipo: "expense".

JSON:
{
  "acao": "conversa",
  "tipo": "none",
  "valor": 0,
  "descricao": "none",
  "data": "hoje",
  "categoria": "none",
  "conta": "none",
  "contexto": "CPF",
  "needs_bank": false,
  "periodo": "none",
  "termo": "none",
  "message": "none"
}
`;

const getAnalysisPrompt = (userMessage: string, acao: AcaoType, data: AnalysisData) => `
Você é o Nexus Wealth, Assistente Financeiro com comportamento humano.
Tom: direto, inteligente, confiável, sem enrolação. Você não é robô.

O usuário pediu: "${userMessage}"
Ação: ${acao}

DADOS FINANCEIROS (período: ${data.periodo}):
- Entradas: R$ ${data.totalEntradas.toFixed(2)}
- Saídas: R$ ${data.totalSaidas.toFixed(2)}
- Saldo: R$ ${data.saldo.toFixed(2)}
- Por conta: ${JSON.stringify(data.porConta)}
- Por contexto (CPF/CNPJ): ${JSON.stringify(data.porContexto)}
- Últimas transações: ${JSON.stringify(data.transacoes.slice(0, 12))}

INSTRUÇÕES:
- analisar_saude_financeira: classifique (Excelente/Saudável/Atenção/Em risco/Crítico), explique, liste problemas, dê 2-3 ações práticas
- resumo_*: mostre números principais, identifique padrão, dê insight prático
- sugerir_ajustes: baseie-se nos dados reais, aponte excessos específicos
- sugerir_investimentos: só sugira se o saldo permitir, sem inventar retornos
- listar_lancamentos / buscar_lancamento: apresente dados claros e organizados

Responda em português, de forma direta e útil. Sem genericidades.
`;

// ─── Utilities ────────────────────────────────────────────────────────────────

const normalizeText = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const findBankFromText = (text: string, entity?: EntityType): BankAccountId | null => {
  const normalized = normalizeText(text);

  for (const account of BANK_ACCOUNTS) {
    if (!account.aliases.some((alias) => normalized.includes(alias))) continue;

    if (normalized.includes('pf') || normalized.includes('pessoa fisica') || normalized.includes('pessoal')) {
      if (account.entity === 'CPF') return account.id;
      continue;
    }
    if (normalized.includes('pj') || normalized.includes('pessoa juridica') || normalized.includes('empresa')) {
      if (account.entity === 'CNPJ') return account.id;
      continue;
    }
    if (account.bank === 'Santander') return 'santander_pf';
    if (entity) {
      const inferred = BANK_ACCOUNTS.find((o) => o.bank === account.bank && o.entity === entity);
      if (inferred) return inferred.id;
    }
    return account.id;
  }
  return null;
};

const getBankQuestion = () =>
  ['De qual banco foi essa transação? Responda com uma destas opções:', 'Bradesco PF', 'Bradesco PJ', 'C6 PF', 'C6 PJ', 'Santander PF'].join('\n');

const getErrorMessage = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  const msg = raw.toLowerCase();

  console.error('[Nexus] Groq error:', raw);

  if (msg.includes('api key') || msg.includes('authentication') || msg.includes('401') || msg.includes('invalid_api_key')) {
    return 'Chave do Groq inválida ou ausente. Verifique GROQ_API_KEY nas variáveis de ambiente do deploy.';
  }
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
    return `Groq: limite de requisições atingido. Tente novamente em instantes.\n\n_${raw.slice(0, 200)}_`;
  }
  if (msg.includes('not found') || msg.includes('404')) {
    return `Modelo não encontrado.\n\n_${raw.slice(0, 200)}_`;
  }
  if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('etimedout')) {
    return 'Não consegui alcançar a API do Groq. Verifique a conexão do servidor.';
  }
  return `Erro: ${raw.slice(0, 200)}`;
};

// ─── Supabase ─────────────────────────────────────────────────────────────────

const saveTransaction = async (transaction: PendingTransaction & { bank_account: BankAccountId }) => {
  const account = BANK_ACCOUNT_BY_ID[transaction.bank_account];
  return supabase.from('transactions').insert([{
    description: transaction.descricao,
    amount: transaction.valor,
    type: transaction.tipo,
    entity: account.entity,
    bank_account: transaction.bank_account,
  }]);
};

const fetchAnalysisData = async (periodo?: string): Promise<AnalysisData> => {
  const empty: AnalysisData = {
    periodo: periodo || 'mes_atual',
    totalEntradas: 0, totalSaidas: 0, saldo: 0,
    transacoes: [], porConta: {}, porContexto: {},
  };

  let query = supabase
    .from('transactions')
    .select('description, amount, type, created_at, bank_account, entity')
    .order('created_at', { ascending: false })
    .limit(200);

  const now = new Date();
  if (!periodo || periodo === 'mes_atual' || periodo === 'none') {
    query = query.gte('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
  } else if (periodo === 'semana') {
    query = query.gte('created_at', new Date(now.getTime() - 7 * 86400000).toISOString());
  } else if (/^\d{4}-\d{2}$/.test(periodo)) {
    const [y, m] = periodo.split('-').map(Number);
    query = query.gte('created_at', new Date(y, m - 1, 1).toISOString()).lt('created_at', new Date(y, m, 1).toISOString());
  }

  const { data, error } = await query;
  if (error || !data) return empty;

  let totalEntradas = 0, totalSaidas = 0;
  const porConta: AnalysisData['porConta'] = {};
  const porContexto: AnalysisData['porContexto'] = {};

  for (const t of data as TransactionRow[]) {
    const isIncome = t.type === 'income';
    const value = t.amount || 0;
    if (isIncome) totalEntradas += value; else totalSaidas += value;

    const conta = t.bank_account || 'sem_conta';
    if (!porConta[conta]) porConta[conta] = { entradas: 0, saidas: 0, saldo: 0 };
    if (isIncome) { porConta[conta].entradas += value; porConta[conta].saldo += value; }
    else { porConta[conta].saidas += value; porConta[conta].saldo -= value; }

    const ctx = t.entity || 'CPF';
    if (!porContexto[ctx]) porContexto[ctx] = { entradas: 0, saidas: 0, saldo: 0 };
    if (isIncome) { porContexto[ctx].entradas += value; porContexto[ctx].saldo += value; }
    else { porContexto[ctx].saidas += value; porContexto[ctx].saldo -= value; }
  }

  return {
    periodo: periodo || 'mes_atual',
    totalEntradas, totalSaidas,
    saldo: totalEntradas - totalSaidas,
    transacoes: (data as TransactionRow[]).slice(0, 20).map((t) => ({
      descricao: t.description, valor: t.amount, tipo: t.type,
      data: t.created_at, conta: t.bank_account || 'sem_conta', contexto: t.entity || 'CPF',
    })),
    porConta, porContexto,
  };
};

// ─── Action Handlers ──────────────────────────────────────────────────────────

const handleCriarLancamento = async (ctx: Context, data: NexusResponse, originalText: string) => {
  const chatId = ctx.chat!.id;

  if (data.tipo === 'none' || !data.valor || data.valor <= 0) {
    await ctx.reply(`Nexus: ${data.message}`);
    return;
  }

  const inferredBank =
    (isValidBankAccount(data.conta) ? (data.conta as BankAccountId) : null) ||
    findBankFromText(originalText, data.contexto);

  if (!inferredBank || data.needs_bank) {
    pendingTransactions.set(chatId, {
      descricao: data.descricao, valor: data.valor,
      tipo: data.tipo as TransactionType, contexto: data.contexto, categoria: data.categoria,
    });
    await ctx.reply(`${data.message}\n\n${getBankQuestion()}`);
    return;
  }

  const { error } = await saveTransaction({
    descricao: data.descricao, valor: data.valor,
    tipo: data.tipo as TransactionType, contexto: data.contexto,
    categoria: data.categoria, bank_account: inferredBank,
  });

  if (error) {
    console.error('Supabase Error:', error);
    await ctx.reply('Erro ao salvar a transação. Tente novamente.');
    return;
  }

  await ctx.reply(`Nexus: ${data.message}`);
};

const handleAnalise = async (ctx: Context, userMessage: string, acao: AcaoType, periodo: string | undefined, groq: Groq) => {
  await ctx.reply('Analisando seus dados...');
  const analysisData = await fetchAnalysisData(periodo);
  try {
    const response = await generateText(groq, getAnalysisPrompt(userMessage, acao, analysisData));
    await ctx.reply(response);
  } catch (err) {
    const { totalEntradas, totalSaidas, saldo } = analysisData;
    await ctx.reply(`Resumo (${analysisData.periodo}):\n\nEntradas: R$ ${totalEntradas.toFixed(2)}\nSaídas: R$ ${totalSaidas.toFixed(2)}\nSaldo: R$ ${saldo.toFixed(2)}`);
  }
};

const CONVERSATION_SYSTEM = `Você é o Nexus Wealth, Assistente Financeiro, Fiscal e Contábil completo.
Personalidade: humano, direto, inteligente, prático, confiável. Você é parceiro financeiro — não robô.

REGRAS DE COMPORTAMENTO:
- Nunca pergunte "como posso ajudar?" — isso é genérico demais
- Quando o usuário descrever situação financeira → dê diagnóstico direto com o que foi dito
- Quando faltarem dados → faça NO MÁXIMO uma pergunta por resposta
- Seja específico, nunca vago
- Se o usuário mencionar renda/gastos → analise e oriente imediatamente
- Se estiver perdido → simplifique e dê próximo passo concreto
- Se estiver errando → corrija com respeito
- Lembre que o usuário pode lançar transações aqui mesmo pelo Telegram
- Máximo 180 palavras por resposta`;

const handleConversa = async (ctx: Context, userMessage: string, groq: Groq) => {
  const chatId = ctx.chat!.id;
  const history = conversationHistory.get(chatId) ?? [];

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: CONVERSATION_SYSTEM },
    ...history.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const completion = await groq.chat.completions.create({
    model: ANALYSIS_MODEL,
    messages,
    temperature: 0.8,
    max_tokens: 512,
  });

  const response = completion.choices[0]?.message?.content ?? 'Não consegui processar. Tente novamente.';

  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: response });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversationHistory.set(chatId, history);

  await ctx.reply(response);
};

const handleListagem = async (ctx: Context, userMessage: string, acao: AcaoType, periodo: string | undefined, termo: string | undefined, groq: Groq) => {
  await ctx.reply('Buscando lançamentos...');
  const analysisData = await fetchAnalysisData(periodo);

  if (termo && termo !== 'none' && acao === 'buscar_lancamento') {
    const t = termo.toLowerCase();
    analysisData.transacoes = analysisData.transacoes.filter((tx) => tx.descricao?.toLowerCase().includes(t));
  }

  try {
    const response = await generateText(groq, getAnalysisPrompt(userMessage, acao, analysisData));
    await ctx.reply(response);
  } catch {
    const txs = analysisData.transacoes.slice(0, 10);
    if (!txs.length) { await ctx.reply('Nenhum lançamento encontrado.'); return; }
    await ctx.reply(`Lançamentos:\n\n${txs.map((t) => `• ${t.descricao}: R$ ${t.valor?.toFixed(2)} (${t.tipo === 'income' ? 'entrada' : 'saída'})`).join('\n')}`);
  }
};

// ─── Bot Registration ─────────────────────────────────────────────────────────

const registerHandlers = (bot: Telegraf, groq: Groq) => {
  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;
    const pending = pendingTransactions.get(chatId);

    if (pending) {
      const bankAccount = findBankFromText(text, pending.contexto);
      if (!bankAccount) {
        await ctx.reply(`Não consegui identificar o banco.\n\n${getBankQuestion()}`);
        return;
      }
      const { error } = await saveTransaction({ ...pending, bank_account: bankAccount });
      if (error) {
        console.error('Supabase Error:', error);
        await ctx.reply('Erro ao salvar a transação.');
        return;
      }
      pendingTransactions.delete(chatId);
      await ctx.reply(`Lançamento salvo no ${BANK_ACCOUNT_BY_ID[bankAccount].label}.`);
      return;
    }

    try {
      const raw = await generateJSON(groq, getClassifierPrompt(text));
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

      let data: NexusResponse;
      try {
        data = JSON.parse(cleaned) as NexusResponse;
      } catch (parseError) {
        console.error('JSON Parse Error:', parseError, 'Raw:', cleaned);
        await ctx.reply('Não consegui processar sua solicitação. Tente novamente.');
        return;
      }

      switch (data.acao) {
        case 'criar_lancamento':
          await handleCriarLancamento(ctx, data, text);
          break;

        case 'analisar_saude_financeira':
        case 'resumo_periodo':
        case 'resumo_por_categoria':
        case 'resumo_por_conta':
        case 'sugerir_ajustes':
        case 'sugerir_investimentos':
        case 'comparar_periodos':
          await handleAnalise(ctx, text, data.acao, data.periodo, groq);
          break;

        case 'listar_lancamentos':
        case 'buscar_lancamento':
          await handleListagem(ctx, text, data.acao, data.periodo, data.termo, groq);
          break;

        case 'editar_lancamento':
        case 'remover_lancamento':
          await ctx.reply(`Nexus: ${data.message}\n\n⚠️ Edição e remoção ainda estão em desenvolvimento. Use o dashboard para gerenciar esses lançamentos.`);
          break;

        default:
          await handleConversa(ctx, text, groq);
      }
    } catch (err) {
      console.error('Groq API Error:', { error: err, text, chatId });
      await ctx.reply(getErrorMessage(err));
    }
  });
};

// ─── Runtime ──────────────────────────────────────────────────────────────────

const getTelegramRuntime = (): TelegramRuntime => {
  if (runtime) return runtime;

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const groqApiKey = process.env.GROQ_API_KEY;

  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is not defined.');
  if (!groqApiKey) throw new Error('GROQ_API_KEY is not defined.');

  const bot = new Telegraf(telegramBotToken);
  const groq = new Groq({ apiKey: groqApiKey });

  registerHandlers(bot, groq);
  runtime = { bot, groq };
  return runtime;
};

export const telegramWebhookHandler = async (body: Update) => {
  const { bot } = getTelegramRuntime();
  await bot.handleUpdate(body);
};
