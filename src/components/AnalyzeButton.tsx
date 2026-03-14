import { useState } from 'react'
import { Sparkles, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { formatCAD } from '@/lib/utils'

interface Anomaly {
  payee: string
  date: string
  amount: number
  note: string
}

interface BatchResponse {
  processed: number
  updated: number
  anomalies: Anomaly[]
  hasMore: boolean
  remaining: number
  error?: string
}

interface RunState {
  totalProcessed: number
  totalUpdated: number
  allAnomalies: Anomaly[]
  remaining: number
  batches: number
}

interface Props {
  force?: boolean
  label?: string
  onComplete?: () => void
}

export default function AnalyzeButton({ force = false, label, onComplete }: Props) {
  const [stage, setStage] = useState<
    | { status: 'idle' }
    | { status: 'running'; state: RunState }
    | { status: 'done'; state: RunState }
    | { status: 'error'; message: string }
  >({ status: 'idle' })

  async function run() {
    const runState: RunState = { totalProcessed: 0, totalUpdated: 0, allAnomalies: [], remaining: 0, batches: 0 }
    setStage({ status: 'running', state: { ...runState } })

    let hasMore = true

    while (hasMore) {
      let result: BatchResponse
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force, batchSize: 50 }),
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        result = await res.json() as BatchResponse
      } catch (e) {
        setStage({ status: 'error', message: e instanceof Error ? e.message : String(e) })
        return
      }

      if (result.error) {
        setStage({ status: 'error', message: result.error })
        return
      }

      runState.totalProcessed += result.processed
      runState.totalUpdated  += result.updated
      runState.allAnomalies.push(...result.anomalies)
      runState.remaining      = result.remaining
      runState.batches       += 1
      hasMore = result.hasMore

      setStage({ status: 'running', state: { ...runState } })

      // If nothing was processed this batch, stop to avoid infinite loop
      if (result.processed === 0) break
    }

    setStage({ status: 'done', state: { ...runState } })
    onComplete?.()
  }

  if (stage.status === 'idle' || stage.status === 'error') {
    return (
      <div className="space-y-2">
        <button
          onClick={run}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Sparkles size={15} />
          {label ?? 'Analyze with Claude'}
        </button>
        {stage.status === 'error' && (
          <p className="text-xs text-red-400">{stage.message}</p>
        )}
      </div>
    )
  }

  if (stage.status === 'running') {
    const { state } = stage
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-sm text-gray-300">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span>
            Analyzing… {state.totalProcessed} done
            {state.remaining > 0 && `, ${state.remaining} remaining`}
          </span>
        </div>
        {/* Progress bar */}
        {state.remaining > 0 && (
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
              style={{
                width: `${Math.round(
                  (state.totalProcessed / (state.totalProcessed + state.remaining)) * 100
                )}%`,
              }}
            />
          </div>
        )}
        <p className="text-xs text-gray-500">
          Claude is categorizing transactions, cleaning merchant names, and looking for anomalies…
        </p>
      </div>
    )
  }

  // Done
  const { state } = stage
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
        <CheckCircle2 size={16} />
        Analysis complete
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="text-gray-400 text-xs">Processed</div>
          <div className="text-white font-semibold">{state.totalProcessed.toLocaleString()}</div>
        </div>
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="text-gray-400 text-xs">Updated</div>
          <div className="text-white font-semibold">{state.totalUpdated.toLocaleString()}</div>
        </div>
        <div className="bg-gray-800/60 rounded-lg px-3 py-2">
          <div className="text-gray-400 text-xs">Anomalies</div>
          <div className={`font-semibold ${state.allAnomalies.length > 0 ? 'text-amber-400' : 'text-white'}`}>
            {state.allAnomalies.length}
          </div>
        </div>
      </div>

      {state.allAnomalies.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
            <AlertTriangle size={14} />
            Flagged transactions
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {state.allAnomalies.map((a, i) => (
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

      {state.allAnomalies.length === 0 && (
        <p className="text-xs text-gray-500">No anomalies detected.</p>
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
