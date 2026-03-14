import { toMonthlyAmount } from './utils'
import type { IncomeSource, Goal } from '@/types'

export interface ProjectionMonth {
  month: string          // "2026-04"
  income: number
  fixedExpenses: number  // subscriptions
  discretionary: number
  totalExpenses: number
  savings: number
  cumulativeSavings: number
}

export interface GoalProjection {
  goal: Goal
  monthlyNeeded: number
  currentSavingsRate: number
  projectedDate: string | null  // ISO date when goal completes at current rate
  monthsToGoal: number | null
}

export interface ProjectionInputs {
  incomeSources: IncomeSource[]
  monthlySubscriptions: number
  avgDiscretionary: number       // 3-month average
  budgetedDiscretionary?: number // if budgets set, use this instead
  goals: Goal[]
  adjustments?: { category: string; pctChange: number }[]
}

export function projectMonths(inputs: ProjectionInputs, months = 12): ProjectionMonth[] {
  const monthlyIncome = inputs.incomeSources
    .filter(s => s.is_active)
    .reduce((sum, s) => sum + toMonthlyAmount(s.gross_cad, s.frequency), 0)

  const baseDiscretionary = inputs.budgetedDiscretionary ?? inputs.avgDiscretionary

  // Apply adjustments
  let adjustedDiscretionary = baseDiscretionary
  if (inputs.adjustments) {
    for (const adj of inputs.adjustments) {
      adjustedDiscretionary *= (1 + adj.pctChange / 100)
    }
  }

  const result: ProjectionMonth[] = []
  let cumulative = 0
  const now = new Date()

  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    const totalExpenses = inputs.monthlySubscriptions + adjustedDiscretionary
    const savings = monthlyIncome - totalExpenses
    cumulative += savings

    result.push({
      month,
      income: monthlyIncome,
      fixedExpenses: inputs.monthlySubscriptions,
      discretionary: adjustedDiscretionary,
      totalExpenses,
      savings,
      cumulativeSavings: cumulative,
    })
  }

  return result
}

export function projectGoals(
  goals: Goal[],
  monthlySavings: number,
): GoalProjection[] {
  return goals.filter(g => g.is_active).map(goal => {
    const remaining = goal.target_amount - goal.current_amount
    if (remaining <= 0) {
      return {
        goal,
        monthlyNeeded: 0,
        currentSavingsRate: monthlySavings,
        projectedDate: null,
        monthsToGoal: 0,
      }
    }

    const monthsToGoal = monthlySavings > 0 ? Math.ceil(remaining / monthlySavings) : null

    let projectedDate: string | null = null
    if (monthsToGoal !== null) {
      const d = new Date()
      d.setMonth(d.getMonth() + monthsToGoal)
      projectedDate = d.toISOString().split('T')[0]
    }

    // Monthly needed to hit target_date
    let monthlyNeeded = 0
    if (goal.target_date) {
      const targetDate = new Date(goal.target_date)
      const monthsLeft = Math.max(1,
        (targetDate.getFullYear() - new Date().getFullYear()) * 12 +
        (targetDate.getMonth() - new Date().getMonth())
      )
      monthlyNeeded = remaining / monthsLeft
    }

    return {
      goal,
      monthlyNeeded,
      currentSavingsRate: monthlySavings,
      projectedDate,
      monthsToGoal,
    }
  })
}
