import { NextResponse } from 'next/server';
import { telegramWebhookHandler } from './bot';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await telegramWebhookHandler(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}
