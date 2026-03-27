import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

const fmt = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const sendTelegramMessage = async (botToken: string, chatId: string, text: string) => {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  return res.ok;
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  // Vercel cron injeta Authorization: Bearer $CRON_SECRET automaticamente
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_ALERT_CHAT_ID não configurado.' },
      { status: 500 },
    );
  }

  // Busca contas que vencem exatamente daqui a 3 dias e não foram pagas
  const alertDate = new Date();
  alertDate.setDate(alertDate.getDate() + 3);
  const dateStr = alertDate.toISOString().split('T')[0];

  const { data: bills, error } = await supabase
    .from('bills')
    .select('id, description, amount, due_date, entity')
    .eq('due_date', dateStr)
    .is('paid_at', null);

  if (error) {
    console.error('[check-alerts] Supabase error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bills?.length) {
    return NextResponse.json({ message: 'Nenhuma conta vence em 3 dias.', sent: 0 });
  }

  let sent = 0;
  for (const bill of bills) {
    const dueFormatted = new Date(bill.due_date + 'T12:00:00').toLocaleDateString('pt-BR');
    const message =
      `⚠️ *Nexus — Alerta de Vencimento*\n\n` +
      `A conta *${bill.description}* vence em *3 dias* (${dueFormatted}).\n\n` +
      `💰 Valor: *${fmt(Number(bill.amount))}*\n` +
      `🏷️ Entidade: ${bill.entity}\n\n` +
      `Agilize o pagamento para evitar multas e juros!`;

    const ok = await sendTelegramMessage(botToken, chatId, message);
    if (ok) sent++;
    else console.error('[check-alerts] Falha ao enviar alerta para conta:', bill.id);
  }

  return NextResponse.json({ message: `${sent} alerta(s) enviado(s).`, sent, total: bills.length });
}
