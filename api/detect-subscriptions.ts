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
    .select('merchant_name, payee, amount, date, category_id, is_recurring')
    .eq('is_ignored', false)
    .eq('is_transfer', false)
    .lt('amount', 0)
    .order('date', { ascending: true })

  if (error) return json({ error: error.message }, 500)
  if (!txns?.length) return json({ detected: [] })

  // Normalize merchant names: strip common suffixes, collapse whitespace
  function normalizeMerchant(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(inc|ltd|llc|corp|co|canada|ca|limited|online|payment|pmt)\b\.?/gi, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Group by normalized merchant name, preserving best display name
  const groups = new Map<string, {
    dates: string[]
    amounts: number[]
    category_id: string | null
    displayName: string
    recurringFlags: number  // count of is_recurring=true
  }>()

  for (const tx of txns) {
    const raw = (tx.merchant_name || tx.payee || '').trim()
    if (!raw) continue
    const key = normalizeMerchant(raw)
    if (!key) continue

    const group = groups.get(key) ?? {
      dates: [], amounts: [], category_id: null,
      displayName: raw,
      recurringFlags: 0,
    }
    group.dates.push(tx.date)
    group.amounts.push(Math.abs(tx.amount))
    if (tx.category_id) group.category_id = tx.category_id
    if (tx.is_recurring) group.recurringFlags++
    // Prefer merchant_name over payee for display
    if (tx.merchant_name?.trim()) group.displayName = tx.merchant_name.trim()
    groups.set(key, group)
  }

  const detected: DetectedSub[] = []

  for (const [, group] of groups) {
    const claudeFlagged = group.recurringFlags > 0
    const recurringRatio = group.dates.length > 0 ? group.recurringFlags / group.dates.length : 0

    // Accept with just 2 occurrences if Claude flagged, otherwise need 2+ with good patterns
    if (group.dates.length < 2) continue
    if (!claudeFlagged && group.dates.length < 2) continue

    // Sort dates and compute intervals
    const sorted = group.dates.sort()
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const d1 = new Date(sorted[i - 1]).getTime()
      const d2 = new Date(sorted[i]).getTime()
      const days = Math.round((d2 - d1) / (1000 * 60 * 60 * 24))
      if (days > 0) intervals.push(days)
    }

    // Median interval
    const sortedIntervals = [...intervals].sort((a, b) => a - b)
    const median = sortedIntervals.length > 0
      ? sortedIntervals[Math.floor(sortedIntervals.length / 2)]
      : 30

    // Classify frequency
    let frequency = classifyFrequency(median)

    // If Claude flagged it but frequency detection failed, default to monthly
    if (!frequency && claudeFlagged) {
      frequency = 'monthly'
    }
    if (!frequency) continue

    // Amount consistency — coefficient of variation
    const amounts = group.amounts
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length
    const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - avgAmount) ** 2, 0) / amounts.length)
    const cv = avgAmount > 0 ? stdDev / avgAmount : 1

    // Skip if amounts are wildly inconsistent AND Claude didn't flag it
    // (allow up to 50% CV for variable bills like utilities)
    if (cv > 0.50 && !claudeFlagged) continue
    if (cv > 0.50 && group.dates.length < 3) continue

    // Confidence scoring
    let confidence: 'high' | 'medium' | 'low'
    if (claudeFlagged && group.dates.length >= 3 && cv < 0.20) {
      confidence = 'high'
    } else if (claudeFlagged && recurringRatio >= 0.5) {
      confidence = 'high'
    } else if (claudeFlagged || (group.dates.length >= 3 && cv < 0.30)) {
      confidence = 'medium'
    } else if (group.dates.length >= 2 && cv < 0.15) {
      confidence = 'medium'
    } else {
      confidence = 'low'
    }

    detected.push({
      merchant_name: group.displayName,
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
  if (medianDays >= 4 && medianDays <= 10) return 'weekly'
  if (medianDays >= 11 && medianDays <= 20) return 'biweekly'
  if (medianDays >= 21 && medianDays <= 50) return 'monthly'
  if (medianDays >= 51 && medianDays <= 120) return 'quarterly'
  if (medianDays >= 121 && medianDays <= 400) return 'annual'
  return null
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
