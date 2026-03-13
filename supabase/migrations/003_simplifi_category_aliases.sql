-- ============================================================
-- Simplifi → our categories alias mapping
-- Simplifi uses "Parent:Child" notation e.g. "Dining & Drinks:Coffee"
-- We store the full Simplifi string → our category UUID
-- ============================================================

create table if not exists category_aliases (
  id           uuid primary key default uuid_generate_v4(),
  alias        text not null unique,   -- Simplifi category string (lowercased)
  category_id  uuid not null references categories(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table category_aliases enable row level security;
create policy category_aliases_auth_policy on category_aliases
  for all to authenticated using (true) with check (true);

-- ── Dining & Drinks ───────────────────────────────────────
insert into category_aliases (alias, category_id) values
('dining & drinks',               'c0000001-0000-0000-0000-000000000003'),
('dining & drinks:restaurants',   'c0000004-0000-0000-0000-000000000002'),
('dining & drinks:coffee',        'c0000004-0000-0000-0000-000000000003'),
('dining & drinks:fast food',     'c0000004-0000-0000-0000-000000000005'),
('dining & drinks:alcohol',       'c0000004-0000-0000-0000-000000000004'),
('dining & drinks:bars',          'c0000004-0000-0000-0000-000000000004'),

-- ── Groceries ─────────────────────────────────────────────
('groceries',                     'c0000004-0000-0000-0000-000000000001'),
('food & dining:groceries',       'c0000004-0000-0000-0000-000000000001'),

-- ── Shopping ──────────────────────────────────────────────
('shopping',                      'c0000001-0000-0000-0000-000000000004'),
('shopping:clothing',             'c0000001-0000-0000-0000-000000000004'),
('shopping:electronics',          'c0000001-0000-0000-0000-000000000004'),
('shopping:home',                 'c0000001-0000-0000-0000-000000000004'),
('shopping:amazon',               'c0000001-0000-0000-0000-000000000004'),
('shopping:online shopping',      'c0000001-0000-0000-0000-000000000004'),

-- ── Utilities ─────────────────────────────────────────────
('utilities',                     'c0000002-0000-0000-0000-000000000004'),
('utilities:gas & electric',      'c0000002-0000-0000-0000-000000000004'),
('utilities:electricity',         'c0000002-0000-0000-0000-000000000004'),
('utilities:natural gas',         'c0000002-0000-0000-0000-000000000004'),
('utilities:water',               'c0000002-0000-0000-0000-000000000004'),
('utilities:internet',            'c0000002-0000-0000-0000-000000000005'),
('utilities:phone',               'c0000002-0000-0000-0000-000000000005'),
('utilities:cable',               'c0000001-0000-0000-0000-000000000007'),

-- ── Housing ───────────────────────────────────────────────
('home:mortgage',                 'c0000002-0000-0000-0000-000000000001'),
('home:rent',                     'c0000002-0000-0000-0000-000000000001'),
('home:insurance',                'c0000002-0000-0000-0000-000000000002'),
('home:home improvement',         'c0000002-0000-0000-0000-000000000006'),
('home:maintenance',              'c0000002-0000-0000-0000-000000000006'),
('home:lawn & garden',            'c0000002-0000-0000-0000-000000000007'),

-- ── Transportation ────────────────────────────────────────
('transportation',                'c0000001-0000-0000-0000-000000000002'),
('transportation:gas & fuel',     'c0000003-0000-0000-0000-000000000001'),
('transportation:gas',            'c0000003-0000-0000-0000-000000000001'),
('transportation:fuel',           'c0000003-0000-0000-0000-000000000001'),
('transportation:auto insurance', 'c0000003-0000-0000-0000-000000000002'),
('transportation:auto maintenance','c0000003-0000-0000-0000-000000000003'),
('transportation:parking',        'c0000003-0000-0000-0000-000000000004'),
('transportation:transit',        'c0000003-0000-0000-0000-000000000004'),
('transportation:rideshare',      'c0000003-0000-0000-0000-000000000005'),
('transportation:uber',           'c0000003-0000-0000-0000-000000000005'),
('transportation:taxi',           'c0000003-0000-0000-0000-000000000005'),

-- ── Health & Fitness ──────────────────────────────────────
('health & fitness',              'c0000001-0000-0000-0000-000000000005'),
('fitness',                       'c0000001-0000-0000-0000-000000000005'),
('health & fitness:gym',          'c0000001-0000-0000-0000-000000000005'),
('health & fitness:pharmacy',     'c0000001-0000-0000-0000-000000000005'),
('health & fitness:doctor',       'c0000001-0000-0000-0000-000000000005'),
('health & fitness:dentist',      'c0000001-0000-0000-0000-000000000005'),
('medical',                       'c0000001-0000-0000-0000-000000000005'),

-- ── Entertainment ─────────────────────────────────────────
('entertainment',                 'c0000001-0000-0000-0000-000000000006'),
('entertainment:movies',          'c0000001-0000-0000-0000-000000000006'),
('entertainment:music',           'c0000001-0000-0000-0000-000000000006'),
('entertainment:sports',          'c0000001-0000-0000-0000-000000000006'),
('entertainment:games',           'c0000001-0000-0000-0000-000000000006'),

-- ── Subscriptions / Bills ─────────────────────────────────
('subscriptions',                 'c0000001-0000-0000-0000-000000000007'),
('bills & utilities',             'c0000001-0000-0000-0000-000000000007'),
('subscriptions:streaming',       'c0000007-0000-0000-0000-000000000001'),
('subscriptions:music',           'c0000007-0000-0000-0000-000000000002'),
('subscriptions:software',        'c0000007-0000-0000-0000-000000000003'),
('subscriptions:news',            'c0000007-0000-0000-0000-000000000004'),
('subscriptions:cloud',           'c0000007-0000-0000-0000-000000000005'),
('subscriptions:gaming',          'c0000007-0000-0000-0000-000000000006'),

-- ── Travel ────────────────────────────────────────────────
('travel',                        'c0000001-0000-0000-0000-000000000008'),
('travel:flights',                'c0000001-0000-0000-0000-000000000008'),
('travel:hotel',                  'c0000001-0000-0000-0000-000000000008'),
('travel:vacation',               'c0000001-0000-0000-0000-000000000008'),

-- ── Income ────────────────────────────────────────────────
('income',                        'c0000001-0000-0000-0000-000000000013'),
('income:paycheck',               'c0000013-0000-0000-0000-000000000001'),
('income:salary',                 'c0000013-0000-0000-0000-000000000001'),
('income:rental',                 'c0000013-0000-0000-0000-000000000002'),
('income:other income',           'c0000013-0000-0000-0000-000000000005'),

-- ── Personal Care ─────────────────────────────────────────
('personal care',                 'c0000001-0000-0000-0000-000000000009'),
('personal care:hair',            'c0000001-0000-0000-0000-000000000009'),
('personal care:spa',             'c0000001-0000-0000-0000-000000000009'),

-- ── Education ─────────────────────────────────────────────
('education',                     'c0000001-0000-0000-0000-000000000010'),
('education:tuition',             'c0000001-0000-0000-0000-000000000010'),
('education:books',               'c0000001-0000-0000-0000-000000000010'),

-- ── Gifts & Donations ─────────────────────────────────────
('gifts & donations',             'c0000001-0000-0000-0000-000000000011'),
('gifts & donations:charity',     'c0000001-0000-0000-0000-000000000011'),

-- ── Fees ──────────────────────────────────────────────────
('fees & charges',                'c0000001-0000-0000-0000-000000000015'),
('fees & charges:bank fee',       'c0000001-0000-0000-0000-000000000015'),
('fees & charges:late fee',       'c0000001-0000-0000-0000-000000000015'),
('fees & charges:service fee',    'c0000001-0000-0000-0000-000000000015'),

-- ── Transfers ─────────────────────────────────────────────
('transfer',                      'c0000001-0000-0000-0000-000000000014'),
('transfers',                     'c0000001-0000-0000-0000-000000000014'),
('transfer:savings',              'c0000001-0000-0000-0000-000000000014'),

-- ── Investments ───────────────────────────────────────────
('investments',                   'c0000001-0000-0000-0000-000000000018'),
('investments:rrsp',              'c0000001-0000-0000-0000-000000000018'),
('investments:tfsa',              'c0000001-0000-0000-0000-000000000018'),
('investments:stocks',            'c0000001-0000-0000-0000-000000000018'),

-- ── Taxes ─────────────────────────────────────────────────
('taxes',                         'c0000001-0000-0000-0000-000000000019'),
('taxes:federal',                 'c0000019-0000-0000-0000-000000000001'),
('taxes:provincial',              'c0000019-0000-0000-0000-000000000002')

on conflict (alias) do nothing;
