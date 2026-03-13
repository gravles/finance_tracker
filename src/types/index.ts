// ============================================================
// Database entity types — mirrors Supabase schema exactly
// ============================================================

export type AccountType = 'chequing' | 'savings' | 'credit_card' | 'investment' | 'mortgage' | 'loan' | 'other'
export type TransactionType = 'debit' | 'credit' | 'transfer'
export type GoalType = 'savings' | 'mortgage_qual' | 'equalization' | 'travel' | 'emergency' | 'investment' | 'debt_payoff'
export type UploadSource = 'simplifi_csv' | 'python_scraper' | 'manual'
export type UploadStatus = 'pending' | 'processing' | 'complete' | 'failed'
export type IncomeFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual' | 'irregular'
export type SubFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
export type KeepFlag = 'keep' | 'cancel' | 'review'
export type ChatRole = 'user' | 'assistant'

export interface Account {
  id: string
  name: string
  type: AccountType
  institution: string | null
  currency: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  name: string
  parent_id: string | null
  color: string | null
  icon: string | null
  is_system: boolean
  created_at: string
  // joined
  parent?: Category
  children?: Category[]
}

export interface Transaction {
  id: string
  account_id: string | null
  category_id: string | null
  date: string
  payee: string
  amount: number
  memo: string | null
  transaction_type: TransactionType | null
  merchant_name: string | null
  tags: string[]
  is_recurring: boolean
  is_transfer: boolean
  is_ignored: boolean
  notes: string | null
  upload_id: string | null
  simplifi_id: string | null
  import_hash: string | null
  created_at: string
  updated_at: string
  // joined
  account?: Account
  category?: Category
}

export interface Upload {
  id: string
  filename: string
  source: UploadSource
  row_count: number | null
  imported_count: number | null
  skipped_count: number | null
  error_log: unknown[]
  status: UploadStatus
  created_at: string
  completed_at: string | null
}

export interface Subscription {
  id: string
  merchant_name: string
  category_id: string | null
  amount: number
  frequency: SubFrequency
  next_expected: string | null
  last_seen: string | null
  is_active: boolean
  keep_flag: KeepFlag | null
  notes: string | null
  created_at: string
  updated_at: string
  // joined
  category?: Category
}

export interface Goal {
  id: string
  name: string
  type: GoalType
  description: string | null
  target_amount: number
  current_amount: number
  target_date: string | null
  currency: string
  is_active: boolean
  icon: string | null
  color: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface GoalContribution {
  id: string
  goal_id: string
  transaction_id: string | null
  amount: number
  note: string | null
  contributed_at: string
  created_at: string
}

export interface BudgetPeriod {
  id: string
  category_id: string
  period_start: string
  period_end: string
  budgeted: number
  created_at: string
  updated_at: string
}

export interface IncomeSource {
  id: string
  name: string
  type: 'employment' | 'rental' | 'investment' | 'other'
  gross_cad: number
  frequency: IncomeFrequency
  is_active: boolean
  notes: string | null
  created_at: string
}

export interface ChatSession {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  role: ChatRole
  content: string
  created_at: string
}

// ============================================================
// View / derived types
// ============================================================

export interface SpendingByCategory {
  category_id: string
  category_name: string
  category_color: string | null
  parent_name: string | null
  total: number
  count: number
}

export interface MonthlySpend {
  month: string   // "2025-01"
  income: number
  expenses: number
  net: number
}

export interface SimplifiCsvRow {
  Date: string
  Payee: string
  Amount: string
  'Account Name': string  // older exports
  Account: string         // newer exports
  Category: string
  Tags: string
  Note: string
}
