import { NextResponse } from 'next/server';
import { handleTelegramUpdate } from './bot';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  const start = Date.now();
  try {
    const body = await request.json();
    const result = await handleTelegramUpdate(body);
    const elapsed = Date.now() - start;
    return NextResponse.json({ ok: true, ms: elapsed, debug: result });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
