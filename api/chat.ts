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
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    .toISOString().split('T')[0]

  const [
    { data: goals },
    { data: incomeSources },
    { data: subscriptions },
    { data: recentTx },
    { data: allTx },
  ] = await Promise.all([
    supabase.from('goals')
      .select('name, type, description, current_amount, target_amount, target_date, currency')
      .eq('is_active', true)
      .order('sort_order'),

    supabase.from('income_sources')
      .select('name, type, gross_cad, frequency')
      .eq('is_active', true),

    supabase.from('subscriptions')
      .select('merchant_name, amount, frequency, keep_flag, is_active')
      .eq('is_active', true),

    // Last 30 transactions verbatim for specific queries
    supabase.from('transactions')
      .select('date, payee, amount, category:categories(name)')
      .eq('is_ignored', false)
      .eq('is_transfer', false)
      .order('date', { ascending: false })
      .limit(30),

    // All transactions in last 6 months for aggregation
    supabase.from('transactions')
      .select('date, amount, category:categories(name)')
      .eq('is_ignored', false)
      .eq('is_transfer', false)
      .gte('date', sixMonthsAgo),
  ])

  // ── Aggregate spending by category × month ────────────────────────────────

  type CatMonth = Record<string, Record<string, number>>
  const spendByCatMonth: CatMonth = {}
  const monthlyTotals: Record<string, { income: number; expenses: number }> = {}

  for (const tx of allTx ?? []) {
    const month = tx.date.slice(0, 7)
    const catName = (tx.category as { name: string } | null)?.name ?? 'Uncategorized'
    const amount = Number(tx.amount)

    // Monthly income/expense totals
    if (!monthlyTotals[month]) monthlyTotals[month] = { income: 0, expenses: 0 }
    if (amount > 0) monthlyTotals[month].income += amount
    else monthlyTotals[month].expenses += Math.abs(amount)

    // Category × month spending (expenses only)
    if (amount < 0) {
      if (!spendByCatMonth[catName]) spendByCatMonth[catName] = {}
      spendByCatMonth[catName][month] = (spendByCatMonth[catName][month] ?? 0) + Math.abs(amount)
    }
  }

  // Sort months
  const months = Object.keys(monthlyTotals).sort()
  const monthlyTable = months.map(m => ({
    month: m,
    income: +monthlyTotals[m].income.toFixed(2),
    expenses: +monthlyTotals[m].expenses.toFixed(2),
    net: +(monthlyTotals[m].income - monthlyTotals[m].expenses).toFixed(2),
  }))

  // Top categories with per-month breakdown
  const categoryBreakdown = Object.entries(spendByCatMonth)
    .map(([cat, byMonth]) => ({
      category: cat,
      total: +Object.values(byMonth).reduce((s, v) => s + v, 0).toFixed(2),
      byMonth: Object.fromEntries(
        Object.entries(byMonth).map(([m, v]) => [m, +v.toFixed(2)])
      ),
    }))
    .sort((a, b) => b.total - a.total)

  const systemPrompt = `You are a personal finance assistant for a user in Ottawa, Ontario, Canada.
You have access to their actual financial data below. Be concise and specific. Always use CAD.

Use Canadian tax context: federal + Ontario provincial rates, CPP, EI premiums.
For mortgage questions: use OSFI stress test (qualifying rate = contract rate + 2%, min 5.25%).
Format money as $X,XXX.XX. Use markdown tables for comparisons.

USER CONTEXT:
- Employer: Gartner Canada (IT consulting). Biweekly salary, ~$184k gross/year (~$7,077/biweekly gross).
- Large one-off Gartner deposits (>$5k net) are annual bonuses — exclude from recurring income projections.
- Rental income: ~$2,000/month from a rental property.
- "Align" = physiotherapy clinic (Health & Fitness), not a restaurant.
- "Manulife" / "PSHCP" / "RSSFP" deposits = medical insurance reimbursements (income/refund).
- Goals priority: 1) Mortgage qualification 2) Equalization payment fund 3) Travel 4) Emergency fund.
- Spending alerts: flag Dining & Drinks > $800/month, Shopping > $600/month.
- For income projections use recurring take-home salary only — exclude bonuses and reimbursements.

## Income Sources
${JSON.stringify(incomeSources ?? [], null, 2)}

## Financial Goals
${JSON.stringify(goals ?? [], null, 2)}

## Active Subscriptions
${JSON.stringify(subscriptions ?? [], null, 2)}

## Monthly Income vs Expenses (last 6 months)
${JSON.stringify(monthlyTable, null, 2)}

## Spending by Category (last 6 months, sorted by total)
${JSON.stringify(categoryBreakdown, null, 2)}

## 30 Most Recent Transactions
${JSON.stringify(recentTx ?? [], null, 2)}`

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const reply = response.content[0].type === 'text' ? response.content[0].text : ''

  return new Response(JSON.stringify({ reply }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
