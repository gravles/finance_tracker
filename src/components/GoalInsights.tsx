import { useEffect, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD, toMonthlyAmount } from '@/lib/utils'
import type { Goal, BudgetPeriod, IncomeSource } from '@/types'

interface Insight {
  message: string
  type: 'suggestion' | 'info'
}

export default function GoalInsights() {
  const [insights, setInsights] = useState<Insight[]>([])

  useEffect(() => {
    async function analyze() {
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

      const [goalsRes, incomeRes, budgetRes, txRes] = await Promise.all([
        supabase.from('goals').select('*').eq('is_active', true),
        supabase.from('income_sources').select('*').eq('is_active', true),
        supabase.from('budget_periods').select('*').eq('period_start', monthStart),
        supabase
          .from('transactions')
          .select('amount, category:categories(id, name, parent_id)')
          .gte('date', monthStart)
          .eq('is_ignored', false)
          .eq('is_transfer', false)
          .lt('amount', 0),
      ])

      const goals = (goalsRes.data ?? []) as Goal[]
      const income = (incomeRes.data ?? []) as IncomeSource[]
      const budgets = (budgetRes.data ?? []) as BudgetPeriod[]

      if (goals.length === 0) return

      const monthlyIncome = income.reduce((sum, s) => sum + toMonthlyAmount(s.gross_cad, s.frequency), 0)
      const monthlySpent = (txRes.data ?? []).reduce((s, t) => s + Math.abs(t.amount), 0)
      const monthlySavings = monthlyIncome - monthlySpent

      // Find over-budget categories
      const budgetMap = new Map(budgets.map(b => [b.category_id, b.budgeted]))
      const categorySpend = new Map<string, { name: string; spent: number }>()

      for (const tx of txRes.data ?? []) {
        const cat = tx.category as unknown as { id: string; name: string; parent_id: string | null } | null
        const parentId = cat?.parent_id ?? cat?.id
        if (!parentId) continue
        const existing = categorySpend.get(parentId) ?? { name: cat?.name ?? 'Unknown', spent: 0 }
        existing.spent += Math.abs(tx.amount)
        categorySpend.set(parentId, existing)
      }

      const overBudget: { name: string; over: number }[] = []
      for (const [catId, data] of categorySpend) {
        const budget = budgetMap.get(catId)
        if (budget && data.spent > budget) {
          overBudget.push({ name: data.name, over: data.spent - budget })
        }
      }
      overBudget.sort((a, b) => b.over - a.over)

      const result: Insight[] = []

      // Per-goal insights
      for (const goal of goals) {
        const remaining = goal.target_amount - goal.current_amount
        if (remaining <= 0) continue

        if (goal.target_date) {
          const targetDate = new Date(goal.target_date)
          const monthsLeft = Math.max(1,
            (targetDate.getFullYear() - now.getFullYear()) * 12 +
            (targetDate.getMonth() - now.getMonth())
          )
          const needed = remaining / monthsLeft

          if (monthlySavings < needed && overBudget.length > 0) {
            const top = overBudget[0]
            const savings = Math.min(top.over, needed - monthlySavings)
            const monthsSaved = monthlySavings > 0
              ? Math.ceil(remaining / (monthlySavings + savings)) - Math.ceil(remaining / monthlySavings)
              : null

            result.push({
              type: 'suggestion',
              message: `Reducing ${top.name} by ${formatCAD(savings)}/mo reaches ${goal.name}${
                monthsSaved ? ` ${Math.abs(monthsSaved)} month(s) sooner` : ' faster'
              }`,
            })
          }
        }

        if (monthlySavings > 0) {
          const monthsToGoal = Math.ceil(remaining / monthlySavings)
          result.push({
            type: 'info',
            message: `${goal.name}: ${formatCAD(remaining)} remaining — ~${monthsToGoal} month(s) at current savings rate`,
          })
        }
      }

      setInsights(result.slice(0, 4))
    }
    analyze()
  }, [])

  if (insights.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400">Goal Insights</h3>
      {insights.map((insight, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 px-4 py-3 rounded-lg ${
            insight.type === 'suggestion'
              ? 'bg-indigo-500/10 border border-indigo-500/20'
              : 'bg-gray-800/50 border border-gray-700/50'
          }`}
        >
          <Lightbulb size={16} className={insight.type === 'suggestion' ? 'text-indigo-400 mt-0.5' : 'text-gray-500 mt-0.5'} />
          <span className={`text-sm ${insight.type === 'suggestion' ? 'text-indigo-300' : 'text-gray-400'}`}>
            {insight.message}
          </span>
        </div>
      ))}
    </div>
  )
}
