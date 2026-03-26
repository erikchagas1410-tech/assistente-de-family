alter table if exists public.transactions
add column if not exists bank_account text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_bank_account_check'
  ) then
    alter table public.transactions
    add constraint transactions_bank_account_check
    check (
      bank_account is null
      or bank_account in (
        'bradesco_pf',
        'bradesco_pj',
        'c6_pf',
        'c6_pj',
        'santander_pf'
      )
    );
  end if;
end $$;
