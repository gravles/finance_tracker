-- ============================================================
-- User-specific data corrections
-- ============================================================

-- 1. Align = physiotherapy → Health & Fitness
insert into category_aliases (alias, category_id)
values ('align', 'c0000001-0000-0000-0000-000000000005')
on conflict (alias) do update set category_id = excluded.category_id;

-- 2. Manulife = medical insurance reimbursement → Health & Fitness
insert into category_aliases (alias, category_id)
values
  ('manulife',         'c0000001-0000-0000-0000-000000000005'),
  ('eft manulife',     'c0000001-0000-0000-0000-000000000005'),
  ('pshcp',            'c0000001-0000-0000-0000-000000000005'),
  ('eft pshcp rssfp',  'c0000001-0000-0000-0000-000000000005'),
  ('rssfp',            'c0000001-0000-0000-0000-000000000005')
on conflict (alias) do update set category_id = excluded.category_id;

-- 3. Un-ignore Manulife and PSHCP transactions (Simplifi excluded them
--    but user wants to track medical insurance reimbursements)
update transactions
set
  is_ignored  = false,
  category_id = 'c0000001-0000-0000-0000-000000000005'
where
  lower(payee) like '%manulife%'
  or lower(payee) like '%pshcp%'
  or lower(payee) like '%rssfp%';

-- 4. Tag bonus payroll deposits so projections don't treat as recurring salary
--    Gartner bonus: positive, large amount, payee contains 'gartner'
--    We tag it so the dashboard can separate base salary from bonuses
update transactions
set
  tags  = array_append(tags, 'bonus'),
  notes = 'Annual bonus — exclude from recurring income projections'
where
  lower(payee) like '%gartner%'
  and amount > 0
  -- bonus is materially larger than a biweekly pay (~$3,500–4,500 net)
  -- a one-off large deposit indicates bonus
  and amount > 5000;

-- 5. Fix Align transactions already imported
update transactions
set category_id = 'c0000001-0000-0000-0000-000000000005'
where lower(payee) like '%align%'
  and category_id in (
    -- was categorized as Dining & Drinks
    'c0000001-0000-0000-0000-000000000003',
    'c0000004-0000-0000-0000-000000000002'
  );
