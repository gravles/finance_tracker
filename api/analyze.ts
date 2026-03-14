/**
 * POST /api/analyze
 *
 * Claude-powered transaction analysis pipeline.
 * Fetches uncategorized (or all, if force=true) transactions,
 * sends them to Claude in batches, and writes back:
 *   - category_id  (matched to our categories)
 *   - merchant_name (normalized / cleaned up)
 *   - is_recurring  (subscription/bill pattern detected)
 *   - tags          (e.g. ["anomaly", "large-purchase"])
 *   - notes         (Claude's reasoning for anomalies)
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const BATCH_SIZE = 75  // transactions per Claude call

interface AnalyzeRequest {
  force?: boolean   // if true, re-analyze already-categorized transactions too
  limit?: number    // max transactions to process this run (default 300)
}

interface ClaudeTransaction {
  id: string
  category_id: string | null
  merchant_name: string | null
  is_recurring: boolean
  anomaly: string | null   // null = normal, string = description
  tags: string[]
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!supabaseUrl || !supabaseKey || !anthropicKey) {
    return json({ error: 'Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY' }, 500)
  }

  const body: AnalyzeRequest = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
  const force = body.force ?? false
  const limit = body.limit ?? 300

  const supabase = createClient(supabaseUrl, supabaseKey)
  const anthropic = new Anthropic({ apiKey: anthropicKey })

  // ── Fetch categories so Claude can assign exact IDs ────────────────────────
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

  // ── Fetch transactions to analyze ──────────────────────────────────────────
  let query = supabase
    .from('transactions')
    .select('id, date, payee, amount, memo, category_id')
    .eq('is_ignored', false)
    .eq('is_transfer', false)
    .order('date', { ascending: false })
    .limit(limit)

  if (!force) {
    query = query.is('category_id', null)
  }

  const { data: transactions, error: txError } = await query

  if (txError) return json({ error: txError.message }, 500)
  if (!transactions?.length) return json({ processed: 0, updated: 0, anomalies: [] })

  // ── Process in batches ─────────────────────────────────────────────────────
  let totalUpdated = 0
  const allAnomalies: { payee: string; date: string; amount: number; note: string }[] = []

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE)

    const prompt = buildPrompt(batch, categoryList)

    let claudeResult: ClaudeTransaction[] = []
    try {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: prompt,
        }],
        system: `You are a financial data analyst. You categorize transactions, normalize merchant names,
detect recurring subscriptions/bills, and flag anomalies. Always respond with valid JSON only — no prose.`,
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      // Extract JSON array from response (Claude sometimes wraps in markdown)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        claudeResult = JSON.parse(jsonMatch[0]) as ClaudeTransaction[]
      }
    } catch (e) {
      console.error('Claude batch error:', e)
      continue
    }

    // ── Write results back to Supabase ─────────────────────────────────────
    const updates = claudeResult
      .filter(r => r.id)
      .map(r => ({
        id: r.id,
        category_id: r.category_id,
        merchant_name: r.merchant_name,
        is_recurring: r.is_recurring ?? false,
        tags: r.tags ?? [],
        notes: r.anomaly ?? null,
      }))

    if (updates.length) {
      const { count } = await supabase
        .from('transactions')
        .upsert(updates, { onConflict: 'id' })
        .select('id', { count: 'exact', head: true })

      totalUpdated += count ?? 0
    }

    // Collect anomalies for the response summary
    for (const r of claudeResult) {
      if (r.anomaly) {
        const tx = batch.find(t => t.id === r.id)
        if (tx) {
          allAnomalies.push({
            payee: tx.payee,
            date: tx.date,
            amount: tx.amount,
            note: r.anomaly,
          })
        }
      }
    }
  }

  return json({
    processed: transactions.length,
    updated: totalUpdated,
    anomalies: allAnomalies,
  })
}

function buildPrompt(
  transactions: { id: string; date: string; payee: string; amount: number; memo: string | null }[],
  categories: { id: string; name: string }[],
): string {
  return `Analyze these ${transactions.length} financial transactions for a user in Ottawa, Canada.

## Available Categories
${JSON.stringify(categories, null, 2)}

## Transactions to Analyze
${JSON.stringify(transactions.map(t => ({
  id: t.id,
  date: t.date,
  payee: t.payee,
  amount: t.amount,
  memo: t.memo,
})), null, 2)}

## Instructions

For each transaction return a JSON array with one object per transaction containing:

- **id**: the transaction UUID (unchanged)
- **category_id**: the UUID from the categories list that best fits. Use null only if truly unclassifiable.
- **merchant_name**: cleaned-up merchant name. Strip codes/locations/card suffixes.
  Examples: "AMZN MKTP CA*1234 SEATTLE" → "Amazon", "TIM HORTONS #1234 OTTAWA ON" → "Tim Hortons",
  "NETFLIX.COM" → "Netflix", "UBER* TRIP" → "Uber"
- **is_recurring**: true if this looks like a subscription, bill, or regular charge
  (e.g. streaming, insurance, phone bill, gym membership, utilities)
- **anomaly**: null for normal transactions. A short string description for:
  - Unusually large amounts (>$1000 for a single merchant that isn't rent/mortgage/insurance)
  - Potential duplicate charges (same payee, very close dates)
  - Suspicious or unrecognized merchants
  - Charges at odd hours or in unexpected currencies
- **tags**: array of relevant tags from: ["recurring", "anomaly", "large-purchase",
  "travel", "tax-deductible", "rental-expense", "business"]

Context about this user:
- Based in Ottawa, Ontario, Canada
- Income: ~$184k salary + ~$24k rental income
- Common merchants: Canadian grocery stores (Loblaws, Metro, FreshCo),
  coffee shops, Ottawa-area restaurants, WestJet/Air Canada for travel
- Negative amounts = expenses, positive = income/refunds

Return ONLY a valid JSON array. No markdown, no explanation.`
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
