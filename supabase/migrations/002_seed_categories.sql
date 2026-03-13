-- ============================================================
-- Seed: Default Categories
-- Mirrors Quicken Simplifi's category structure
-- ============================================================

insert into categories (id, name, parent_id, color, icon, is_system) values
-- ── TOP-LEVEL ─────────────────────────────────────────────
('c0000001-0000-0000-0000-000000000001', 'Housing',           null, '#6366f1', 'home',          true),
('c0000001-0000-0000-0000-000000000002', 'Transportation',    null, '#f59e0b', 'car',           true),
('c0000001-0000-0000-0000-000000000003', 'Food & Dining',     null, '#10b981', 'utensils',      true),
('c0000001-0000-0000-0000-000000000004', 'Shopping',          null, '#ec4899', 'shopping-bag',  true),
('c0000001-0000-0000-0000-000000000005', 'Health & Fitness',  null, '#14b8a6', 'heart-pulse',   true),
('c0000001-0000-0000-0000-000000000006', 'Entertainment',     null, '#8b5cf6', 'tv-2',          true),
('c0000001-0000-0000-0000-000000000007', 'Subscriptions',     null, '#f97316', 'repeat',        true),
('c0000001-0000-0000-0000-000000000008', 'Travel',            null, '#0ea5e9', 'plane',         true),
('c0000001-0000-0000-0000-000000000009', 'Personal Care',     null, '#a78bfa', 'sparkles',      true),
('c0000001-0000-0000-0000-000000000010', 'Education',         null, '#22d3ee', 'graduation-cap',true),
('c0000001-0000-0000-0000-000000000011', 'Gifts & Donations', null, '#fb7185', 'gift',          true),
('c0000001-0000-0000-0000-000000000012', 'Business',          null, '#64748b', 'briefcase',     true),
('c0000001-0000-0000-0000-000000000013', 'Income',            null, '#22c55e', 'trending-up',   true),
('c0000001-0000-0000-0000-000000000014', 'Transfers',         null, '#94a3b8', 'arrow-left-right', true),
('c0000001-0000-0000-0000-000000000015', 'Fees & Charges',    null, '#ef4444', 'alert-circle',  true),
('c0000001-0000-0000-0000-000000000016', 'Kids',              null, '#fbbf24', 'baby',          true),
('c0000001-0000-0000-0000-000000000017', 'Pets',              null, '#84cc16', 'paw-print',     true),
('c0000001-0000-0000-0000-000000000018', 'Investments',       null, '#3b82f6', 'bar-chart-2',   true),
('c0000001-0000-0000-0000-000000000019', 'Taxes',             null, '#dc2626', 'landmark',      true),
('c0000001-0000-0000-0000-000000000020', 'Uncategorized',     null, '#d1d5db', 'help-circle',   true),

-- ── HOUSING ───────────────────────────────────────────────
('c0000002-0000-0000-0000-000000000001', 'Mortgage / Rent',    'c0000001-0000-0000-0000-000000000001', null, null, true),
('c0000002-0000-0000-0000-000000000002', 'Home Insurance',     'c0000001-0000-0000-0000-000000000001', null, null, true),
('c0000002-0000-0000-0000-000000000003', 'Property Tax',       'c0000001-0000-0000-0000-000000000001', null, null, true),
('c0000002-0000-0000-0000-000000000004', 'Utilities',          'c0000001-0000-0000-0000-000000000001', null, null, true),
('c0000002-0000-0000-0000-000000000005', 'Internet & Phone',   'c0000001-0000-0000-0000-000000000001', null, null, true),
('c0000002-0000-0000-0000-000000000006', 'Home Maintenance',   'c0000001-0000-0000-0000-000000000001', null, null, true),
('c0000002-0000-0000-0000-000000000007', 'Lawn & Garden',      'c0000001-0000-0000-0000-000000000001', null, null, true),
('c0000002-0000-0000-0000-000000000008', 'Rental Property',    'c0000001-0000-0000-0000-000000000001', null, null, true),

-- ── TRANSPORTATION ────────────────────────────────────────
('c0000003-0000-0000-0000-000000000001', 'Gas',                'c0000001-0000-0000-0000-000000000002', null, null, true),
('c0000003-0000-0000-0000-000000000002', 'Auto Insurance',     'c0000001-0000-0000-0000-000000000002', null, null, true),
('c0000003-0000-0000-0000-000000000003', 'Auto Maintenance',   'c0000001-0000-0000-0000-000000000002', null, null, true),
('c0000003-0000-0000-0000-000000000004', 'Parking & Transit',  'c0000001-0000-0000-0000-000000000002', null, null, true),
('c0000003-0000-0000-0000-000000000005', 'Rideshare',          'c0000001-0000-0000-0000-000000000002', null, null, true),

-- ── FOOD & DINING ─────────────────────────────────────────
('c0000004-0000-0000-0000-000000000001', 'Groceries',          'c0000001-0000-0000-0000-000000000003', null, null, true),
('c0000004-0000-0000-0000-000000000002', 'Restaurants',        'c0000001-0000-0000-0000-000000000003', null, null, true),
('c0000004-0000-0000-0000-000000000003', 'Coffee',             'c0000001-0000-0000-0000-000000000003', null, null, true),
('c0000004-0000-0000-0000-000000000004', 'Alcohol',            'c0000001-0000-0000-0000-000000000003', null, null, true),
('c0000004-0000-0000-0000-000000000005', 'Fast Food',          'c0000001-0000-0000-0000-000000000003', null, null, true),

-- ── SUBSCRIPTIONS ─────────────────────────────────────────
('c0000007-0000-0000-0000-000000000001', 'Streaming Video',    'c0000001-0000-0000-0000-000000000007', null, null, true),
('c0000007-0000-0000-0000-000000000002', 'Streaming Music',    'c0000001-0000-0000-0000-000000000007', null, null, true),
('c0000007-0000-0000-0000-000000000003', 'Software / SaaS',    'c0000001-0000-0000-0000-000000000007', null, null, true),
('c0000007-0000-0000-0000-000000000004', 'News & Magazines',   'c0000001-0000-0000-0000-000000000007', null, null, true),
('c0000007-0000-0000-0000-000000000005', 'Cloud Storage',      'c0000001-0000-0000-0000-000000000007', null, null, true),
('c0000007-0000-0000-0000-000000000006', 'Gaming',             'c0000001-0000-0000-0000-000000000007', null, null, true),

-- ── INCOME ────────────────────────────────────────────────
('c0000013-0000-0000-0000-000000000001', 'Employment Income',  'c0000001-0000-0000-0000-000000000013', null, null, true),
('c0000013-0000-0000-0000-000000000002', 'Rental Income',      'c0000001-0000-0000-0000-000000000013', null, null, true),
('c0000013-0000-0000-0000-000000000003', 'Investment Income',  'c0000001-0000-0000-0000-000000000013', null, null, true),
('c0000013-0000-0000-0000-000000000004', 'Tax Refund',         'c0000001-0000-0000-0000-000000000013', null, null, true),
('c0000013-0000-0000-0000-000000000005', 'Other Income',       'c0000001-0000-0000-0000-000000000013', null, null, true),

-- ── TAXES (Ottawa-specific) ───────────────────────────────
('c0000019-0000-0000-0000-000000000001', 'Federal Income Tax', 'c0000001-0000-0000-0000-000000000019', null, null, true),
('c0000019-0000-0000-0000-000000000002', 'Provincial Income Tax','c0000001-0000-0000-0000-000000000019',null, null, true),
('c0000019-0000-0000-0000-000000000003', 'CPP Contributions',  'c0000001-0000-0000-0000-000000000019', null, null, true),
('c0000019-0000-0000-0000-000000000004', 'EI Premiums',        'c0000001-0000-0000-0000-000000000019', null, null, true),
('c0000019-0000-0000-0000-000000000005', 'Property Tax (Ottawa)','c0000001-0000-0000-0000-000000000001',null, null, true)
on conflict do nothing;

-- ── SEED: Income sources ───────────────────────────────────
insert into income_sources (name, type, gross_cad, frequency, notes) values
  ('Employment Salary',    'employment', 184000, 'biweekly',  'Ottawa, ON — ~$184k gross annual'),
  ('Rental Property',      'rental',      24000, 'monthly',   '~$2k/month rental income')
on conflict do nothing;

-- ── SEED: Goals ───────────────────────────────────────────
insert into goals (name, type, description, target_amount, target_date, icon, color, sort_order) values
  (
    'Mortgage Qualification',
    'mortgage_qual',
    'Down payment + stress-test buffer for Ottawa market purchase',
    120000.00,
    '2026-12-31',
    'home',
    '#6366f1',
    1
  ),
  (
    'Equalization Payment Fund',
    'equalization',
    'Reserve fund for equalization payment obligations',
    50000.00,
    '2026-06-30',
    'scale',
    '#f59e0b',
    2
  ),
  (
    'Travel Fund',
    'travel',
    'Annual travel and vacation budget',
    10000.00,
    '2025-12-31',
    'plane',
    '#0ea5e9',
    3
  ),
  (
    'Emergency Fund',
    'emergency',
    '6 months of expenses',
    30000.00,
    null,
    'shield',
    '#22c55e',
    4
  )
on conflict do nothing;
