/**
 * POST /api/analyze
 *
 * Processes ONE batch of transactions per call to stay within
 * Vercel Edge Function's 25s timeout. The client loops until
 * hasMore === false.
 *
 * Request:  { force?: bool, batchSize?: number }
 * Response: { processed, updated, anomalies, hasMore, remaining }
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const DEFAULT_BATCH = 50

interface ClaudeTransaction {
  id: string
  category_id: string | null
  merchant_name: string | null
  is_recurring: boolean
  anomaly: string | null
  tags: string[]
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!supabaseUrl || !supabaseKey || !anthropicKey) {
    return json({ error: 'Missing env vars' }, 500)
  }

  const body = await req.json().catch(() => ({})) as { force?: boolean; batchSize?: number }
  const force = body.force ?? false
  const batchSize = Math.min(body.batchSize ?? DEFAULT_BATCH, 75)

  const supabase = createClient(supabaseUrl, supabaseKey)
  const anthropic = new Anthropic({ apiKey: anthropicKey })

  // ── Categories ────────────────────────────────────────────────────────────
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, parent_id')

  const { data: parentCats } = await supabase
    .from('categories')
    .select('id, name')
    .is('parent_id', null)

  const parentMap = new Map((parentCats ?? []).map(c => [c.id, c.name]))
  const categoryList = (categories ?? []).map(c => ({
    id: c.id,
    name: c.parent_id ? `${parentMap.get(c.parent_id) ?? ''} > ${c.name}` : c.name,
  }))

  // ── Fetch ONE batch ───────────────────────────────────────────────────────
  let query = supabase
    .from('transactions')
    .select('id, date, payee, amount, memo, category_id', { count: 'exact' })
    .eq('is_ignored', false)
    .eq('is_transfer', false)
    .order('date', { ascending: false })
    .limit(batchSize)

  if (!force) query = query.is('category_id', null)

  const { data: transactions, count: totalRemaining, error } = await query
  if (error) return json({ error: error.message }, 500)
  if (!transactions?.length) return json({ processed: 0, updated: 0, anomalies: [], hasMore: false, remaining: 0 })

  // ── Single Claude call ────────────────────────────────────────────────────
  let claudeResult: ClaudeTransaction[] = []

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: `You are a financial data analyst for a user in Ottawa, Canada.
Categorize transactions, normalize merchant names, detect recurring charges, flag anomalies.
Respond with valid JSON array only — no prose, no markdown fences.`,
    messages: [{
      role: 'user',
      content: buildPrompt(transactions, categoryList),
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (jsonMatch) {
    try { claudeResult = JSON.parse(jsonMatch[0]) } catch { /* ignore parse error */ }
  }

  // ── Write back ────────────────────────────────────────────────────────────
  const updates = claudeResult
    .filter(r => r.id)
    .map(r => ({
      id: r.id,
      category_id: r.category_id ?? null,
      merchant_name: r.merchant_name ?? null,
      is_recurring: r.is_recurring ?? false,
      tags: r.tags ?? [],
      notes: r.anomaly ?? null,
    }))

  let updated = 0
  if (updates.length) {
    const { count } = await supabase
      .from('transactions')
      .upsert(updates, { onConflict: 'id' })
      .select('id', { count: 'exact', head: true })
    updated = count ?? 0
  }

  const anomalies = claudeResult
    .filter(r => r.anomaly)
    .map(r => {
      const tx = transactions.find(t => t.id === r.id)
      return { payee: tx?.payee ?? '', date: tx?.date ?? '', amount: tx?.amount ?? 0, note: r.anomaly! }
    })

  // remaining = total matching - what we just processed
  const remaining = Math.max(0, (totalRemaining ?? 0) - transactions.length)

  return json({ processed: transactions.length, updated, anomalies, hasMore: remaining > 0, remaining })
}

function buildPrompt(
  transactions: { id: string; date: string; payee: string; amount: number; memo: string | null }[],
  categories: { id: string; name: string }[],
): string {
  return `Analyze these ${transactions.length} financial transactions for a user in Ottawa, Canada.

## Available Categories
${JSON.stringify(categories, null, 2)}

## Transactions
${JSON.stringify(transactions.map(t => ({ id: t.id, date: t.date, payee: t.payee, amount: t.amount, memo: t.memo })), null, 2)}

## Instructions
Return a JSON array, one object per transaction:
- id: unchanged UUID
- category_id: best matching UUID from categories (null only if truly unclassifiable)
- merchant_name: clean human-readable name. Strip store numbers, locations, card codes.
  "AMZN MKTP CA*1234" → "Amazon", "TIM HORTONS #492 OTTAWA ON" → "Tim Hortons",
  "NETFLIX.COM" → "Netflix", "ENERCARE HOME SERV" → "Enercare"
- is_recurring: true for subscriptions, bills, insurance, utilities, gym memberships
- anomaly: null normally. Short string for: charges >$1000 (non-rent/mortgage),
  suspected duplicates, unrecognized foreign merchants, anything suspicious
- tags: array from ["recurring","anomaly","large-purchase","travel","tax-deductible","rental-expense","business"]

User context: ~$184k salary + $24k rental income. Negative = expense, positive = income/refund.
Common merchants: Loblaws, Metro, FreshCo, Canadian Tire, LCBO, WestJet, Air Canada, Uber Eats.

Return ONLY the JSON array.`
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
