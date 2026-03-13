import { useState } from 'react'
import { Plus } from 'lucide-react'
import { formatCAD, goalProgress, daysUntil } from '@/lib/utils'
import type { Goal } from '@/types'

interface Props {
  goal: Goal
  showContributeButton?: boolean
  onContribute?: (amount: number, note: string) => void
}

export default function GoalProgressCard({ goal, showContributeButton, onContribute }: Props) {
  const [contributing, setContributing] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const pct = goalProgress(goal.current_amount, goal.target_amount)
  const days = daysUntil(goal.target_date)
  const remaining = goal.target_amount - goal.current_amount

  function submit() {
    const n = parseFloat(amount)
    if (!n || n <= 0) return
    onContribute?.(n, note)
    setAmount('')
    setNote('')
    setContributing(false)
  }

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
            style={{ backgroundColor: `${goal.color ?? '#6366f1'}22` }}
          >
            <span style={{ color: goal.color ?? '#6366f1' }}>
              {iconEmoji(goal.type)}
            </span>
          </div>
          <div>
            <div className="font-medium text-white">{goal.name}</div>
            {goal.description && (
              <div className="text-xs text-gray-500 mt-0.5">{goal.description}</div>
            )}
          </div>
        </div>
        {showContributeButton && (
          <button
            onClick={() => setContributing(!contributing)}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white font-medium">{formatCAD(goal.current_amount)}</span>
          <span className="text-gray-400">of {formatCAD(goal.target_amount)}</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2">
          <div
            className="h-2 rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: goal.color ?? '#6366f1',
            }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{pct.toFixed(1)}% complete</span>
          <span>{formatCAD(remaining)} remaining</span>
        </div>
      </div>

      {/* Deadline */}
      {goal.target_date && (
        <div className="text-xs text-gray-500">
          Target: {new Date(goal.target_date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
          {days !== null && (
            <span className={days < 30 ? 'text-amber-400 ml-1' : 'ml-1'}>
              ({days > 0 ? `${days}d left` : 'overdue'})
            </span>
          )}
        </div>
      )}

      {/* Contribution form */}
      {contributing && (
        <div className="border-t border-gray-800 pt-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Amount (CAD)"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Note (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={submit}
              className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setContributing(false)}
              className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function iconEmoji(type: Goal['type']): string {
  const map: Record<Goal['type'], string> = {
    mortgage_qual: '🏠',
    equalization:  '⚖️',
    travel:        '✈️',
    emergency:     '🛡️',
    savings:       '💰',
    investment:    '📈',
    debt_payoff:   '💳',
  }
  return map[type] ?? '🎯'
}
