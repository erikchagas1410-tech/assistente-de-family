# Assistente de Contas

Aplicacao Next.js para acompanhamento financeiro com integracao com Supabase, Telegram e Gemini.

## Requisitos

- Node.js 20+
- npm 10+

## Variaveis de ambiente

Crie um arquivo `.env.local` com base no `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
TELEGRAM_BOT_TOKEN=
GEMINI_API_KEY=
```

## Rodando localmente

```bash
npm install
npm run dev
```

## Deploy na Vercel

1. Importe este repositorio na Vercel.
2. Configure as mesmas variaveis do `.env.example` em `Project Settings > Environment Variables`.
3. O framework preset deve ser `Next.js`.
4. Build command: `npm run build`.
5. Output directory: deixe em branco.

## Webhook do Telegram

Depois do deploy, configure o webhook do bot apontando para:

```text
https://SEU-DOMINIO/api/webhook/telegram
```
