import { formatCAD } from '@/lib/utils'

interface Props {
  budgeted: number
  spent: number
  label?: string
}

export default function BudgetProgressBar({ budgeted, spent, label }: Props) {
  const pct = budgeted > 0 ? (spent / budgeted) * 100 : 0
  const color = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-green-500'
  const textColor = pct > 100 ? 'text-red-400' : pct >= 80 ? 'text-amber-400' : 'text-green-400'

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-300">{label}</span>
          <span className={textColor}>
            {formatCAD(spent)} / {formatCAD(budgeted)}
          </span>
        </div>
      )}
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {budgeted > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{pct.toFixed(0)}%</span>
          <span>
            {pct > 100
              ? `${formatCAD(spent - budgeted)} over`
              : `${formatCAD(budgeted - spent)} remaining`}
          </span>
        </div>
      )}
    </div>
  )
}
