/**
 * POST /api/analyze
 *
 * Claude-powered transaction analysis.
 * One batch per request (50 tx) to stay under Edge 25s timeout.
 * Client loops until hasMore === false.
 *
 * Models:
 *   Haiku  — bulk categorization (~$0.01/batch, ~$1.20 for 6k tx)
 *   Opus   — anomaly explanations only (invoked rarely)
 *
 * Request:
 *   { dryRun?: bool, force?: bool, batchSize?: number }
 *
 * Response:
 *   { processed, updated, proposals?, anomalies, hasMore, remaining, estimatedCostCAD }
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const HAIKU  = 'claude-haiku-4-5-20251001'
const BATCH  = 50

// Rough token cost estimates (USD, converted to CAD ~1.38)
const HAIKU_IN_PER_1M  = 0.80
const HAIKU_OUT_PER_1M = 4.00
const USD_TO_CAD       = 1.38

interface TxRow {
  id: string
  date: string
  payee: string
  amount: number
  memo: string | null
  category_id: string | null
  merchant_name: string | null
}

interface ClaudeResult {
  id: string
  category_id: string | null
  merchant_name: string
  is_recurring: boolean
  anomaly: string | null
  tags: string[]
  confidence: 'high' | 'medium' | 'low'
}

export interface Proposal {
  id: string
  date: string
  payee: string
  amount: number
  current_category: string | null
  proposed_category: string | null
  proposed_category_id: string | null
  merchant_name: string
  is_recurring: boolean
  anomaly: string | null
  confidence: 'high' | 'medium' | 'low'
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
    return json({ error: 'Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY' }, 500)
  }

  const body = await req.json().catch(() => ({})) as {
    dryRun?: boolean
    force?: boolean
    batchSize?: number
  }

  const dryRun    = body.dryRun ?? false
  const force     = body.force ?? false
  const batchSize = Math.min(body.batchSize ?? BATCH, 75)

  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  // ── Categories ────────────────────────────────────────────────────────────
  const [{ data: categories }, { data: parentCats }] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id'),
    supabase.from('categories').select('id, name').is('parent_id', null),
  ])

  const parentMap   = new Map((parentCats ?? []).map(c => [c.id, c.name]))
  const categoryList = (categories ?? []).map(c => ({
    id: c.id,
    name: c.parent_id ? `${parentMap.get(c.parent_id) ?? ''} > ${c.name}` : c.name,
  }))
  const catNameById = new Map(categoryList.map(c => [c.id, c.name]))

  // ── Fetch batch ───────────────────────────────────────────────────────────
  let query = supabase
    .from('transactions')
    .select('id, date, payee, amount, memo, category_id, merchant_name', { count: 'exact' })
    .eq('is_ignored', false)
    .eq('is_transfer', false)
    .order('date', { ascending: false })
    .limit(batchSize)

  // In non-force mode: only transactions missing category OR merchant name
  if (!force) {
    query = query.or('category_id.is.null,merchant_name.is.null')
  }

  const { data: transactions, count: totalRemaining, error } = await query
  if (error) return json({ error: error.message }, 500)
  if (!transactions?.length) {
    return json({ processed: 0, updated: 0, proposals: [], anomalies: [], hasMore: false, remaining: 0, estimatedCostCAD: 0 })
  }

  // ── Call Haiku ────────────────────────────────────────────────────────────
  const txList = transactions as TxRow[]

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 4096,
    system: buildSystem(),
    messages: [{ role: 'user', content: buildPrompt(txList, categoryList) }],
  })

  const inputTokens  = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens
  const costUSD = (inputTokens / 1_000_000 * HAIKU_IN_PER_1M) + (outputTokens / 1_000_000 * HAIKU_OUT_PER_1M)
  const estimatedCostCAD = +(costUSD * USD_TO_CAD).toFixed(4)

  let claudeResults: ClaudeResult[] = []
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const match = text.match(/\[[\s\S]*\]/)
  if (match) {
    try { claudeResults = JSON.parse(match[0]) } catch { /* ignore */ }
  }

  // ── Build proposals (dry run returns these for review) ────────────────────
  const proposals: Proposal[] = claudeResults
    .filter(r => r.id)
    .map(r => {
      const tx = txList.find(t => t.id === r.id)
      return {
        id: r.id,
        date: tx?.date ?? '',
        payee: tx?.payee ?? '',
        amount: tx?.amount ?? 0,
        current_category: tx?.category_id ? catNameById.get(tx.category_id) ?? null : null,
        proposed_category: r.category_id ? catNameById.get(r.category_id) ?? null : null,
        proposed_category_id: r.category_id,
        merchant_name: r.merchant_name,
        is_recurring: r.is_recurring ?? false,
        anomaly: r.anomaly ?? null,
        confidence: r.confidence ?? 'medium',
      }
    })

  const anomalies = proposals.filter(p => p.anomaly)

  // ── Write results (skipped in dry run) ───────────────────────────────────
  let updated = 0
  if (!dryRun) {
    const updates = proposals.map(p => ({
      id: p.id,
      category_id: p.proposed_category_id,
      merchant_name: p.merchant_name || null,
      is_recurring: p.is_recurring,
      tags: [],
      notes: p.anomaly ?? null,
    }))

    if (updates.length) {
      const { count } = await supabase
        .from('transactions')
        .upsert(updates, { onConflict: 'id' })
        .select('id', { count: 'exact', head: true })
      updated = count ?? 0
    }
  }

  const remaining = Math.max(0, (totalRemaining ?? 0) - txList.length)

  return json({
    processed: txList.length,
    updated: dryRun ? 0 : updated,
    proposals: dryRun ? proposals : [],
    anomalies,
    hasMore: remaining > 0,
    remaining,
    estimatedCostCAD,
    dryRun,
    tokens: { input: inputTokens, output: outputTokens },
  })
}

function buildSystem(): string {
  return `You are a financial transaction analyst for a user in Ottawa, Ontario, Canada.
You categorize transactions accurately, normalize merchant names, and detect subscriptions.
Respond with a valid JSON array only — no prose, no markdown, no code fences.`
}

function buildPrompt(
  transactions: TxRow[],
  categories: { id: string; name: string }[],
): string {
  // Compact category list to save tokens — use short IDs
  const catList = categories.map(c => `${c.id.slice(0, 8)} ${c.name}`).join('\n')

  const txData = transactions.map(t => ({
    id: t.id,
    date: t.date,
    p: t.payee,      // short key = fewer tokens
    amt: t.amount,
    memo: t.memo || undefined,
  }))

  return `Categorize ${transactions.length} Canadian transactions. Ottawa user: ~$184k salary + $24k rental income.

CATEGORIES (id_prefix name):
${catList}

TRANSACTIONS:
${JSON.stringify(txData)}

Return JSON array, one object per transaction:
{
  "id": "<full uuid>",
  "category_id": "<full uuid from categories, or null if truly unclassifiable>",
  "merchant_name": "<clean readable name, strip store#/location/card codes>",
  "is_recurring": <true if subscription/bill/insurance/utility/membership>,
  "anomaly": <null or short string if: >$800 non-housing, suspected duplicate, foreign charge>,
  "confidence": "high"|"medium"|"low"
}

Merchant normalization examples:
"AMZN MKTP CA*1234" → "Amazon"
"TIM HORTONS #492 OTTAWA ON" → "Tim Hortons"
"PAYBYPHONE PARKING" → "PayByPhone"
"NETFLIX.COM" → "Netflix"
"PAYPAL *BAMBULAB" → "Bambu Lab"
"BELL MEDIA" → "Bell Media" (Entertainment, NOT food)
"FIZZ (TX. INCL.) MONTREAL QC" → "Fizz Mobile"
"EFT MANULIFE" → "Manulife"
"ZWIFT INC" → "Zwift"

Common Ottawa merchants: Loblaws, Metro, FreshCo, Farm Boy, LCBO, Beer Store,
Canadian Tire, Sport Chek, Dollarama, Rideau Centre, Bayshore Shopping Centre.

USER-SPECIFIC FACTS (apply these every time):
- "Align" = physiotherapy clinic → Health & Fitness (NOT dining)
- "Manulife" / "EFT Manulife" = medical insurance reimbursement → Health & Fitness, positive = refund
- "PSHCP" / "EFT PSHCP RSSFP" = Public Service Health Care Plan reimbursement → Health & Fitness
- "Payroll Deposit Gartner Canada" = primary employer salary (Gartner, IT consulting)
- "Payroll Deposit Canada" = could be government pay or second Gartner deposit — tag as Employment Income
- If a Gartner deposit is unusually large (>$5,000 net) it is likely an annual bonus — add tag "bonus"
- "Paypal *bambulab" = Bambu Lab (3D printer company) → Shopping, NOT Fitness
- "Bell Media" = media/entertainment company → Entertainment or Subscriptions, NOT food
- "Zwift" = indoor cycling training app → Fitness, is_recurring=true
- "Fizz" = Quebec mobile carrier → Utilities (phone), is_recurring=true
- "Fubotv" / "FuboTV" = live TV streaming → Subscriptions (streaming), is_recurring=true
- "Interac E-transfer" = peer-to-peer transfer → Transfers
- Transfer rows (payee = "Transfer Out", "Transfer In") = internal account moves, not expenses

Negative amount = expense. Positive = income, refund, or reimbursement.
Return ONLY the JSON array.`
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
