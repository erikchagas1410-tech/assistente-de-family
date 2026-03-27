import { GoogleGenerativeAI } from '@google/generative-ai';
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
  porCategoria: Record<string, number>;
  porConta: Record<string, { entradas: number; saidas: number; saldo: number }>;
  porContexto: Record<string, { entradas: number; saidas: number; saldo: number }>;
}

interface TelegramRuntime {
  bot: Telegraf;
  classifierModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  analysisModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
}

// ─── State ────────────────────────────────────────────────────────────────────

const pendingTransactions = new Map<number, PendingTransaction>();
const supportedBankList = BANK_ACCOUNTS.map((a) => `${a.id} (${a.label})`).join(', ');
let runtime: TelegramRuntime | null = null;

// ─── Prompts ──────────────────────────────────────────────────────────────────

const getClassifierPrompt = (text: string) => `
Você é o Nexus Wealth, um Assistente Financeiro, Fiscal e Contábil completo com comportamento humano.

Sua personalidade: profissional, direta, inteligente, confiável, sem enrolação.
Você age como parceiro financeiro, não como robô.

O usuário disse: "${text}"

FLUXO DE ANÁLISE:
1. O usuário quer conversar, lançar, entender ou analisar?
2. É PF (CPF), PJ (CNPJ) ou misto?
3. Há dados financeiros ou intenção operacional?

MAPEAMENTO DE INTENÇÃO → AÇÃO:
- "lança", "adiciona", "registra", "gastei", "paguei", "recebi", "entrou", "saiu" → criar_lancamento
- "remove", "apaga", "exclui", "cancela" → remover_lancamento
- "corrige", "edita", "altera", "muda" → editar_lancamento
- "lista", "mostra", "quero ver", "me mostra", "me lista" → listar_lancamentos
- "busca", "encontra", "procura" → buscar_lancamento
- "como foi esse mês", "resumo do período", "resumo do mês", "esse mês" → resumo_periodo
- "onde gasto mais", "por categoria", "categorias" → resumo_por_categoria
- "por banco", "por conta", "contas" → resumo_por_conta
- "como estou financeiramente", "saúde financeira", "situação", "estou bem?" → analisar_saude_financeira
- "comparar", "mês anterior", "comparação" → comparar_periodos
- "o que ajustar", "onde economizar", "cortar gastos" → sugerir_ajustes
- "posso investir", "onde investir", "investimento" → sugerir_investimentos
- qualquer dúvida, pergunta, conversa → conversa

REGRAS PARA LANÇAMENTOS:
- Bancos suportados APENAS: ${supportedBankList}
- Santander existe apenas como santander_pf
- Assuma CPF por padrão, salvo menção a empresa, negócio, PJ ou CNPJ
- Se o banco não estiver claro, retorne needs_bank: true e conta: "none"
- Se houver lançamento positivo → tipo: "income"
- Se houver lançamento de gasto/pagamento → tipo: "expense"

REGRAS GERAIS:
- Nunca misture PF e PJ sem avisar
- Nunca invente regra fiscal ou valor
- Se faltar informação essencial, peça apenas o necessário no campo "message"
- Quando houver risco financeiro, avise no campo "message"

RETORNE APENAS JSON VÁLIDO (sem markdown, sem código):
{
  "acao": "criar_lancamento | editar_lancamento | remover_lancamento | listar_lancamentos | buscar_lancamento | resumo_periodo | resumo_por_categoria | resumo_por_conta | analisar_saude_financeira | comparar_periodos | sugerir_ajustes | sugerir_investimentos | conversa",
  "tipo": "income | expense | none",
  "valor": 0,
  "descricao": "descrição curta ou none",
  "data": "YYYY-MM-DD ou hoje",
  "categoria": "nome da categoria ou none",
  "conta": "bradesco_pf | bradesco_pj | c6_pf | c6_pj | santander_pf | none",
  "contexto": "CPF | CNPJ",
  "needs_bank": false,
  "periodo": "mes_atual | semana | YYYY-MM | none",
  "termo": "termo de busca ou none",
  "message": "sua resposta direta ao usuário em português"
}
`;

const getAnalysisPrompt = (userMessage: string, acao: AcaoType, data: AnalysisData) => `
Você é o Nexus Wealth, Assistente Financeiro completo com comportamento humano.
Tom: direto, inteligente, confiável, sem enrolação. Você não é robô.

O usuário pediu: "${userMessage}"
Ação: ${acao}

DADOS FINANCEIROS (período: ${data.periodo}):
- Total de entradas: R$ ${data.totalEntradas.toFixed(2)}
- Total de saídas: R$ ${data.totalSaidas.toFixed(2)}
- Saldo: R$ ${data.saldo.toFixed(2)}
- Transações recentes: ${JSON.stringify(data.transacoes.slice(0, 15), null, 2)}
- Por conta: ${JSON.stringify(data.porConta, null, 2)}
- Por contexto (CPF/CNPJ): ${JSON.stringify(data.porContexto, null, 2)}

INSTRUÇÕES POR AÇÃO:

analisar_saude_financeira:
→ Classifique a saúde: Excelente / Saudável / Atenção / Em risco / Crítica
→ Explique por que chegou a essa classificação
→ Liste os principais problemas encontrados
→ Dê 2-3 ações práticas e imediatas
→ Alerte se: gastos excessivos em categoria, risco de caixa, despesas fixas altas, dependência de única renda, mistura PF/PJ

resumo_periodo / resumo_por_categoria / resumo_por_conta:
→ Mostre os números principais com clareza
→ Identifique a categoria ou conta com maior gasto
→ Aponte padrão de consumo relevante
→ Dê um insight prático

sugerir_ajustes:
→ Baseie-se nos dados reais, não em genericidades
→ Aponte categorias ou contas onde há excessos
→ Sugira cortes específicos e viáveis

sugerir_investimentos:
→ Só sugira se o saldo permitir
→ Seja específico ao perfil dos dados
→ Nunca invente retornos ou garantias

listar_lancamentos / buscar_lancamento:
→ Apresente os dados de forma clara e organizada
→ Destaque valores relevantes
→ Indique o total encontrado

Responda em português, de forma direta, humana e útil.
Não use linguagem genérica. Não invente dados que não estão acima.
`;

// ─── Utilities ────────────────────────────────────────────────────────────────

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
    'De qual banco foi essa transação? Responda com uma destas opções:',
    'Bradesco PF',
    'Bradesco PJ',
    'C6 PF',
    'C6 PJ',
    'Santander PF',
  ].join('\n');

const getGeminiUserMessage = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('api key')) {
      return 'A chave do Gemini configurada no deploy parece inválida. Verifique a GEMINI_API_KEY na Vercel.';
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
      return 'Não consegui alcançar a API do Gemini a partir do servidor.';
    }

    if (
      message.includes('candidate') ||
      message.includes('response') ||
      message.includes('json') ||
      message.includes('parse')
    ) {
      return 'O Gemini respondeu em um formato que não consegui interpretar. Tente reformular a mensagem.';
    }

    return `Erro no Gemini: ${error.message}`;
  }

  return 'Estou com problemas para me conectar à inteligência artificial no momento. Tente novamente mais tarde.';
};

// ─── Supabase ─────────────────────────────────────────────────────────────────

const saveTransaction = async (
  transaction: PendingTransaction & { bank_account: BankAccountId },
) => {
  const account = BANK_ACCOUNT_BY_ID[transaction.bank_account];

  return supabase.from('transactions').insert([
    {
      description: transaction.descricao,
      amount: transaction.valor,
      type: transaction.tipo,
      entity: account.entity,
      bank_account: transaction.bank_account,
    },
  ]);
};

const fetchAnalysisData = async (periodo?: string): Promise<AnalysisData> => {
  const empty: AnalysisData = {
    periodo: periodo || 'mes_atual',
    totalEntradas: 0,
    totalSaidas: 0,
    saldo: 0,
    transacoes: [],
    porCategoria: {},
    porConta: {},
    porContexto: {},
  };

  let query = supabase
    .from('transactions')
    .select('description, amount, type, created_at, bank_account, entity')
    .order('created_at', { ascending: false })
    .limit(200);

  const now = new Date();

  if (!periodo || periodo === 'mes_atual' || periodo === 'none') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    query = query.gte('created_at', startOfMonth);
  } else if (periodo === 'semana') {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', sevenDaysAgo);
  } else if (/^\d{4}-\d{2}$/.test(periodo)) {
    const [year, month] = periodo.split('-').map(Number);
    const start = new Date(year, month - 1, 1).toISOString();
    const end = new Date(year, month, 1).toISOString();
    query = query.gte('created_at', start).lt('created_at', end);
  }

  const { data, error } = await query;

  if (error || !data) return empty;

  let totalEntradas = 0;
  let totalSaidas = 0;
  const porConta: AnalysisData['porConta'] = {};
  const porContexto: AnalysisData['porContexto'] = {};

  for (const t of data as TransactionRow[]) {
    const isIncome = t.type === 'income';
    const value = t.amount || 0;

    if (isIncome) totalEntradas += value;
    else totalSaidas += value;

    const conta = t.bank_account || 'sem_conta';
    if (!porConta[conta]) porConta[conta] = { entradas: 0, saidas: 0, saldo: 0 };
    if (isIncome) {
      porConta[conta].entradas += value;
      porConta[conta].saldo += value;
    } else {
      porConta[conta].saidas += value;
      porConta[conta].saldo -= value;
    }

    const ctx = t.entity || 'CPF';
    if (!porContexto[ctx]) porContexto[ctx] = { entradas: 0, saidas: 0, saldo: 0 };
    if (isIncome) {
      porContexto[ctx].entradas += value;
      porContexto[ctx].saldo += value;
    } else {
      porContexto[ctx].saidas += value;
      porContexto[ctx].saldo -= value;
    }
  }

  return {
    periodo: periodo || 'mes_atual',
    totalEntradas,
    totalSaidas,
    saldo: totalEntradas - totalSaidas,
    transacoes: (data as TransactionRow[]).slice(0, 20).map((t) => ({
      descricao: t.description,
      valor: t.amount,
      tipo: t.type,
      data: t.created_at,
      conta: t.bank_account || 'sem_conta',
      contexto: t.entity || 'CPF',
    })),
    porCategoria: {},
    porConta,
    porContexto,
  };
};

// ─── Action Handlers ──────────────────────────────────────────────────────────

const handleCriarLancamento = async (
  ctx: Context,
  data: NexusResponse,
  originalText: string,
) => {
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
      descricao: data.descricao,
      valor: data.valor,
      tipo: data.tipo as TransactionType,
      contexto: data.contexto,
      categoria: data.categoria,
    });
    await ctx.reply(`${data.message}\n\n${getBankQuestion()}`);
    return;
  }

  const { error } = await saveTransaction({
    descricao: data.descricao,
    valor: data.valor,
    tipo: data.tipo as TransactionType,
    contexto: data.contexto,
    categoria: data.categoria,
    bank_account: inferredBank,
  });

  if (error) {
    console.error('Supabase Error:', error);
    await ctx.reply('Erro ao salvar a transação. Tente novamente.');
    return;
  }

  await ctx.reply(`Nexus: ${data.message}`);
};

const handleAnalise = async (
  ctx: Context,
  userMessage: string,
  acao: AcaoType,
  periodo: string | undefined,
  analysisModel: TelegramRuntime['analysisModel'],
) => {
  await ctx.reply('Analisando seus dados...');

  const analysisData = await fetchAnalysisData(periodo);
  const prompt = getAnalysisPrompt(userMessage, acao, analysisData);

  try {
    const result = await analysisModel.generateContent(prompt);
    await ctx.reply(result.response.text());
  } catch (err) {
    console.error('Analysis Error:', err);
    const { totalEntradas, totalSaidas, saldo } = analysisData;
    await ctx.reply(
      `Resumo financeiro (${analysisData.periodo}):\n\nEntradas: R$ ${totalEntradas.toFixed(2)}\nSaídas: R$ ${totalSaidas.toFixed(2)}\nSaldo: R$ ${saldo.toFixed(2)}`,
    );
  }
};

const handleListagem = async (
  ctx: Context,
  userMessage: string,
  acao: AcaoType,
  periodo: string | undefined,
  termo: string | undefined,
  analysisModel: TelegramRuntime['analysisModel'],
) => {
  await ctx.reply('Buscando lançamentos...');

  const analysisData = await fetchAnalysisData(periodo);

  if (termo && termo !== 'none' && acao === 'buscar_lancamento') {
    const normalizedTermo = termo.toLowerCase();
    analysisData.transacoes = analysisData.transacoes.filter((t) =>
      t.descricao?.toLowerCase().includes(normalizedTermo),
    );
  }

  const prompt = getAnalysisPrompt(userMessage, acao, analysisData);

  try {
    const result = await analysisModel.generateContent(prompt);
    await ctx.reply(result.response.text());
  } catch (err) {
    console.error('Listing Error:', err);
    const transacoes = analysisData.transacoes.slice(0, 10);
    if (!transacoes.length) {
      await ctx.reply('Nenhum lançamento encontrado para o período.');
      return;
    }
    const lista = transacoes
      .map(
        (t) =>
          `• ${t.descricao}: R$ ${t.valor?.toFixed(2)} (${t.tipo === 'income' ? 'entrada' : 'saída'}) — ${t.conta}`,
      )
      .join('\n');
    await ctx.reply(`Lançamentos encontrados:\n\n${lista}`);
  }
};

// ─── Bot Registration ─────────────────────────────────────────────────────────

const registerHandlers = (
  bot: Telegraf,
  classifierModel: TelegramRuntime['classifierModel'],
  analysisModel: TelegramRuntime['analysisModel'],
) => {
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
        await ctx.reply('Erro ao salvar a transação. Verifique se a coluna bank_account existe na tabela transactions.');
        return;
      }

      pendingTransactions.delete(chatId);
      await ctx.reply(`Lançamento salvo no ${BANK_ACCOUNT_BY_ID[bankAccount].label}.`);
      return;
    }

    const prompt = getClassifierPrompt(text);

    try {
      const result = await classifierModel.generateContent(prompt);
      const responseText = result.response.text();
      const cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

      let data: NexusResponse;
      try {
        data = JSON.parse(cleanedText) as NexusResponse;
      } catch (parseError) {
        console.error('JSON Parse Error:', parseError, 'Raw:', cleanedText);
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
          await handleAnalise(ctx, text, data.acao, data.periodo, analysisModel);
          break;

        case 'listar_lancamentos':
        case 'buscar_lancamento':
          await handleListagem(ctx, text, data.acao, data.periodo, data.termo, analysisModel);
          break;

        case 'editar_lancamento':
        case 'remover_lancamento':
          await ctx.reply(
            `Nexus: ${data.message}\n\n⚠️ Edição e remoção ainda estão em desenvolvimento. Por enquanto, use o dashboard para gerenciar esses lançamentos.`,
          );
          break;

        default:
          await ctx.reply(`Nexus: ${data.message}`);
      }
    } catch (err) {
      console.error('Gemini API Error:', { error: err, text, chatId });
      await ctx.reply(getGeminiUserMessage(err));
    }
  });
};

// ─── Runtime ──────────────────────────────────────────────────────────────────

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

  const classifierModel = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const analysisModel = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
  });

  registerHandlers(bot, classifierModel, analysisModel);
  runtime = { bot, classifierModel, analysisModel };
  return runtime;
};

export const telegramWebhookHandler = async (body: Update) => {
  const { bot } = getTelegramRuntime();
  await bot.handleUpdate(body);
};
