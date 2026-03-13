-- ============================================================
-- Finance Tracker - Initial Schema
-- Ottawa, Canada | ~$184k salary + ~$24k rental income
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- fuzzy search for merchant names

-- ============================================================
-- ACCOUNTS
-- Represents bank accounts, credit cards, investment accounts
-- ============================================================
create table accounts (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,                          -- e.g. "TD Chequing", "Amex Gold"
  type        text not null check (type in (
    'chequing', 'savings', 'credit_card', 'investment', 'mortgage', 'loan', 'other'
  )),
  institution text,                                   -- e.g. "TD Bank", "Amex"
  currency    text not null default 'CAD',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- CATEGORIES
-- Hierarchical spending categories (parent → child)
-- ============================================================
create table categories (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  parent_id   uuid references categories(id) on delete set null,
  color       text,                                   -- hex colour for charts
  icon        text,                                   -- lucide icon name
  is_system   boolean not null default false,         -- seeded system categories
  created_at  timestamptz not null default now()
);

create unique index categories_name_parent_idx on categories(name, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================================
-- TRANSACTIONS
-- Core table — every income/expense record
-- ============================================================
create table transactions (
  id                uuid primary key default uuid_generate_v4(),
  account_id        uuid references accounts(id) on delete cascade,
  category_id       uuid references categories(id) on delete set null,

  -- Core fields (maps directly to Simplifi CSV columns)
  date              date not null,
  payee             text not null,
  amount            numeric(12, 2) not null,           -- negative = expense, positive = income
  memo              text,
  transaction_type  text check (transaction_type in ('debit', 'credit', 'transfer')),

  -- Enrichment
  merchant_name     text,                              -- normalized merchant (after dedup)
  tags              text[] default '{}',
  is_recurring      boolean not null default false,
  is_transfer       boolean not null default false,
  is_ignored        boolean not null default false,    -- exclude from budgets/reports
  notes             text,                              -- user notes

  -- Import tracking
  upload_id         uuid,                              -- FK added after uploads table
  simplifi_id       text,                              -- original Simplifi transaction ID
  import_hash       text unique,                       -- sha256 of (date|payee|amount|account) for dedup

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index transactions_date_idx       on transactions(date desc);
create index transactions_account_idx    on transactions(account_id);
create index transactions_category_idx   on transactions(category_id);
create index transactions_payee_trgm_idx on transactions using gin(payee gin_trgm_ops);
create index transactions_recurring_idx  on transactions(is_recurring) where is_recurring = true;

-- ============================================================
-- UPLOADS
-- Tracks each CSV import for auditability
-- ============================================================
create table uploads (
  id             uuid primary key default uuid_generate_v4(),
  filename       text not null,
  source         text not null default 'simplifi_csv' check (source in ('simplifi_csv', 'python_scraper', 'manual')),
  row_count      integer,
  imported_count integer,
  skipped_count  integer,
  error_log      jsonb default '[]',
  status         text not null default 'pending' check (status in ('pending', 'processing', 'complete', 'failed')),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- Back-fill FK on transactions
alter table transactions
  add constraint transactions_upload_id_fkey
  foreign key (upload_id) references uploads(id) on delete set null;

-- ============================================================
-- SUBSCRIPTIONS
-- Detected or manually flagged recurring charges
-- ============================================================
create table subscriptions (
  id              uuid primary key default uuid_generate_v4(),
  merchant_name   text not null,
  category_id     uuid references categories(id) on delete set null,
  amount          numeric(10, 2) not null,             -- expected monthly amount
  frequency       text not null default 'monthly' check (frequency in (
    'weekly', 'biweekly', 'monthly', 'quarterly', 'annual'
  )),
  next_expected   date,
  last_seen       date,
  is_active       boolean not null default true,
  keep_flag       text check (keep_flag in ('keep', 'cancel', 'review')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- GOALS
-- Financial goals with targets and deadlines
-- ============================================================
create table goals (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  type            text not null check (type in (
    'savings',          -- generic savings
    'mortgage_qual',    -- mortgage qualification fund
    'equalization',     -- equalization payment fund
    'travel',           -- travel fund
    'emergency',        -- emergency fund
    'investment',       -- investment target
    'debt_payoff'       -- debt reduction
  )),
  description     text,
  target_amount   numeric(14, 2) not null,
  current_amount  numeric(14, 2) not null default 0,
  target_date     date,
  currency        text not null default 'CAD',
  is_active       boolean not null default true,
  icon            text,
  color           text,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- GOAL CONTRIBUTIONS
-- Individual deposits/withdrawals toward a goal
-- ============================================================
create table goal_contributions (
  id             uuid primary key default uuid_generate_v4(),
  goal_id        uuid not null references goals(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete set null, -- linked transaction if applicable
  amount         numeric(12, 2) not null,              -- positive = contribution, negative = withdrawal
  note           text,
  contributed_at date not null default current_date,
  created_at     timestamptz not null default now()
);

create index goal_contributions_goal_idx on goal_contributions(goal_id);

-- Keep goals.current_amount in sync via trigger
create or replace function sync_goal_current_amount()
returns trigger language plpgsql as $$
begin
  update goals
  set current_amount = (
    select coalesce(sum(amount), 0)
    from goal_contributions
    where goal_id = coalesce(new.goal_id, old.goal_id)
  ),
  updated_at = now()
  where id = coalesce(new.goal_id, old.goal_id);
  return coalesce(new, old);
end;
$$;

create trigger goal_contributions_sync
after insert or update or delete on goal_contributions
for each row execute function sync_goal_current_amount();

-- ============================================================
-- BUDGET_PERIODS
-- Monthly budget envelopes per category
-- ============================================================
create table budget_periods (
  id           uuid primary key default uuid_generate_v4(),
  category_id  uuid not null references categories(id) on delete cascade,
  period_start date not null,                          -- always 1st of month
  period_end   date not null,                          -- always last of month
  budgeted     numeric(10, 2) not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (category_id, period_start)
);

-- ============================================================
-- INCOME_SOURCES
-- Tracks expected recurring income for cash-flow forecasting
-- ============================================================
create table income_sources (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,                           -- e.g. "Employment", "Rental - 123 Elm"
  type        text not null check (type in ('employment', 'rental', 'investment', 'other')),
  gross_cad   numeric(12, 2) not null,                 -- annual gross
  frequency   text not null default 'biweekly' check (frequency in (
    'weekly', 'biweekly', 'semimonthly', 'monthly', 'annual', 'irregular'
  )),
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- CHAT_SESSIONS
-- Claude-powered finance chat history
-- ============================================================
create table chat_sessions (
  id         uuid primary key default uuid_generate_v4(),
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table chat_messages (
  id         uuid primary key default uuid_generate_v4(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index chat_messages_session_idx on chat_messages(session_id, created_at);

-- ============================================================
-- UPDATED_AT trigger (shared)
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger accounts_updated_at       before update on accounts       for each row execute function set_updated_at();
create trigger transactions_updated_at   before update on transactions   for each row execute function set_updated_at();
create trigger subscriptions_updated_at  before update on subscriptions  for each row execute function set_updated_at();
create trigger goals_updated_at          before update on goals          for each row execute function set_updated_at();
create trigger budget_periods_updated_at before update on budget_periods for each row execute function set_updated_at();
create trigger chat_sessions_updated_at  before update on chat_sessions  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- Single-user app — lock everything to auth.uid()
-- ============================================================
alter table accounts          enable row level security;
alter table categories        enable row level security;
alter table transactions      enable row level security;
alter table uploads           enable row level security;
alter table subscriptions     enable row level security;
alter table goals             enable row level security;
alter table goal_contributions enable row level security;
alter table budget_periods    enable row level security;
alter table income_sources    enable row level security;
alter table chat_sessions     enable row level security;
alter table chat_messages     enable row level security;

-- Simple "authenticated users see all rows" policies (single-owner app)
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts','categories','transactions','uploads','subscriptions',
    'goals','goal_contributions','budget_periods','income_sources',
    'chat_sessions','chat_messages'
  ] loop
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_auth_policy', t
    );
  end loop;
end;
$$;
