import { useEffect, useState } from 'react'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD } from '@/lib/utils'
import type { BudgetPeriod } from '@/types'

interface Alert {
  category: string
  type: 'over_budget' | 'trending_up' | 'spike'
  severity: 'warning' | 'danger'
  message: string
}

export default function SpendingAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => {
    async function analyze() {
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
        .toISOString().split('T')[0]

      const [budgetRes, txRes, catRes] = await Promise.all([
        supabase.from('budget_periods').select('*').eq('period_start', monthStart),
        supabase
          .from('transactions')
          .select('amount, date, category:categories(id, name, parent_id)')
          .gte('date', threeMonthsAgo)
          .eq('is_ignored', false)
          .eq('is_transfer', false)
          .lt('amount', 0),
        supabase.from('categories').select('id, name').is('parent_id', null),
      ])

      const budgets = (budgetRes.data ?? []) as BudgetPeriod[]
      const budgetMap = new Map(budgets.map(b => [b.category_id, b.budgeted]))
      const catNames = new Map((catRes.data ?? []).map(c => [c.id, c.name]))

      // Compute per-parent-category spending for current month and 3-month avg
      const currentMonthSpend = new Map<string, number>()
      const prevMonthsSpend = new Map<string, number[]>() // parent_id -> [month totals]
      const txns = txRes.data ?? []

      for (const tx of txns) {
        const cat = tx.category as unknown as { id: string; name: string; parent_id: string | null } | null
        const parentId = cat?.parent_id ?? cat?.id ?? 'uncategorized'
        const amt = Math.abs(tx.amount)
        const txMonth = tx.date.slice(0, 7)
        const currentMonth = monthStart.slice(0, 7)

        if (txMonth === currentMonth) {
          currentMonthSpend.set(parentId, (currentMonthSpend.get(parentId) ?? 0) + amt)
        } else {
          const arr = prevMonthsSpend.get(parentId) ?? [0, 0, 0]
          // Map to index: most recent prev = 0, etc.
          const monthIdx = (() => {
            const d = new Date(tx.date)
            const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) - 1
            return Math.min(diff, 2)
          })()
          if (monthIdx >= 0 && monthIdx < 3) arr[monthIdx] += amt
          prevMonthsSpend.set(parentId, arr)
        }
      }

      const result: Alert[] = []

      for (const [catId, spent] of currentMonthSpend) {
        const name = catNames.get(catId) ?? 'Unknown'
        const budget = budgetMap.get(catId)

        // Over budget alert
        if (budget && spent > budget) {
          result.push({
            category: name,
            type: 'over_budget',
            severity: 'danger',
            message: `${name} is ${formatCAD(spent - budget)} over budget (${formatCAD(spent)} / ${formatCAD(budget)})`,
          })
        } else if (budget && spent >= budget * 0.8) {
          result.push({
            category: name,
            type: 'over_budget',
            severity: 'warning',
            message: `${name} is at ${((spent / budget) * 100).toFixed(0)}% of budget (${formatCAD(spent)} / ${formatCAD(budget)})`,
          })
        }

        // Trending up vs 3-month average
        const prev = prevMonthsSpend.get(catId)
        if (prev) {
          const nonZero = prev.filter(v => v > 0)
          if (nonZero.length >= 2) {
            const avg = nonZero.reduce((s, v) => s + v, 0) / nonZero.length
            if (avg > 0 && spent > avg * 1.3) {
              result.push({
                category: name,
                type: 'trending_up',
                severity: spent > avg * 1.5 ? 'danger' : 'warning',
                message: `${name} spending is ${((spent / avg - 1) * 100).toFixed(0)}% above 3-month average (${formatCAD(spent)} vs ${formatCAD(avg)} avg)`,
              })
            }
          }
        }
      }

      // Sort by severity
      result.sort((a, b) => (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1))
      setAlerts(result)
    }
    analyze()
  }, [])

  if (alerts.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400">Spending Alerts</h3>
      {alerts.map((alert, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 px-4 py-3 rounded-lg ${
            alert.severity === 'danger'
              ? 'bg-red-500/10 border border-red-500/20'
              : 'bg-amber-500/10 border border-amber-500/20'
          }`}
        >
          {alert.type === 'over_budget' ? (
            <AlertTriangle size={16} className={alert.severity === 'danger' ? 'text-red-400 mt-0.5' : 'text-amber-400 mt-0.5'} />
          ) : (
            <TrendingUp size={16} className={alert.severity === 'danger' ? 'text-red-400 mt-0.5' : 'text-amber-400 mt-0.5'} />
          )}
          <span className={`text-sm ${alert.severity === 'danger' ? 'text-red-300' : 'text-amber-300'}`}>
            {alert.message}
          </span>
        </div>
      ))}
    </div>
  )
}
