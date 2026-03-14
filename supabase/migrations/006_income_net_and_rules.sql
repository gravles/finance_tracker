-- 006: Net income, categorization rules, recurring expenses
-- =========================================================

-- Feature 1: Optional net income on income_sources
ALTER TABLE income_sources ADD COLUMN net_cad numeric(12,2);

-- Feature 2: Auto-categorization rules
CREATE TABLE categorization_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern       text NOT NULL,
  match_type    text NOT NULL DEFAULT 'contains'
                CHECK (match_type IN ('exact','contains','starts_with')),
  category_id   uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  merchant_name text,
  is_recurring  boolean DEFAULT false,
  priority      integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Feature 3: Recurring (fixed) expenses
CREATE TABLE recurring_expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  amount      numeric(10,2) NOT NULL,
  frequency   text NOT NULL DEFAULT 'monthly'
              CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','annual')),
  is_active   boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at on recurring_expenses
CREATE OR REPLACE FUNCTION update_recurring_expenses_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recurring_expenses_updated_at
  BEFORE UPDATE ON recurring_expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_recurring_expenses_updated_at();
