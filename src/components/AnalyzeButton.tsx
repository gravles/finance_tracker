import { useState } from 'react'
import { Sparkles, AlertTriangle, CheckCircle2, RefreshCw, Eye, Zap } from 'lucide-react'
import { formatCAD } from '@/lib/utils'
import type { Proposal } from '../../api/analyze'

interface Anomaly { payee: string; date: string; amount: number; note: string }

interface BatchResponse {
  processed: number
  updated: number
  proposals: Proposal[]
  anomalies: Anomaly[]
  hasMore: boolean
  remaining: number | '…'
  estimatedCostCAD: number
  dryRun: boolean
  tokens?: { input: number; output: number }
  nextOffset?: number
  error?: string
}

interface RunState {
  totalProcessed: number
  totalUpdated: number
  allAnomalies: Anomaly[]
  remaining: number
  totalCostCAD: number
}

interface Props {
  force?: boolean
  label?: string
  onComplete?: () => void
}

type Stage =
  | { status: 'idle' }
  | { status: 'dry-running' }
  | { status: 'dry-done'; proposals: Proposal[]; costCAD: number }
  | { status: 'running'; state: RunState }
  | { status: 'done'; state: RunState }
  | { status: 'error'; message: string }

export default function AnalyzeButton({ force = false, label, onComplete }: Props) {
  const [stage, setStage] = useState<Stage>({ status: 'idle' })

  // ── Dry run: fetch ONE batch, show proposals for validation ──────────────
  async function runDry() {
    setStage({ status: 'dry-running' })
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, force, batchSize: 20 }),
      })
      const data = await res.json().catch(() => ({})) as BatchResponse
      if (!res.ok || data.error) throw new Error(data.error ?? `${res.status} ${res.statusText}`)
      setStage({ status: 'dry-done', proposals: data.proposals, costCAD: data.estimatedCostCAD })
    } catch (e) {
      setStage({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Full run: loop until hasMore === false ────────────────────────────────
  async function runFull() {
    const state: RunState = { totalProcessed: 0, totalUpdated: 0, allAnomalies: [], remaining: 0, totalCostCAD: 0 }
    setStage({ status: 'running', state: { ...state } })

    let hasMore = true
    let offset = 0
    while (hasMore) {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun: false, force, batchSize: 50, offset }),
        })
        const data = await res.json().catch(() => ({})) as BatchResponse
        if (!res.ok || data.error) throw new Error(data.error ?? `${res.status} ${res.statusText}`)

        state.totalProcessed += data.processed
        state.totalUpdated   += data.updated
        state.allAnomalies.push(...data.anomalies)
        state.remaining       = typeof data.remaining === 'number' ? data.remaining : 0
        state.totalCostCAD   += data.estimatedCostCAD
        hasMore = data.hasMore
        offset = data.nextOffset ?? (offset + data.processed)

        setStage({ status: 'running', state: { ...state } })
        if (data.processed === 0) break
      } catch (e) {
        setStage({ status: 'error', message: e instanceof Error ? e.message : String(e) })
        return
      }
    }

    setStage({ status: 'done', state: { ...state } })
    onComplete?.()
  }

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (stage.status === 'idle' || stage.status === 'error') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runDry}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Eye size={14} /> Dry run (preview 20)
          </button>
          <button
            onClick={runFull}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Sparkles size={14} /> {label ?? 'Analyze all'}
          </button>
        </div>
        {stage.status === 'error' && (
          <p className="text-xs text-red-400">{stage.message}</p>
        )}
      </div>
    )
  }

  // ── Dry running spinner ───────────────────────────────────────────────────
  if (stage.status === 'dry-running') {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-300 py-1">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        Previewing 20 transactions…
      </div>
    )
  }

  // ── Dry run results ───────────────────────────────────────────────────────
  if (stage.status === 'dry-done') {
    const { proposals, costCAD } = stage
    const recurring  = proposals.filter(p => p.is_recurring)
    const anomalies  = proposals.filter(p => p.anomaly)
    const recatted   = proposals.filter(p => p.current_category !== p.proposed_category)

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-medium text-white">
            Preview — {proposals.length} transactions
          </p>
          <span className="text-xs text-gray-500 font-mono">
            This batch: ~${costCAD.toFixed(4)} CAD
          </span>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded-full">
            {recatted.length} re-categorized
          </span>
          <span className="px-2 py-1 bg-green-500/15 text-green-400 rounded-full">
            {recurring.length} recurring detected
          </span>
          {anomalies.length > 0 && (
            <span className="px-2 py-1 bg-amber-500/15 text-amber-400 rounded-full">
              {anomalies.length} anomalies
            </span>
          )}
        </div>

        {/* Proposal table */}
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="text-left px-3 py-2 font-medium">Payee → Merchant</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Flags</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {proposals.map(p => (
                <tr key={p.id} className="hover:bg-gray-800/20">
                  <td className="px-3 py-2">
                    <div className="text-gray-400 truncate max-w-[160px]">{p.payee}</div>
                    <div className="text-white font-medium">{p.merchant_name}</div>
                  </td>
                  <td className="px-3 py-2 max-w-[140px]">
                    {p.current_category && p.current_category !== p.proposed_category && (
                      <div className="text-gray-600 line-through truncate">{p.current_category}</div>
                    )}
                    <div className={p.current_category !== p.proposed_category ? 'text-indigo-300' : 'text-gray-300'}>
                      {p.proposed_category ?? '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      {p.is_recurring && (
                        <span className="text-green-400">↺ recurring</span>
                      )}
                      {p.anomaly && (
                        <span className="text-amber-400 flex items-center gap-1">
                          <AlertTriangle size={10} /> {p.anomaly}
                        </span>
                      )}
                      {p.confidence === 'low' && (
                        <span className="text-gray-600">? low confidence</span>
                      )}
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${
                    p.amount >= 0 ? 'text-green-400' : 'text-gray-200'
                  }`}>
                    {formatCAD(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runFull}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Zap size={14} /> Looks good — analyze all
          </button>
          <button
            onClick={() => setStage({ status: 'idle' })}
            className="text-sm text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
        <p className="text-xs text-gray-600">
          Full run estimated: ~$0.20 CAD per 1,000 transactions (Haiku model)
        </p>
      </div>
    )
  }

  // ── Running ───────────────────────────────────────────────────────────────
  if (stage.status === 'running') {
    const { state } = stage
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-sm text-gray-300">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span>{state.totalProcessed.toLocaleString()} transactions analyzed…</span>
        </div>
        {/* Indeterminate progress bar — no expensive COUNT query */}
        <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div className="h-1.5 bg-indigo-500 rounded-full animate-pulse w-full opacity-60" />
        </div>
        <div className="flex justify-between text-xs text-gray-600">
          <span>{state.allAnomalies.length} anomalies found so far</span>
          <span>~${state.totalCostCAD.toFixed(3)} CAD</span>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  const { state } = stage
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
        <CheckCircle2 size={16} /> Analysis complete
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {[
          { label: 'Processed', value: state.totalProcessed.toLocaleString() },
          { label: 'Updated', value: state.totalUpdated.toLocaleString() },
          { label: 'Anomalies', value: state.allAnomalies.length.toString(), highlight: state.allAnomalies.length > 0 },
          { label: 'Total cost', value: `$${state.totalCostCAD.toFixed(3)} CAD` },
        ].map(({ label, value, highlight }) => (
          <div key={label} className="bg-gray-800/60 rounded-lg px-3 py-2">
            <div className="text-gray-400 text-xs">{label}</div>
            <div className={`font-semibold ${highlight ? 'text-amber-400' : 'text-white'}`}>{value}</div>
          </div>
        ))}
      </div>

      {state.allAnomalies.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
            <AlertTriangle size={14} /> Flagged transactions
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {state.allAnomalies.map((a, i) => (
              <div key={i} className="bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2 text-xs">
                <div className="flex justify-between mb-0.5">
                  <span className="font-medium text-white">{a.payee}</span>
                  <span className={`font-mono ${a.amount >= 0 ? 'text-green-400' : 'text-gray-300'}`}>
                    {formatCAD(a.amount)}
                  </span>
                </div>
                <div className="text-gray-500">{a.date}</div>
                <div className="text-amber-300/80 mt-1">{a.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setStage({ status: 'idle' })}
        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
      >
        <RefreshCw size={11} /> Run again
      </button>
    </div>
  )
}
