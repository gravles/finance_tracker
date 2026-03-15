/**
 * Vercel Edge Function: /api/chat
 *
 * Required env vars (set in Vercel dashboard — NOT VITE_ prefixed):
 *   SUPABASE_URL              — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS)
 *   ANTHROPIC_API_KEY         — Claude API key
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({
      reply: 'Chat is not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel environment variables.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (!anthropicKey) {
    return new Response(JSON.stringify({
      reply: 'ANTHROPIC_API_KEY is not set in Vercel environment variables.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const { messages } = await req.json() as { messages: ChatMessage[] }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const anthropic = new Anthropic({ apiKey: anthropicKey })

  // ── Pull financial context in parallel ────────────────────────────────────

  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    .toISOString().split('T')[0]
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const budgetStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const [
    { data: goals },
    { data: incomeSources },
    { data: subscriptions },
    { data: recurringExpenses },
    { data: accounts },
    { data: budgets },
    { data: recentTx },
    { data: allTx },
    { data: merchantTx },
  ] = await Promise.all([
    supabase.from('goals')
      .select('name, type, description, current_amount, target_amount, target_date, currency')
      .eq('is_active', true)
      .order('sort_order'),

    supabase.from('income_sources')
      .select('name, type, gross_cad, net_cad, frequency')
      .eq('is_active', true),

    supabase.from('subscriptions')
      .select('merchant_name, amount, frequency, keep_flag, is_active')
      .eq('is_active', true),

    supabase.from('recurring_expenses')
      .select('name, amount, frequency, is_active, notes')
      .eq('is_active', true),

    supabase.from('accounts')
      .select('name, type, is_active'),

    supabase.from('budget_periods')
      .select('category:categories(name), budgeted, spent')
      .eq('period_start', budgetStart),

    // Last 100 transactions for specific queries
    supabase.from('transactions')
      .select('date, payee, merchant_name, amount, category:categories(name), account:accounts(name), is_recurring')
      .eq('is_ignored', false)
      .eq('is_transfer', false)
      .order('date', { ascending: false })
      .limit(100),

    // All transactions in last 12 months for aggregation
    supabase.from('transactions')
      .select('date, amount, category:categories(name), account:accounts(name)')
      .eq('is_ignored', false)
      .eq('is_transfer', false)
      .gte('date', twelveMonthsAgo),

    // Top merchants by spend for "where do I spend the most" queries
    supabase.from('transactions')
      .select('merchant_name, payee, amount')
      .eq('is_ignored', false)
      .eq('is_transfer', false)
      .lt('amount', 0)
      .gte('date', twelveMonthsAgo),
  ])

  // ── Aggregate spending by category × month ────────────────────────────────

  type CatMonth = Record<string, Record<string, number>>
  const spendByCatMonth: CatMonth = {}
  const monthlyTotals: Record<string, { income: number; expenses: number }> = {}
  const spendByAccount: Record<string, number> = {}

  for (const tx of allTx ?? []) {
    const month = tx.date.slice(0, 7)
    const catName = (tx.category as { name: string } | null)?.name ?? 'Uncategorized'
    const accName = (tx.account as { name: string } | null)?.name ?? 'Unknown'
    const amount = Number(tx.amount)

    if (!monthlyTotals[month]) monthlyTotals[month] = { income: 0, expenses: 0 }
    if (amount > 0) monthlyTotals[month].income += amount
    else monthlyTotals[month].expenses += Math.abs(amount)

    if (amount < 0) {
      if (!spendByCatMonth[catName]) spendByCatMonth[catName] = {}
      spendByCatMonth[catName][month] = (spendByCatMonth[catName][month] ?? 0) + Math.abs(amount)
      spendByAccount[accName] = (spendByAccount[accName] ?? 0) + Math.abs(amount)
    }
  }

  const months = Object.keys(monthlyTotals).sort()
  const monthlyTable = months.map(m => ({
    month: m,
    income: +monthlyTotals[m].income.toFixed(2),
    expenses: +monthlyTotals[m].expenses.toFixed(2),
    net: +(monthlyTotals[m].income - monthlyTotals[m].expenses).toFixed(2),
  }))

  const categoryBreakdown = Object.entries(spendByCatMonth)
    .map(([cat, byMonth]) => ({
      category: cat,
      total: +Object.values(byMonth).reduce((s, v) => s + v, 0).toFixed(2),
      byMonth: Object.fromEntries(
        Object.entries(byMonth).map(([m, v]) => [m, +v.toFixed(2)])
      ),
    }))
    .sort((a, b) => b.total - a.total)

  // ── Top merchants ─────────────────────────────────────────────────────────
  const merchantSpend = new Map<string, { total: number; count: number }>()
  for (const tx of merchantTx ?? []) {
    const name = (tx.merchant_name || tx.payee || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    const entry = merchantSpend.get(key) ?? { total: 0, count: 0 }
    entry.total += Math.abs(tx.amount)
    entry.count++
    merchantSpend.set(key, entry)
  }
  const topMerchants = [...merchantSpend.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 25)
    .map(([name, { total, count }]) => ({ merchant: name, total: +total.toFixed(2), transactions: count }))

  // ── Budget vs actual for current month ────────────────────────────────────
  const budgetSummary = (budgets ?? []).map(b => ({
    category: (b.category as { name: string } | null)?.name ?? 'Unknown',
    budgeted: b.budgeted,
    spent: b.spent ?? 0,
    remaining: +(b.budgeted - (b.spent ?? 0)).toFixed(2),
  }))

  // ── Account spending breakdown ────────────────────────────────────────────
  const accountBreakdown = Object.entries(spendByAccount)
    .sort((a, b) => b[1] - a[1])
    .map(([name, total]) => ({ account: name, total_spend: +total.toFixed(2) }))

  const systemPrompt = `You are a personal finance assistant for a user in Ottawa, Ontario, Canada.
You have access to their actual financial data below. Be specific, actionable, and concise.
Always use CAD. Use markdown formatting: tables, bold, bullet points.

Use Canadian tax context: federal + Ontario provincial rates, CPP, EI premiums.
For mortgage questions: use OSFI stress test (qualifying rate = contract rate + 2%, min 5.25%).
Format money as $X,XXX.XX.

When the user asks about a specific merchant or category, look through the data and give exact figures.
When comparing periods, show the numbers side by side.
When giving advice, be specific with dollar amounts — not vague suggestions.

USER CONTEXT:
- Employer: Gartner Canada (IT consulting). Biweekly salary, ~$184k gross/year.
- Large one-off Gartner deposits (>$5k net) are annual bonuses — exclude from recurring income projections.
- Rental income: ~$2,000/month from a rental property.
- "Align" = physiotherapy clinic (Health & Fitness), not a restaurant.
- "Manulife" / "PSHCP" / "RSSFP" deposits = medical insurance reimbursements.
- Goals priority: 1) Mortgage qualification 2) Equalization payment fund 3) Travel 4) Emergency fund.
- Spending alerts: flag Dining & Drinks > $800/month, Shopping > $600/month.
- Today's date: ${now.toISOString().split('T')[0]}

## Income Sources
${JSON.stringify(incomeSources ?? [], null, 2)}

## Financial Goals
${JSON.stringify(goals ?? [], null, 2)}

## Active Subscriptions (${(subscriptions ?? []).length} total)
${JSON.stringify(subscriptions ?? [], null, 2)}

## Fixed Recurring Expenses (bills, mortgage, insurance)
${JSON.stringify(recurringExpenses ?? [], null, 2)}

## Accounts
${JSON.stringify(accounts ?? [], null, 2)}

## Budget vs Actual (${currentMonth})
${budgetSummary.length > 0 ? JSON.stringify(budgetSummary, null, 2) : 'No budgets set for this month.'}

## Monthly Income vs Expenses (last 12 months)
${JSON.stringify(monthlyTable, null, 2)}

## Spending by Category (last 12 months, sorted by total)
${JSON.stringify(categoryBreakdown, null, 2)}

## Spending by Account (last 12 months)
${JSON.stringify(accountBreakdown, null, 2)}

## Top 25 Merchants by Spend (last 12 months)
${JSON.stringify(topMerchants, null, 2)}

## 100 Most Recent Transactions
${JSON.stringify(recentTx ?? [], null, 2)}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const reply = response.content[0].type === 'text' ? response.content[0].text : ''

  return new Response(JSON.stringify({ reply }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
