/**
 * Vercel Edge Function: /api/chat
 * Proxies chat messages to Claude with finance context injected from Supabase.
 * Runs as an Edge Function for low latency streaming (streaming TODO in v2).
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY!,
)

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { messages } = await req.json() as { messages: ChatMessage[] }

  // Pull lightweight financial context to ground the model
  const [
    { data: goals },
    { data: recentTx },
    { data: subs },
    { data: income },
  ] = await Promise.all([
    supabase.from('goals').select('name, type, current_amount, target_amount, target_date').eq('is_active', true),
    supabase.from('transactions')
      .select('date, payee, amount, category:categories(name)')
      .eq('is_ignored', false)
      .eq('is_transfer', false)
      .order('date', { ascending: false })
      .limit(200),
    supabase.from('subscriptions').select('merchant_name, amount, frequency, keep_flag').eq('is_active', true),
    supabase.from('income_sources').select('name, type, gross_cad, frequency').eq('is_active', true),
  ])

  const systemPrompt = `You are a personal finance assistant for a user based in Ottawa, Ontario, Canada.
You have access to their actual financial data. Answer questions accurately and concisely.
Always show amounts in CAD. Use Canadian tax context (federal + Ontario provincial rates, CPP, EI).

## Income Sources
${JSON.stringify(income ?? [], null, 2)}

## Goals
${JSON.stringify(goals ?? [], null, 2)}

## Active Subscriptions
${JSON.stringify(subs ?? [], null, 2)}

## Recent Transactions (last 200)
${JSON.stringify(recentTx ?? [], null, 2)}

When analysing spending, group by category and show month-over-month trends where relevant.
For mortgage qualification questions, use current Ottawa market context and OSFI stress test rules (qualifying rate = contract rate + 2% or 5.25%, whichever is higher).
For equalization payment questions, be sensitive and factual.
Format numbers as currency. Use markdown tables for comparisons.`

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
