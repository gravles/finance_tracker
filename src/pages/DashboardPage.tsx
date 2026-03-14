import { useEffect, useState, type ReactNode } from 'react'
import { TrendingDown, TrendingUp, Wallet, Target } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD } from '@/lib/utils'
import SpendingPieChart from '@/components/charts/SpendingPieChart'
import MonthlyBarChart from '@/components/charts/MonthlyBarChart'
import GoalProgressCard from '@/components/GoalProgressCard'
import SpendingAlerts from '@/components/SpendingAlerts'
import GoalInsights from '@/components/GoalInsights'
import type { Goal, SpendingByCategory, MonthlySpend } from '@/types'

export default function DashboardPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [spending, setSpending] = useState<SpendingByCategory[]>([])
  const [monthly, setMonthly] = useState<MonthlySpend[]>([])
  const [loading, setLoading] = useState(true)

  // Current month range
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  useEffect(() => {
    async function load() {
      const [goalsRes, txRes] = await Promise.all([
        supabase.from('goals').select('*').eq('is_active', true).order('sort_order'),
        supabase
          .from('transactions')
          .select('amount, date, category:categories(id, name, color, parent_id)')
          .gte('date', new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0])
          .eq('is_ignored', false)
          .eq('is_transfer', false),
      ])

      setGoals((goalsRes.data ?? []) as Goal[])

      const txns = txRes.data ?? []

      // Build spending by category for current month
      const thisMonthTxns = txns.filter(t => t.date >= monthStart && t.amount < 0)
      const catMap = new Map<string, SpendingByCategory>()
      for (const t of thisMonthTxns) {
        const cat = t.category as { id: string; name: string; color: string | null } | null
        const key = cat?.id ?? 'uncategorized'
        const existing = catMap.get(key)
        if (existing) {
          existing.total += Math.abs(t.amount)
          existing.count += 1
        } else {
          catMap.set(key, {
            category_id: key,
            category_name: cat?.name ?? 'Uncategorized',
            category_color: cat?.color ?? '#6b7280',
            parent_name: null,
            total: Math.abs(t.amount),
            count: 1,
          })
        }
      }
      setSpending(Array.from(catMap.values()).sort((a, b) => b.total - a.total).slice(0, 10))

      // Build monthly income/expense for last 6 months
      const monthMap = new Map<string, MonthlySpend>()
      for (const t of txns) {
        const month = t.date.slice(0, 7)
        const ms = monthMap.get(month) ?? { month, income: 0, expenses: 0, net: 0 }
        if (t.amount > 0) ms.income += t.amount
        else ms.expenses += Math.abs(t.amount)
        ms.net = ms.income - ms.expenses
        monthMap.set(month, ms)
      }
      setMonthly(Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month)))

      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalExpenses = spending.reduce((s, c) => s + c.total, 0)
  const currentMonthIncome = monthly.find(m => m.month === monthStart.slice(0, 7))?.income ?? 0

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading dashboard…</div>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          {now.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<TrendingUp className="text-green-400" size={18} />}
          label="Income (MTD)"
          value={formatCAD(currentMonthIncome)}
          sub="salary + rental"
        />
        <KpiCard
          icon={<TrendingDown className="text-red-400" size={18} />}
          label="Spending (MTD)"
          value={formatCAD(totalExpenses)}
          sub={`${spending.length} categories`}
        />
        <KpiCard
          icon={<Wallet className="text-indigo-400" size={18} />}
          label="Net (MTD)"
          value={formatCAD(currentMonthIncome - totalExpenses)}
          valueClass={currentMonthIncome - totalExpenses >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <KpiCard
          icon={<Target className="text-amber-400" size={18} />}
          label="Active Goals"
          value={String(goals.length)}
          sub="tracking"
        />
      </div>

      {/* Spending Alerts */}
      <SpendingAlerts />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-medium mb-4">Spending by Category</h2>
          {spending.length > 0
            ? <SpendingPieChart data={spending} />
            : <EmptyState message="No transactions this month" />
          }
        </div>
        <div className="card">
          <h2 className="text-base font-medium mb-4">Income vs Expenses (6 months)</h2>
          {monthly.length > 0
            ? <MonthlyBarChart data={monthly} />
            : <EmptyState message="No transaction history yet" />
          }
        </div>
      </div>

      {/* Goals */}
      {goals.length > 0 && (
        <div>
          <h2 className="text-base font-medium mb-4">Goal Progress</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {goals.map(g => <GoalProgressCard key={g.id} goal={g} />)}
          </div>
        </div>
      )}

      {/* Goal Insights */}
      <GoalInsights />
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  valueClass = 'text-white',
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="card-sm space-y-3">
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        {icon}
        {label}
      </div>
      <div className={`stat-value ${valueClass}`}>{value}</div>
      {sub && <div className="stat-label">{sub}</div>}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
      {message}
    </div>
  )
}
