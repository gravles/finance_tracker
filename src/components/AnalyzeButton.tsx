import { useState } from 'react'
import { Sparkles, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { formatCAD } from '@/lib/utils'

interface Anomaly {
  payee: string
  date: string
  amount: number
  note: string
}

interface AnalysisResult {
  processed: number
  updated: number
  anomalies: Anomaly[]
}

interface Props {
  /** If true, re-analyze already-categorized transactions too */
  force?: boolean
  label?: string
  onComplete?: (result: AnalysisResult) => void
}

export default function AnalyzeButton({ force = false, label, onComplete }: Props) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'done'; result: AnalysisResult }
    | { status: 'error'; message: string }
  >({ status: 'idle' })

  async function run() {
    setState({ status: 'running' })
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force, limit: 300 }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const result = await res.json() as AnalysisResult
      setState({ status: 'done', result })
      onComplete?.(result)
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  if (state.status === 'idle' || state.status === 'error') {
    return (
      <div className="space-y-2">
        <button
          onClick={run}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Sparkles size={15} />
          {label ?? 'Analyze with Claude'}
        </button>
        {state.status === 'error' && (
          <p className="text-xs text-red-400">{state.message}</p>
        )}
      </div>
    )
  }

  if (state.status === 'running') {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-300 py-1">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span>Claude is analyzing your transactions — categories, merchants, anomalies…</span>
      </div>
    )
  }

  const { result } = state
  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
        <CheckCircle2 size={16} />
        Analysis complete — {result.updated} transactions updated
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="text-gray-400 text-xs">Processed</div>
          <div className="text-white font-semibold">{result.processed}</div>
        </div>
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="text-gray-400 text-xs">Categorized / updated</div>
          <div className="text-white font-semibold">{result.updated}</div>
        </div>
      </div>

      {/* Anomalies */}
      {result.anomalies.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
            <AlertTriangle size={14} />
            {result.anomalies.length} anomalies flagged
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {result.anomalies.map((a, i) => (
              <div key={i} className="bg-amber-400/5 border border-amber-400/20 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-center justify-between mb-0.5">
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

      {result.anomalies.length === 0 && (
        <p className="text-xs text-gray-500">No anomalies detected.</p>
      )}

      {/* Run again */}
      <button
        onClick={() => setState({ status: 'idle' })}
        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
      >
        <RefreshCw size={11} /> Run again
      </button>
    </div>
  )
}
