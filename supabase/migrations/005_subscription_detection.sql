-- Add detection metadata columns to subscriptions
alter table subscriptions
  add column if not exists detection_confidence text check (detection_confidence in ('high', 'medium', 'low')),
  add column if not exists detected_at timestamptz,
  add column if not exists occurrence_count integer;
