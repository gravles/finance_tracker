import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingDown, TrendingUp, Wallet, PiggyBank,
  ArrowRight, ArrowUpRight, ArrowDownRight,
  CreditCard, Receipt,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD, formatDate, toMonthlyAmount } from '@/lib/utils'
import SpendingPieChart from '@/components/charts/SpendingPieChart'
import MonthlyBarChart from '@/components/charts/MonthlyBarChart'
import BudgetProgressBar from '@/components/BudgetProgressBar'
import SpendingAlerts from '@/components/SpendingAlerts'
import GoalInsights from '@/components/GoalInsights'
import type { Goal, SpendingByCategory, MonthlySpend } from '@/types'

interface RecentTx {
  id: string
  date: string
  payee: string
  merchant_name: string | null
  amount: number
  category: { name: string; color: string | null } | null
  account: { name: string } | null
}

interface UpcomingBill {
  name: string
  amount: number
  type: 'subscription' | 'bill'
}

interface TopMerchant {
  name: string
  total: number
  count: number
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [goals, setGoals] = useState<Goal[]>([])
  const [spending, setSpending] = useState<SpendingByCategory[]>([])
  const [monthly, setMonthly] = useState<MonthlySpend[]>([])
  const [budgets, setBudgets] = useState<{ category: string; budgeted: number; spent: number }[]>([])
  const [recentTx, setRecentTx] = useState<RecentTx[]>([])
  const [upcomingBills, setUpcomingBills] = useState<UpcomingBill[]>([])
  const [topMerchants, setTopMerchants] = useState<TopMerchant[]>([])
  const [savingsRate, setSavingsRate] = useState<number | null>(null)
  const [uncategorizedCount, setUncategorizedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthStart = `${currentMonth}-01`
  const prevMonthStart = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })()
  const prevMonthEnd = (() => {
    const d = new Date(now.getFullYear(), now.getMonth(), 0)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  useEffect(() => {
    async function load() {
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
        .toISOString().split('T')[0]

      const [
        goalsRes, txRes, budgetRes, recentRes,
        subsRes, billsRes, incomeRes, prevTxRes,
        uncatRes,
      ] = await Promise.all([
        supabase.from('goals').select('*').eq('is_active', true).order('sort_order'),

        // 6 months of transactions for charts
        supabase
          .from('transactions')
          .select('amount, date, category:categories(id, name, color, parent_id)')
          .gte('date', sixMonthsAgo)
          .eq('is_ignored', false)
          .eq('is_transfer', false),

        // Budget periods for current month
        supabase
          .from('budget_periods')
          .select('category_id, budgeted, category:categories(name)')
          .eq('period_start', monthStart),

        // Recent transactions
        supabase
          .from('transactions')
          .select('id, date, payee, merchant_name, amount, category:categories(name, color), account:accounts(name)')
          .eq('is_ignored', false)
          .eq('is_transfer', false)
          .order('date', { ascending: false })
          .limit(8),

        // Active subscriptions
        supabase.from('subscriptions').select('merchant_name, amount').eq('is_active', true),

        // Active recurring expenses
        supabase.from('recurring_expenses').select('name, amount').eq('is_active', true),

        // Income sources
        supabase.from('income_sources').select('gross_cad, net_cad, frequency').eq('is_active', true),

        // Previous month transactions for comparison
        supabase
          .from('transactions')
          .select('amount, date, merchant_name, payee')
          .gte('date', prevMonthStart)
          .lte('date', prevMonthEnd)
          .eq('is_ignored', false)
          .eq('is_transfer', false),

        // Uncategorized transactions count
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .is('category_id', null)
          .eq('is_ignored', false)
          .eq('is_transfer', false),
      ])

      setGoals((goalsRes.data ?? []) as Goal[])
      setUncategorizedCount(uncatRes.count ?? 0)

      const txns = txRes.data ?? []

      // Spending by category (current month)
      const thisMonthTxns = txns.filter(t => t.date >= monthStart && t.amount < 0)
      const catMap = new Map<string, SpendingByCategory>()
      for (const t of thisMonthTxns) {
        const cat = t.category as unknown as { id: string; name: string; color: string | null; parent_id: string | null } | null
        const parentId = cat?.parent_id ?? cat?.id ?? 'uncategorized'
        const existing = catMap.get(parentId)
        if (existing) {
          existing.total += Math.abs(t.amount)
          existing.count += 1
        } else {
          catMap.set(parentId, {
            category_id: parentId,
            category_name: cat?.name ?? 'Uncategorized',
            category_color: cat?.color ?? '#6b7280',
            parent_name: null,
            total: Math.abs(t.amount),
            count: 1,
          })
        }
      }
      setSpending(Array.from(catMap.values()).sort((a, b) => b.total - a.total).slice(0, 10))

      // Monthly income/expense for 6 months
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

      // Budget progress — compute spent from this month's transactions
      const budgetPeriods = (budgetRes.data ?? []) as unknown as
        { budgeted: number; category_id: string; category: { name: string } | null }[]

      // Sum spending per parent category for current month
      const catSpendMap = new Map<string, number>()
      for (const t of thisMonthTxns) {
        const cat = t.category as unknown as { id: string; parent_id: string | null } | null
        const parentId = cat?.parent_id ?? cat?.id ?? 'uncategorized'
        catSpendMap.set(parentId, (catSpendMap.get(parentId) ?? 0) + Math.abs(t.amount))
      }

      const budgetItems = budgetPeriods.map(b => ({
        category: (b.category as unknown as { name: string } | null)?.name ?? 'Unknown',
        budgeted: b.budgeted,
        spent: catSpendMap.get(b.category_id) ?? 0,
      }))
        .filter(b => b.budgeted > 0)
        .sort((a, b) => (b.spent / b.budgeted) - (a.spent / a.budgeted))
        .slice(0, 6)
      setBudgets(budgetItems)

      // Recent transactions
      setRecentTx((recentRes.data ?? []) as unknown as RecentTx[])

      // Upcoming bills
      const bills: UpcomingBill[] = [
        ...(subsRes.data ?? []).map(s => ({
          name: s.merchant_name, amount: s.amount, type: 'subscription' as const,
        })),
        ...(billsRes.data ?? []).map(b => ({
          name: b.name, amount: b.amount, type: 'bill' as const,
        })),
      ].sort((a, b) => b.amount - a.amount).slice(0, 8)
      setUpcomingBills(bills)

      // Top merchants this month
      const { data: merchantTxData } = await supabase
        .from('transactions')
        .select('merchant_name, payee, amount')
        .gte('date', monthStart)
        .eq('is_ignored', false)
        .eq('is_transfer', false)
        .lt('amount', 0)
      const mMap = new Map<string, { name: string; total: number; count: number }>()
      for (const t of merchantTxData ?? []) {
        const raw = (t.merchant_name || t.payee || '').trim()
        if (!raw) continue
        const key = raw.toLowerCase()
        const entry = mMap.get(key) ?? { name: raw, total: 0, count: 0 }
        entry.total += Math.abs(t.amount)
        entry.count++
        if (t.merchant_name?.trim()) entry.name = t.merchant_name.trim()
        mMap.set(key, entry)
      }
      setTopMerchants(
        [...mMap.values()]
          .sort((a, b) => b.total - a.total)
          .slice(0, 7)
          .map(m => ({ name: m.name, total: m.total, count: m.count }))
      )

      // Savings rate (3-month average)
      const incomes = (incomeRes.data ?? []) as { gross_cad: number; net_cad: number | null; frequency: string }[]
      const monthlyNet = incomes.reduce(
        (sum, s) => sum + toMonthlyAmount(s.net_cad ?? s.gross_cad, s.frequency as 'monthly'), 0
      )
      if (monthlyNet > 0) {
        // Use last 3 complete months to compute avg expenses
        const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
          .toISOString().split('T')[0]
        const completeMonths = Array.from(monthMap.values())
          .filter(m => m.month >= threeMonthsAgo.slice(0, 7) && m.month < currentMonth)
        if (completeMonths.length > 0) {
          const avgExpenses = completeMonths.reduce((s, m) => s + m.expenses, 0) / completeMonths.length
          setSavingsRate(((monthlyNet - avgExpenses) / monthlyNet) * 100)
        }
      }

      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalExpenses = spending.reduce((s, c) => s + c.total, 0)
  const currentMonthData = monthly.find(m => m.month === currentMonth)
  const currentMonthIncome = currentMonthData?.income ?? 0
  const prevMonth = monthly.find(m => m.month === (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })())

  // Month-over-month change percentages
  const expenseChange = prevMonth && prevMonth.expenses > 0
    ? ((totalExpenses - prevMonth.expenses) / prevMonth.expenses) * 100 : null
  const incomeChange = prevMonth && prevMonth.income > 0
    ? ((currentMonthIncome - prevMonth.income) / prevMonth.income) * 100 : null

  const netMTD = currentMonthIncome - totalExpenses
  const totalBudgeted = budgets.reduce((s, b) => s + b.budgeted, 0)
  const totalBudgetSpent = budgets.reduce((s, b) => s + b.spent, 0)

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading dashboard...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          {now.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<TrendingUp className="text-green-400" size={18} />}
          label="Income"
          value={formatCAD(currentMonthIncome)}
          change={incomeChange}
          sub="month to date"
        />
        <KpiCard
          icon={<TrendingDown className="text-red-400" size={18} />}
          label="Spending"
          value={formatCAD(totalExpenses)}
          change={expenseChange}
          invertChange
          sub="month to date"
        />
        <KpiCard
          icon={<Wallet className="text-indigo-400" size={18} />}
          label="Net"
          value={formatCAD(netMTD)}
          valueClass={netMTD >= 0 ? 'text-green-400' : 'text-red-400'}
          sub="income - spending"
        />
        <KpiCard
          icon={<PiggyBank className="text-amber-400" size={18} />}
          label="Savings Rate"
          value={savingsRate !== null ? `${savingsRate.toFixed(1)}%` : '--'}
          valueClass={savingsRate !== null && savingsRate > 0 ? 'text-green-400' : 'text-red-400'}
          sub="3-month average"
        />
      </div>

      {/* Alerts */}
      <SpendingAlerts />

      {/* Action items bar */}
      {uncategorizedCount > 0 && (
        <button
          onClick={() => navigate('/transactions?recurring=&type=&category=uncategorized')}
          className="w-full flex items-center justify-between px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-300 hover:bg-amber-500/15 transition-colors"
        >
          <span>{uncategorizedCount} uncategorized transaction{uncategorizedCount !== 1 ? 's' : ''} need review</span>
          <ArrowRight size={16} />
        </button>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column: Charts (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">

          {/* Budget Overview */}
          {budgets.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-medium text-white">Budget Overview</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {formatCAD(totalBudgetSpent)} / {formatCAD(totalBudgeted)}
                  </span>
                  <button
                    onClick={() => navigate('/budget')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    View all
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {budgets.map(b => (
                  <BudgetProgressBar
                    key={b.category}
                    budgeted={b.budgeted}
                    spent={b.spent}
                    label={b.category}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-medium text-white">Spending by Category</h2>
                <button
                  onClick={() => navigate('/spending')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Details
                </button>
              </div>
              {spending.length > 0
                ? <SpendingPieChart data={spending} />
                : <EmptyState message="No transactions this month" />
              }
            </div>
            <div className="card">
              <h2 className="text-base font-medium mb-4 text-white">Income vs Expenses</h2>
              {monthly.length > 0
                ? <MonthlyBarChart data={monthly} />
                : <EmptyState message="No transaction history yet" />
              }
            </div>
          </div>

          {/* Goal Insights */}
          <GoalInsights />
        </div>

        {/* Right column: Lists (1/3 width) */}
        <div className="space-y-6">

          {/* Recent Transactions */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-medium text-white">Recent Transactions</h2>
              <button
                onClick={() => navigate('/transactions')}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                View all
              </button>
            </div>
            {recentTx.length > 0 ? (
              <div className="space-y-1">
                {recentTx.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">
                        {tx.merchant_name || tx.payee}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                        <span>{formatDate(tx.date)}</span>
                        {tx.category && (
                          <>
                            <span>·</span>
                            <span className="truncate" style={{ color: (tx.category as { color: string | null }).color ?? undefined }}>
                              {(tx.category as { name: string }).name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className={`text-sm font-mono ml-2 flex-shrink-0 ${tx.amount < 0 ? 'text-white' : 'text-green-400'}`}>
                      {tx.amount < 0 ? '-' : '+'}{formatCAD(Math.abs(tx.amount))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No transactions yet" />
            )}
          </div>

          {/* Top Merchants */}
          {topMerchants.length > 0 && (
            <div className="card">
              <h2 className="text-base font-medium text-white mb-3">Top Merchants</h2>
              <div className="space-y-2">
                {topMerchants.map((m, i) => {
                  const maxTotal = topMerchants[0].total
                  const pct = maxTotal > 0 ? (m.total / maxTotal) * 100 : 0
                  return (
                    <div key={m.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-300 truncate">{m.name}</span>
                        <span className="text-white font-mono text-xs ml-2 flex-shrink-0">{formatCAD(m.total)}</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-indigo-500/60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Monthly Bills & Subscriptions */}
          {upcomingBills.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-medium text-white">Fixed Costs</h2>
                <span className="text-xs text-gray-400">
                  {formatCAD(upcomingBills.reduce((s, b) => s + b.amount, 0))}/mo
                </span>
              </div>
              <div className="space-y-1">
                {upcomingBills.map(bill => (
                  <div key={bill.name} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {bill.type === 'subscription'
                        ? <CreditCard size={13} className="text-gray-600 flex-shrink-0" />
                        : <Receipt size={13} className="text-gray-600 flex-shrink-0" />
                      }
                      <span className="text-sm text-gray-300 truncate">{bill.name}</span>
                    </div>
                    <span className="text-sm font-mono text-white ml-2 flex-shrink-0">
                      {formatCAD(bill.amount)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => navigate('/subscriptions')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Subscriptions
                </button>
                <span className="text-gray-700">·</span>
                <button
                  onClick={() => navigate('/recurring')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Fixed Bills
                </button>
              </div>
            </div>
          )}

          {/* Goals (compact) */}
          {goals.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-medium text-white">Goals</h2>
                <button
                  onClick={() => navigate('/goals')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Manage
                </button>
              </div>
              <div className="space-y-3">
                {goals.slice(0, 4).map(g => {
                  const pct = g.target_amount > 0
                    ? Math.min((g.current_amount / g.target_amount) * 100, 100) : 0
                  return (
                    <div key={g.id}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-300">{g.name}</span>
                        <span className="text-xs text-gray-500">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: g.color ?? '#6366f1',
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500 mt-0.5">
                        <span>{formatCAD(g.current_amount)}</span>
                        <span>{formatCAD(g.target_amount)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  change,
  invertChange,
  valueClass = 'text-white',
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  change?: number | null
  invertChange?: boolean
  valueClass?: string
}) {
  const isPositive = change != null && change > 0
  const changeColor = (() => {
    if (change == null) return ''
    if (invertChange) return isPositive ? 'text-red-400' : 'text-green-400'
    return isPositive ? 'text-green-400' : 'text-red-400'
  })()

  return (
    <div className="card-sm space-y-2">
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        {icon}
        {label}
      </div>
      <div className="flex items-end gap-2">
        <div className={`stat-value ${valueClass}`}>{value}</div>
        {change != null && (
          <div className={`flex items-center gap-0.5 text-xs ${changeColor} mb-0.5`}>
            {isPositive
              ? <ArrowUpRight size={12} />
              : <ArrowDownRight size={12} />
            }
            {Math.abs(change).toFixed(0)}%
          </div>
        )}
      </div>
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
