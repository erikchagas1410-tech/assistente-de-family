import { NextResponse } from 'next/server';
import { handleTelegramUpdate } from './bot';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  const start = Date.now();
  try {
    const body = await request.json();
    console.log('[webhook] received update_id:', body?.update_id);
    await handleTelegramUpdate(body);
    const elapsed = Date.now() - start;
    console.log(`[webhook] done in ${elapsed}ms`);
    return NextResponse.json({ ok: true, ms: elapsed });
  } catch (error) {
    console.error('[webhook] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
