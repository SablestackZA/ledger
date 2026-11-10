-- Contract: docs/superpowers/specs/2026-11-10-ledger-backend-design.md §3, §11.

create type account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type txn_status as enum ('posted', 'reversed');

create table accounts (
  id              uuid primary key,
  code            text not null unique,
  name            text not null,
  type            account_type not null,
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Signed: debit positive, credit negative. Cache of sum(entries.amount_minor).
  balance_minor   bigint not null default 0,
  version         int not null default 0,
  -- For POST /v1/accounts idempotency (§7).
  idempotency_key text not null unique,
  request_hash    bytea not null,
  created_at      timestamptz not null
);

create table transactions (
  id              uuid primary key,
  idempotency_key text not null unique,
  request_hash    bytea not null,
  description     text check (char_length(description) <= 200),
  status          txn_status not null default 'posted',
  reverses_id     uuid references transactions (id),
  version         int not null default 0,
  posted_at       timestamptz not null
);

-- One reversal per original, enforced by the database as well as by the status update.
create unique index transactions_reverses_id_key on transactions (reverses_id) where reverses_id is not null;
create index transactions_posted_at_idx on transactions (posted_at desc, id desc);

create table entries (
  id             bigserial primary key,
  transaction_id uuid not null references transactions (id),
  account_id     uuid not null references accounts (id),
  amount_minor   bigint not null check (amount_minor <> 0),
  currency       char(3) not null check (currency ~ '^[A-Z]{3}$')
);

create index entries_account_idx on entries (account_id, id desc);
create index entries_transaction_idx on entries (transaction_id);

-- Backstop: at least 2 entries and sum 0 per currency, checked at commit.
create function entries_assert_balanced() returns trigger
language plpgsql as $$
declare
  n   int;
  bad int;
begin
  select count(*) into n from entries where transaction_id = new.transaction_id;
  if n < 2 then
    raise exception 'transaction % has % entries; at least 2 are required', new.transaction_id, n
      using errcode = 'check_violation';
  end if;

  select count(*) into bad from (
    select 1 from entries where transaction_id = new.transaction_id
    group by currency having sum(amount_minor) <> 0
  ) s;
  if bad > 0 then
    raise exception 'transaction % does not sum to zero in % currency group(s)', new.transaction_id, bad
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger entries_balanced
  after insert on entries
  deferrable initially deferred
  for each row execute function entries_assert_balanced();

create function entries_assert_currency() returns trigger
language plpgsql as $$
declare
  acct_currency char(3);
begin
  select currency into acct_currency from accounts where id = new.account_id;
  if acct_currency is distinct from new.currency then
    raise exception 'entry currency % does not match account % currency %', new.currency, new.account_id, acct_currency
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger entries_currency
  before insert on entries
  for each row execute function entries_assert_currency();

-- Entries are append-only: UPDATE and DELETE are never granted to the app role.
do $$
begin
  if not exists (select from pg_roles where rolname = 'ledger_app') then
    create role ledger_app login;
  end if;
end $$;

grant usage on schema public to ledger_app;
grant select, insert on accounts, transactions, entries to ledger_app;
grant update (balance_minor, version) on accounts to ledger_app;
grant update (status, version) on transactions to ledger_app;
grant usage on sequence entries_id_seq to ledger_app;

-- The demo reset must empty entries, which the app role cannot; this runs TRUNCATE as the owner.
create function ledger_reset() returns void
language sql security definer set search_path = public, pg_temp as $$
  truncate entries, transactions, accounts restart identity;
$$;
revoke all on function ledger_reset() from public;
grant execute on function ledger_reset() to ledger_app;
