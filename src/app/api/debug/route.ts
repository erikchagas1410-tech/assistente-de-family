import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { supabase } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, unknown> = {};

  // 1. Verifica variáveis de ambiente
  results.env = {
    GROQ_API_KEY: process.env.GROQ_API_KEY ? `${process.env.GROQ_API_KEY.slice(0, 8)}...` : 'MISSING',
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'OK' : 'MISSING',
    SUPABASE_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'OK' : 'MISSING',
    TELEGRAM_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? 'OK' : 'MISSING',
  };

  // 2. Testa Supabase SELECT
  try {
    const { data, error } = await supabase.from('transactions').select('id').limit(1);
    results.supabase_select = error ? { error: error.message } : { ok: true, rows: data?.length ?? 0 };
  } catch (e) {
    results.supabase_select = { error: String(e) };
  }

  // 3. Testa Supabase INSERT
  try {
    const { data, error } = await supabase
      .from('transactions')
      .insert([{ description: '__debug_test__', amount: 1, type: 'expense', entity: 'CPF' }])
      .select('id');
    if (error) {
      results.supabase_insert = { error: error.message, code: error.code };
    } else {
      results.supabase_insert = { ok: true, id: data?.[0]?.id };
      // Deleta o registro de teste
      if (data?.[0]?.id) {
        await supabase.from('transactions').delete().eq('id', data[0].id);
      }
    }
  } catch (e) {
    results.supabase_insert = { error: String(e) };
  }

  // 4. Testa Groq
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'Retorne exatamente: {"ok":true}' }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 32,
    });
    const text = completion.choices[0]?.message?.content ?? '';
    results.groq = { ok: true, response: text };
  } catch (e) {
    results.groq = { error: String(e) };
  }

  return NextResponse.json(results);
}
