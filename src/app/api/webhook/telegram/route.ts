import { NextResponse } from 'next/server';
import { handleTelegramUpdate } from './bot';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await handleTelegramUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[webhook] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
