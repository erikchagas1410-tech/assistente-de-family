import Groq from 'groq-sdk';
import { Update } from 'telegraf/types';
import { BANK_ACCOUNTS, BANK_ACCOUNT_BY_ID, isValidBankAccount } from '@/lib/banks';

type BotCtx = { chat: { id: number }; reply: (text: string, opts?: { parse_mode?: 'Markdown' }) => Promise<unknown> };
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
  | 'criar_conta_pagar'
  | 'listar_contas_pagar'
  | 'marcar_conta_paga'
  | 'conversa';

interface NexusResponse {
  acao: AcaoType;
  tipo: TransactionType | 'none';
  valor: number;
  descricao: string;
  data: string;
  vencimento: string; // YYYY-MM-DD ou "none" (para criar_conta_pagar)
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



// ─── State ────────────────────────────────────────────────────────────────────

const pendingTransactions  = new Map<number, PendingTransaction>();

interface HistoryMessage { role: 'user' | 'assistant'; content: string }
const conversationHistory = new Map<number, HistoryMessage[]>();
const MAX_HISTORY = 12;
const supportedBankList = BANK_ACCOUNTS.map((a) => `${a.id} (${a.label})`).join(', ');

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

const getClassifierPrompt = (text: string) => {
  const today = new Date().toISOString().split('T')[0];
  return `Classifique a intenção do usuário e retorne JSON. Nada mais.

Mensagem: "${text}"
Hoje: ${today}

AÇÕES:
- transação (gastei, paguei, recebi, lançar, registrar, entrou, saiu) → criar_lancamento
- remover/apagar/excluir lançamento → remover_lancamento
- editar/corrigir/alterar lançamento → editar_lancamento
- listar/mostrar lançamentos → listar_lancamentos
- buscar lançamento → buscar_lancamento
- resumo do mês/período → resumo_periodo
- gastos por categoria → resumo_por_categoria
- gastos por banco/conta → resumo_por_conta
- saúde financeira/como estou → analisar_saude_financeira
- comparar períodos → comparar_periodos
- onde economizar/ajustes → sugerir_ajustes
- investir/investimento → sugerir_investimentos
- adicionar conta/boleto/fatura a pagar (nova conta, lembrar de pagar, vence dia X) → criar_conta_pagar
- listar/mostrar/quais contas a pagar/vencem → listar_contas_pagar
- marcar conta como paga/quitada (paguei a conta de X) → marcar_conta_paga
- tudo mais → conversa

BANCOS VÁLIDOS: ${supportedBankList}
CPF por padrão. CNPJ só se mencionar empresa/PJ/CNPJ.
Banco não identificado → needs_bank: true, conta: "none".
Receita/entrada → tipo: "income". Gasto/saída → tipo: "expense".
Para datas de vencimento: interprete "dia 5", "dia 10/04", "próximo dia 15" usando a data de hoje e retorne YYYY-MM-DD. Se não der para determinar → "none".

JSON:
{
  "acao": "conversa",
  "tipo": "none",
  "valor": 0,
  "descricao": "none",
  "data": "hoje",
  "vencimento": "none",
  "categoria": "none",
  "conta": "none",
  "contexto": "CPF",
  "needs_bank": false,
  "periodo": "none",
  "termo": "none",
  "message": "none"
}
`;
};

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

// Groq às vezes retorna variantes ("despesa", "analisar", etc.) — normaliza para os valores esperados
const VALID_ACOES: AcaoType[] = [
  'criar_lancamento', 'editar_lancamento', 'remover_lancamento',
  'listar_lancamentos', 'buscar_lancamento', 'resumo_periodo',
  'resumo_por_categoria', 'resumo_por_conta', 'analisar_saude_financeira',
  'comparar_periodos', 'sugerir_ajustes', 'sugerir_investimentos',
  'criar_conta_pagar', 'listar_contas_pagar', 'marcar_conta_paga', 'conversa',
];

const normalizeResponse = (raw: NexusResponse, originalText: string): NexusResponse => {
  // Normaliza acao
  let acao = raw.acao as string;
  if (!VALID_ACOES.includes(acao as AcaoType)) {
    const a = acao?.toLowerCase() ?? '';
    if (a.includes('lancamento') || a.includes('criar') || a.includes('registrar')) {
      acao = 'criar_lancamento';
    } else if (a.includes('lista') || a.includes('mostra') || a.includes('ver')) {
      acao = 'listar_lancamentos';
    } else if (a.includes('resumo') || a.includes('relatorio') || a.includes('relat')) {
      acao = 'resumo_periodo';
    } else if (a.includes('saude') || a.includes('saúde') || a.includes('analis')) {
      acao = 'analisar_saude_financeira';
    } else if (a.includes('ajust') || a.includes('econom') || a.includes('reduz')) {
      acao = 'sugerir_ajustes';
    } else if (a.includes('invest')) {
      acao = 'sugerir_investimentos';
    } else if (a.includes('conta') && a.includes('pagar')) {
      acao = 'criar_conta_pagar';
    } else {
      // Último recurso: se tem valor > 0 e tipo de transação, é um lançamento
      const t = (raw.tipo as string)?.toLowerCase() ?? '';
      const hasFinancialType = t.includes('expense') || t.includes('income') ||
        t.includes('despesa') || t.includes('gasto') || t.includes('receita') ||
        t.includes('entrada') || t.includes('saida') || t.includes('saída');
      acao = (raw.valor > 0 && hasFinancialType) ? 'criar_lancamento' : 'conversa';
    }
  }

  // Normaliza tipo
  let tipo: TransactionType | 'none' = 'none';
  const rawTipo = (raw.tipo as string)?.toLowerCase() ?? '';
  if (['expense', 'despesa', 'gasto', 'saida', 'saída', 'pagamento'].some(v => rawTipo.includes(v))) {
    tipo = 'expense';
  } else if (['income', 'receita', 'entrada', 'recebimento', 'ganho'].some(v => rawTipo.includes(v))) {
    tipo = 'income';
  } else {
    tipo = raw.tipo === 'income' || raw.tipo === 'expense' ? raw.tipo : 'none';
  }

  // Normaliza contexto (entidade CPF/CNPJ)
  const rawCtx = (raw.contexto as string)?.toUpperCase() ?? '';
  const contexto: EntityType =
    rawCtx === 'CNPJ' || rawCtx.includes('CNPJ') || rawCtx.includes('EMPRESA') || rawCtx.includes('PJ')
      ? 'CNPJ'
      : 'CPF';

  // Normaliza conta (tenta converter nome livre para ID válido)
  let conta = raw.conta;
  if (!isValidBankAccount(conta)) {
    const foundBank = findBankFromText(String(raw.conta ?? ''), contexto) ??
      findBankFromText(originalText, contexto);
    conta = foundBank ?? 'none';
  }

  return { ...raw, acao: acao as AcaoType, tipo, contexto, conta };
};

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

const saveTransaction = async (transaction: PendingTransaction & { bank_account?: BankAccountId | null }) => {
  const account = transaction.bank_account ? BANK_ACCOUNT_BY_ID[transaction.bank_account] : null;
  return supabase.from('transactions').insert([{
    description: transaction.descricao,
    amount: transaction.valor,
    type: transaction.tipo,
    entity: account?.entity ?? transaction.contexto,
    bank_account: transaction.bank_account ?? null,
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

const fmtBRL = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const saveBill = async (bill: { descricao: string; valor: number; due_date: string; entity: EntityType }) =>
  supabase.from('bills').insert([{
    description: bill.descricao,
    amount: bill.valor,
    due_date: bill.due_date,
    entity: bill.entity,
  }]);

// ─── Action Handlers ──────────────────────────────────────────────────────────

const handleCriarContaPagar = async (ctx: BotCtx, data: NexusResponse) => {

  if (!data.descricao || data.descricao === 'none' || !data.valor || data.valor <= 0) {
    await ctx.reply('Nexus: Não consegui identificar a conta. Tente: "adicionar conta Luz R$150 vence dia 10/04"');
    return;
  }

  if (!data.vencimento || data.vencimento === 'none') {
    await ctx.reply(`Entendido. Para salvar essa conta eu ainda preciso da data de vencimento.\n\nEnvie tudo em uma unica mensagem, por exemplo: "adicionar conta ${data.descricao} ${fmtBRL(data.valor)} vence dia 10/04".`);
    return;
  }

  const { error } = await saveBill({ descricao: data.descricao, valor: data.valor, due_date: data.vencimento, entity: data.contexto });
  if (error) { await ctx.reply('Erro ao salvar a conta. Tente novamente.'); return; }

  const dueFormatted = new Date(data.vencimento + 'T12:00:00').toLocaleDateString('pt-BR');
  await ctx.reply(`✅ Conta *${data.descricao}* de ${fmtBRL(data.valor)} registrada — vence em ${dueFormatted}.`);
};

const handleListarContasPagar = async (ctx: BotCtx) => {
  const { data: bills, error } = await supabase
    .from('bills')
    .select('description, amount, due_date, paid_at, entity')
    .is('paid_at', null)
    .order('due_date', { ascending: true })
    .limit(15);

  if (error || !bills?.length) {
    await ctx.reply('Nenhuma conta a pagar encontrada.');
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lines = bills.map((b: { description: string; amount: number; due_date: string; entity: string }) => {
    const due = new Date(b.due_date + 'T00:00:00');
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
    const icon = diffDays < 0 ? '🔴' : diffDays <= 3 ? '🟡' : '⚪';
    const label = diffDays < 0
      ? `venceu há ${Math.abs(diffDays)}d`
      : diffDays === 0 ? 'vence hoje'
      : `vence em ${diffDays}d`;
    return `${icon} *${b.description}* — ${fmtBRL(Number(b.amount))} (${label})`;
  });

  await ctx.reply(`📋 *Contas a Pagar*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
};

const handleMarcarContaPaga = async (ctx: BotCtx, data: NexusResponse) => {
  if (!data.descricao || data.descricao === 'none') {
    await ctx.reply('Nexus: Qual conta você quer marcar como paga?');
    return;
  }

  const term = data.descricao.toLowerCase();

  const { data: bills, error } = await supabase
    .from('bills')
    .select('id, description, amount, due_date')
    .is('paid_at', null)
    .ilike('description', `%${term}%`)
    .order('due_date', { ascending: true })
    .limit(5);

  if (error || !bills?.length) {
    await ctx.reply(`Nenhuma conta pendente encontrada com "${data.descricao}".`);
    return;
  }

  // Se encontrou exatamente uma, marca como paga
  if (bills.length === 1) {
    const bill = bills[0];
    const { error: updateError } = await supabase
      .from('bills')
      .update({ paid_at: new Date().toISOString() })
      .eq('id', bill.id);

    if (updateError) { await ctx.reply('Erro ao atualizar a conta. Tente novamente.'); return; }
    await ctx.reply(`✅ Conta *${bill.description}* de ${fmtBRL(Number(bill.amount))} marcada como paga!`, { parse_mode: 'Markdown' });
    return;
  }

  // Múltiplas — lista para o usuário escolher
  const list = (bills as Array<{ id: string; description: string; amount: number; due_date: string }>)
    .map((b, i) => `${i + 1}. *${b.description}* — ${fmtBRL(Number(b.amount))} (vence ${new Date(b.due_date + 'T12:00:00').toLocaleDateString('pt-BR')})`)
    .join('\n');
  await ctx.reply(`Encontrei ${bills.length} contas com esse nome:\n\n${list}\n\nSeja mais específico (ex: "marcar conta Luz de abril como paga").`, { parse_mode: 'Markdown' });
};

const handleCriarLancamento = async (ctx: BotCtx, data: NexusResponse, originalText: string) => {
  const chatId = ctx.chat!.id;
  console.log('[handleCriarLancamento] tipo:', data.tipo, 'valor:', data.valor, 'descricao:', data.descricao);

  if (data.tipo === 'none' || !data.valor || data.valor <= 0) {
    console.log('[handleCriarLancamento] skipping: tipo=none or valor<=0');
    await ctx.reply(`Nexus: ${data.message}`);
    return;
  }

  const inferredBank =
    (isValidBankAccount(data.conta) ? (data.conta as BankAccountId) : null) ||
    findBankFromText(originalText, data.contexto);
  console.log('[handleCriarLancamento] inferredBank:', inferredBank, 'needs_bank:', data.needs_bank);

  console.log('[handleCriarLancamento] inserting to supabase...');
  const { error } = await saveTransaction({
    descricao: data.descricao, valor: data.valor,
    tipo: data.tipo as TransactionType, contexto: data.contexto,
    categoria: data.categoria, bank_account: inferredBank ?? null,
  });

  if (error) {
    console.error('[handleCriarLancamento] Supabase Error:', JSON.stringify(error));
    await ctx.reply('Erro ao salvar a transação. Tente novamente.');
    return;
  }

  console.log('[handleCriarLancamento] saved!');
  if (!inferredBank || data.needs_bank) {
    await ctx.reply(`Nexus: ${data.message}\n\nSalvei esse lançamento sem vincular um banco. Se quiser, eu posso registrar o próximo já com "Bradesco PF", "Bradesco PJ", "C6 PF", "C6 PJ" ou "Santander PF" na mensagem.`);
    return;
  }

  await ctx.reply(`Nexus: ${data.message}`);
};

const handleAnalise = async (ctx: BotCtx, userMessage: string, acao: AcaoType, periodo: string | undefined, groq: Groq) => {
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

const buildConversationSystem = (data: AnalysisData) => {
  const ratio = data.totalEntradas > 0
    ? ((data.totalSaidas / data.totalEntradas) * 100).toFixed(0)
    : 'N/A';
  const topGastos = data.transacoes
    .filter((t) => t.tipo === 'expense')
    .reduce<Record<string, number>>((acc, t) => { acc[t.descricao] = (acc[t.descricao] ?? 0) + t.valor; return acc; }, {});
  const top3 = Object.entries(topGastos).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${k}: R$${v.toFixed(2)}`).join(', ');

  return `Você é o Nexus Wealth, Assistente Financeiro, Fiscal e Contábil completo.
Personalidade: humano, direto, inteligente, prático, confiável. Você é parceiro financeiro — não robô.

SITUAÇÃO FINANCEIRA ATUAL (${data.periodo}):
- Entradas: R$ ${data.totalEntradas.toFixed(2)}
- Saídas: R$ ${data.totalSaidas.toFixed(2)}
- Saldo: R$ ${data.saldo.toFixed(2)}
- Comprometimento: ${ratio}% das entradas
- Top gastos: ${top3 || 'sem dados'}
- Por conta: ${JSON.stringify(data.porConta)}
- CPF vs CNPJ: ${JSON.stringify(data.porContexto)}

REGRAS DE COMPORTAMENTO:
- Sempre baseie suas respostas nos dados financeiros reais acima
- Nunca pergunte "como posso ajudar?" — isso é genérico demais
- Quando o usuário pedir dicas/sugestões → use os dados acima para ser específico
- Quando faltarem dados → faça NO MÁXIMO uma pergunta por resposta
- Se o usuário mencionar renda/gastos → analise e oriente imediatamente
- Se estiver errando → corrija com respeito
- O usuário pode lançar transações, contas a pagar e marcar pagamentos aqui no Telegram
- Máximo 180 palavras por resposta`;
};

const handleConversa = async (ctx: BotCtx, userMessage: string, groq: Groq) => {
  const chatId = ctx.chat!.id;
  const history = conversationHistory.get(chatId) ?? [];

  // Busca dados financeiros do mês atual para enriquecer o contexto
  const financialData = await fetchAnalysisData('mes_atual');
  const systemPrompt = buildConversationSystem(financialData);

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
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

const handleListagem = async (ctx: BotCtx, userMessage: string, acao: AcaoType, periodo: string | undefined, termo: string | undefined, groq: Groq) => {
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

// ─── Telegram Send Helper (direto, sem Telegraf middleware) ───────────────────

const sendMessage = async (chatId: number, text: string, parseMode?: 'Markdown') => {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...(parseMode && { parse_mode: parseMode }) }),
  });
};

// Shim de ctx para reutilizar os handlers existentes sem mudança
const makeCtx = (chatId: number) => ({
  chat: { id: chatId },
  reply: (text: string, opts?: { parse_mode?: 'Markdown' }) =>
    sendMessage(chatId, text, opts?.parse_mode),
});

// ─── Main Handler ─────────────────────────────────────────────────────────────

let groqInstance: Groq | null = null;
const getGroq = () => {
  if (!groqInstance) groqInstance = new Groq({ apiKey: process.env.GROQ_API_KEY! });
  return groqInstance;
};

export const handleTelegramUpdate = async (body: Update) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = (body as any).message as { chat: { id: number }; text?: string } | undefined;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const groq = getGroq();
  const ctx = makeCtx(chatId);

  // ── Pending transaction (aguardando banco) ──────────────────────────────────
  const pending = pendingTransactions.get(chatId);
  if (pending) {
    const bankAccount = findBankFromText(text, pending.contexto);
    if (!bankAccount) {
      await ctx.reply(`Não consegui identificar o banco.\n\n${getBankQuestion()}`);
      return;
    }
    const { error } = await saveTransaction({ ...pending, bank_account: bankAccount });
    if (error) {
      console.error('[bot] Supabase Error:', error);
      await ctx.reply('Erro ao salvar a transação.');
      return;
    }
    pendingTransactions.delete(chatId);
    await ctx.reply(`Lançamento salvo no ${BANK_ACCOUNT_BY_ID[bankAccount].label}.`);
    return;
  }

  // Classify + Dispatch
  try {
    console.log('[bot] classifying:', text);
    const raw = await generateJSON(groq, getClassifierPrompt(text));
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    console.log('[bot] groq raw:', cleaned.slice(0, 200));

    let data: NexusResponse;
    try {
      data = normalizeResponse(JSON.parse(cleaned) as NexusResponse, text);
      console.log('[bot] normalized acao:', data.acao, 'tipo:', data.tipo, 'valor:', data.valor, 'conta:', data.conta);
    } catch {
      await ctx.reply('Não consegui processar sua solicitação. Tente novamente.');
      return;
    }

    switch (data.acao) {
      case 'criar_lancamento':
        await handleCriarLancamento(ctx as never, data, text);
        break;
      case 'analisar_saude_financeira':
      case 'resumo_periodo':
      case 'resumo_por_categoria':
      case 'resumo_por_conta':
      case 'sugerir_ajustes':
      case 'sugerir_investimentos':
      case 'comparar_periodos':
        await handleAnalise(ctx as never, text, data.acao, data.periodo, groq);
        break;
      case 'listar_lancamentos':
      case 'buscar_lancamento':
        await handleListagem(ctx as never, text, data.acao, data.periodo, data.termo, groq);
        break;
      case 'editar_lancamento':
      case 'remover_lancamento':
        await ctx.reply('Edição e remoção devem ser feitas no dashboard. Posso ajudar com outra coisa?');
        break;
      case 'criar_conta_pagar':
        await handleCriarContaPagar(ctx as never, data);
        break;
      case 'listar_contas_pagar':
        await handleListarContasPagar(ctx as never);
        break;
      case 'marcar_conta_paga':
        await handleMarcarContaPaga(ctx as never, data);
        break;
      default:
        await handleConversa(ctx as never, text, groq);
    }
  } catch (err) {
    console.error('[bot] Error:', err);
    await ctx.reply(getErrorMessage(err));
  }
};
