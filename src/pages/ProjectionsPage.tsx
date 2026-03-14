import { useEffect, useState } from 'react'
import { AlertCircle, Calendar, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCAD, toMonthlyAmount, formatDate } from '@/lib/utils'
import { projectMonths, projectGoals, type ProjectionMonth, type GoalProjection } from '@/lib/projections'
import ProjectionLineChart from '@/components/charts/ProjectionLineChart'
import type { IncomeSource, Goal, Subscription } from '@/types'

export default function ProjectionsPage() {
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [projections, setProjections] = useState<ProjectionMonth[]>([])
  const [goalProjections, setGoalProjections] = useState<GoalProjection[]>([])
  const [loading, setLoading] = useState(true)
  const [diningAdjust, setDiningAdjust] = useState(0)

  useEffect(() => {
    async function load() {
      const now = new Date()
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
        .toISOString().split('T')[0]
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

      const [incomeRes, goalsRes, subsRes, txRes] = await Promise.all([
        supabase.from('income_sources').select('*').eq('is_active', true),
        supabase.from('goals').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('subscriptions').select('*').eq('is_active', true),
        supabase
          .from('transactions')
          .select('amount, date')
          .gte('date', threeMonthsAgo)
          .lt('date', monthStart)
          .eq('is_ignored', false)
          .eq('is_transfer', false)
          .lt('amount', 0),
      ])

      const income = (incomeRes.data ?? []) as IncomeSource[]
      const activeGoals = (goalsRes.data ?? []) as Goal[]
      const subs = (subsRes.data ?? []) as Subscription[]

      setIncomeSources(income)
      setGoals(activeGoals)

      // Monthly subscription cost
      const monthlySubs = subs.reduce((sum, s) => {
        return sum + toMonthlyAmount(s.amount, s.frequency)
      }, 0)

      // 3-month average discretionary (all non-sub expenses)
      const txns = txRes.data ?? []
      const totalExpenses = txns.reduce((s, t) => s + Math.abs(t.amount), 0)
      const avgDiscretionary = txns.length > 0 ? (totalExpenses / 3) - monthlySubs : 0

      const proj = projectMonths({
        incomeSources: income,
        monthlySubscriptions: monthlySubs,
        avgDiscretionary: Math.max(0, avgDiscretionary),
        goals: activeGoals,
        adjustments: diningAdjust !== 0 ? [{ category: 'dining', pctChange: diningAdjust }] : undefined,
      })

      setProjections(proj)

      const monthlySavings = proj.length > 0 ? proj[0].savings : 0
      setGoalProjections(projectGoals(activeGoals, monthlySavings))

      setLoading(false)
    }
    load()
  }, [diningAdjust])

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>

  if (incomeSources.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Projections</h1>
          <p className="text-sm text-gray-400 mt-1">12-month financial forecast</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-16 text-gray-500">
          <AlertCircle size={32} className="mb-3 opacity-40" />
          <p className="text-sm">No income sources configured</p>
          <p className="text-xs mt-1">Add your income sources to generate projections.</p>
          <Link
            to="/income"
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
          >
            Add Income Sources
          </Link>
        </div>
      </div>
    )
  }

  const monthlyIncome = projections[0]?.income ?? 0
  const monthlyExpenses = projections[0]?.totalExpenses ?? 0
  const monthlySavings = projections[0]?.savings ?? 0
  const yearEnd = projections[projections.length - 1]?.cumulativeSavings ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Projections</h1>
        <p className="text-sm text-gray-400 mt-1">12-month financial forecast</p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card-sm">
          <div className="stat-label">Monthly Income</div>
          <div className="stat-value text-green-400 mt-1">{formatCAD(monthlyIncome)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Monthly Expenses</div>
          <div className="stat-value text-red-400 mt-1">{formatCAD(monthlyExpenses)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Monthly Savings</div>
          <div className={`stat-value mt-1 ${monthlySavings >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCAD(monthlySavings)}
          </div>
        </div>
        <div className="card-sm">
          <div className="stat-label">12-Month Savings</div>
          <div className="stat-value text-indigo-400 mt-1">{formatCAD(yearEnd)}</div>
        </div>
      </div>

      {/* Projection chart */}
      <div className="card">
        <h2 className="text-base font-medium mb-4">12-Month Outlook</h2>
        <ProjectionLineChart data={projections} />
      </div>

      {/* Sensitivity slider */}
      <div className="card space-y-3">
        <h2 className="text-base font-medium">What-If: Adjust Discretionary Spending</h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400 w-24">-50%</span>
          <input
            type="range"
            min={-50}
            max={50}
            value={diningAdjust}
            onChange={e => setDiningAdjust(Number(e.target.value))}
            className="flex-1 accent-indigo-500"
          />
          <span className="text-sm text-gray-400 w-24 text-right">+50%</span>
        </div>
        <div className="text-center text-sm">
          {diningAdjust === 0 ? (
            <span className="text-gray-500">No adjustment (current rate)</span>
          ) : (
            <span className={diningAdjust < 0 ? 'text-green-400' : 'text-red-400'}>
              {diningAdjust > 0 ? '+' : ''}{diningAdjust}% discretionary spending
              {' = '}
              {formatCAD(monthlySavings)}/mo savings
            </span>
          )}
        </div>
      </div>

      {/* Goal projections */}
      {goalProjections.length > 0 && (
        <div>
          <h2 className="text-base font-medium mb-4">Goal Timeline</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {goalProjections.map(gp => (
              <div key={gp.goal.id} className="card space-y-3">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-indigo-400" />
                  <span className="font-medium text-white">{gp.goal.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Remaining</div>
                    <div className="text-white">{formatCAD(gp.goal.target_amount - gp.goal.current_amount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Monthly Needed</div>
                    <div className="text-white">{gp.monthlyNeeded > 0 ? formatCAD(gp.monthlyNeeded) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Projected Completion</div>
                    <div className="text-white">
                      {gp.monthsToGoal === 0 ? 'Complete!' :
                       gp.projectedDate ? formatDate(gp.projectedDate) :
                       'Unable to project'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Months Away</div>
                    <div className="text-white">
                      {gp.monthsToGoal === 0 ? '0' :
                       gp.monthsToGoal ? `${gp.monthsToGoal} months` : '—'}
                    </div>
                  </div>
                </div>
                {gp.goal.target_date && gp.projectedDate && (
                  <div className="text-xs">
                    {new Date(gp.projectedDate) <= new Date(gp.goal.target_date) ? (
                      <span className="text-green-400">
                        <TrendingUp size={12} className="inline mr-1" />
                        On track to meet target date
                      </span>
                    ) : (
                      <span className="text-amber-400">
                        <AlertCircle size={12} className="inline mr-1" />
                        May miss target — consider increasing savings
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Milestone */}
      {monthlySavings > 0 && (
        <div className="card bg-indigo-500/5 border-indigo-500/20">
          <p className="text-sm text-indigo-300">
            At your current rate, you'll save <span className="font-semibold text-white">{formatCAD(yearEnd)}</span> over
            the next 12 months ({formatCAD(monthlySavings)}/month).
          </p>
        </div>
      )}
    </div>
  )
}
