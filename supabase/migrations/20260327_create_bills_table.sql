-- Tabela de contas a pagar com controle de vencimento
CREATE TABLE IF NOT EXISTS bills (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  description text        NOT NULL,
  amount      numeric     NOT NULL,
  due_date    date        NOT NULL,
  paid_at     timestamptz,
  entity      text        NOT NULL DEFAULT 'CPF' CHECK (entity IN ('CPF', 'CNPJ')),
  bank_account text,
  notes       text
);

CREATE INDEX IF NOT EXISTS bills_due_date_idx ON bills (due_date);
CREATE INDEX IF NOT EXISTS bills_paid_idx     ON bills (paid_at) WHERE paid_at IS NULL;
