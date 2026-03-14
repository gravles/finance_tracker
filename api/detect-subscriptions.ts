/**
 * POST /api/detect-subscriptions
 *
 * Pure pattern-matching subscription detection from transaction history.
 * No Claude needed — groups by merchant, analyzes intervals, classifies frequency.
 *
 * Response:
 *   { detected: DetectedSub[] }
 */
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

interface DetectedSub {
  merchant_name: string
  amount: number
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
  confidence: 'high' | 'medium' | 'low'
  occurrence_count: number
  last_seen: string
  category_id: string | null
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Missing env vars' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Fetch all non-ignored, non-transfer debit transactions
  const { data: txns, error } = await supabase
    .from('transactions')
    .select('merchant_name, payee, amount, date, category_id')
    .eq('is_ignored', false)
    .eq('is_transfer', false)
    .lt('amount', 0)
    .order('date', { ascending: true })

  if (error) return json({ error: error.message }, 500)
  if (!txns?.length) return json({ detected: [] })

  // Group by normalized merchant name
  const groups = new Map<string, { dates: string[]; amounts: number[]; category_id: string | null }>()

  for (const tx of txns) {
    const key = (tx.merchant_name || tx.payee || '').trim().toLowerCase()
    if (!key) continue

    const group = groups.get(key) ?? { dates: [], amounts: [], category_id: null }
    group.dates.push(tx.date)
    group.amounts.push(Math.abs(tx.amount))
    if (tx.category_id) group.category_id = tx.category_id
    groups.set(key, group)
  }

  // Analyze groups with 3+ transactions
  const detected: DetectedSub[] = []

  for (const [merchant, group] of groups) {
    if (group.dates.length < 3) continue

    // Sort dates and compute intervals
    const sorted = group.dates.sort()
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const d1 = new Date(sorted[i - 1]).getTime()
      const d2 = new Date(sorted[i]).getTime()
      intervals.push(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)))
    }

    // Median interval
    const sortedIntervals = [...intervals].sort((a, b) => a - b)
    const median = sortedIntervals[Math.floor(sortedIntervals.length / 2)]

    // Classify frequency
    const frequency = classifyFrequency(median)
    if (!frequency) continue

    // Amount consistency — compute coefficient of variation
    const amounts = group.amounts
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length
    const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - avgAmount) ** 2, 0) / amounts.length)
    const cv = avgAmount > 0 ? stdDev / avgAmount : 1

    // Confidence scoring
    let confidence: 'high' | 'medium' | 'low'
    if (group.dates.length >= 4 && cv < 0.1) {
      confidence = 'high'
    } else if (group.dates.length >= 3 && cv < 0.3) {
      confidence = 'medium'
    } else {
      confidence = 'low'
    }

    // Format merchant name (title case the original)
    const displayName = titleCase(merchant)

    detected.push({
      merchant_name: displayName,
      amount: Math.round(avgAmount * 100) / 100,
      frequency,
      confidence,
      occurrence_count: group.dates.length,
      last_seen: sorted[sorted.length - 1],
      category_id: group.category_id,
    })
  }

  // Sort by confidence then amount
  const order = { high: 0, medium: 1, low: 2 }
  detected.sort((a, b) => order[a.confidence] - order[b.confidence] || b.amount - a.amount)

  return json({ detected })
}

function classifyFrequency(medianDays: number): DetectedSub['frequency'] | null {
  if (medianDays >= 6 && medianDays <= 8) return 'weekly'
  if (medianDays >= 12 && medianDays <= 16) return 'biweekly'
  if (medianDays >= 25 && medianDays <= 35) return 'monthly'
  if (medianDays >= 85 && medianDays <= 95) return 'quarterly'
  if (medianDays >= 350 && medianDays <= 380) return 'annual'
  return null
}

function titleCase(str: string): string {
  return str.replace(/\w\S*/g, txt =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
  )
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
