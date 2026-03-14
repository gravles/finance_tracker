import { useEffect, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD } from '@/lib/utils'
import CategoryTrendChart from '@/components/charts/CategoryTrendChart'
import BudgetProgressBar from '@/components/BudgetProgressBar'
import type { Category, BudgetPeriod } from '@/types'

interface CategorySpend {
  id: string
  name: string
  color: string | null
  total: number
  count: number
  children: CategorySpend[]
  trend: { month: string; amount: number }[]
  budgeted: number
}

function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`
  return { start, end }
}

function formatMonthLabel(year: number, month: number) {
  return new Date(year, month - 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
}

export default function SpendingPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [categories, setCategories] = useState<CategorySpend[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [threeMonthAvg, setThreeMonthAvg] = useState(0)
  const [lastYearTotal, setLastYearTotal] = useState(0)

  const { start, end } = monthRange(year, month)

  const loadData = useCallback(async () => {
    setLoading(true)

    // Fetch 12 months of data for trends
    const trendStart = new Date(year, month - 7, 1).toISOString().split('T')[0]
    const lastYearStart = `${year - 1}-${String(month).padStart(2, '0')}-01`
    const lastYearEnd = monthRange(year - 1, month).end

    const [catRes, txRes, budgetRes, lastYearRes] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase
        .from('transactions')
        .select('amount, date, category_id')
        .gte('date', trendStart)
        .lte('date', end)
        .eq('is_ignored', false)
        .eq('is_transfer', false)
        .lt('amount', 0),
      supabase.from('budget_periods').select('*').eq('period_start', start),
      supabase
        .from('transactions')
        .select('amount')
        .gte('date', lastYearStart)
        .lte('date', lastYearEnd)
        .eq('is_ignored', false)
        .eq('is_transfer', false)
        .lt('amount', 0),
    ])

    const allCats = (catRes.data ?? []) as Category[]
    const parentCats = allCats.filter(c => !c.parent_id)
    const childMap = new Map<string, Category[]>()
    for (const c of allCats.filter(c => c.parent_id)) {
      const arr = childMap.get(c.parent_id!) ?? []
      arr.push(c)
      childMap.set(c.parent_id!, arr)
    }

    const budgetMap = new Map<string, number>()
    for (const b of (budgetRes.data ?? []) as BudgetPeriod[]) {
      budgetMap.set(b.category_id, b.budgeted)
    }

    const txns = txRes.data ?? []

    // Build spending data
    const catChildMap = new Map<string, string>() // child_id -> parent_id
    for (const c of allCats) {
      if (c.parent_id) catChildMap.set(c.id, c.parent_id)
    }

    // Current month spending by category (with children)
    const currentSpend = new Map<string, { total: number; count: number }>()
    const childSpend = new Map<string, { total: number; count: number }>()
    // Trend data: category -> month -> amount
    const trendData = new Map<string, Map<string, number>>()

    for (const tx of txns) {
      const amt = Math.abs(tx.amount)
      const catId = tx.category_id ?? 'uncategorized'
      const parentId = catChildMap.get(catId) ?? catId
      const txMonth = tx.date.slice(0, 7)

      // Trend for parent
      if (!trendData.has(parentId)) trendData.set(parentId, new Map())
      const monthMap = trendData.get(parentId)!
      monthMap.set(txMonth, (monthMap.get(txMonth) ?? 0) + amt)

      // Current month totals
      if (tx.date >= start && tx.date <= end) {
        // Parent
        const p = currentSpend.get(parentId) ?? { total: 0, count: 0 }
        p.total += amt
        p.count += 1
        currentSpend.set(parentId, p)

        // Child
        if (catChildMap.has(catId)) {
          const c = childSpend.get(catId) ?? { total: 0, count: 0 }
          c.total += amt
          c.count += 1
          childSpend.set(catId, c)
        }
      }
    }

    // Build category list with trends
    const last6Months: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1)
      last6Months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const result: CategorySpend[] = parentCats
      .map(cat => {
        const spend = currentSpend.get(cat.id)
        const trendMap = trendData.get(cat.id) ?? new Map()
        const children = (childMap.get(cat.id) ?? []).map(child => {
          const cs = childSpend.get(child.id)
          return {
            id: child.id,
            name: child.name,
            color: child.color,
            total: cs?.total ?? 0,
            count: cs?.count ?? 0,
            children: [],
            trend: [],
            budgeted: 0,
          }
        }).filter(c => c.total > 0).sort((a, b) => b.total - a.total)

        return {
          id: cat.id,
          name: cat.name,
          color: cat.color,
          total: spend?.total ?? 0,
          count: spend?.count ?? 0,
          children,
          trend: last6Months.map(m => ({ month: m, amount: trendMap.get(m) ?? 0 })),
          budgeted: budgetMap.get(cat.id) ?? 0,
        }
      })
      .filter(c => c.total > 0 || c.budgeted > 0)
      .sort((a, b) => b.total - a.total)

    setCategories(result)

    // 3-month average
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`
    const prev3 = last6Months.slice(3, 6).filter(m => m !== currentMonth)
    if (prev3.length > 0) {
      let total = 0
      for (const tx of txns) {
        const m = tx.date.slice(0, 7)
        if (prev3.includes(m)) total += Math.abs(tx.amount)
      }
      setThreeMonthAvg(total / prev3.length)
    }

    // Last year same month
    setLastYearTotal((lastYearRes.data ?? []).reduce((s, t) => s + Math.abs(t.amount), 0))

    setLoading(false)
  }, [year, month, start, end])

  useEffect(() => { loadData() }, [loadData])

  function prevMonth() {
    if (month === 1) { setYear(year - 1); setMonth(12) }
    else setMonth(month - 1)
  }

  function nextMonth() {
    if (month === 12) { setYear(year + 1); setMonth(1) }
    else setMonth(month + 1)
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const totalSpent = categories.reduce((s, c) => s + c.total, 0)
  const yoyChange = lastYearTotal > 0 ? ((totalSpent - lastYearTotal) / lastYearTotal) * 100 : 0

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Spending</h1>
          <p className="text-sm text-gray-400 mt-1">Detailed category breakdown</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-1 py-1">
          <button onClick={prevMonth} className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-400">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-white font-medium px-2 min-w-[140px] text-center">
            {formatMonthLabel(year, month)}
          </span>
          <button onClick={nextMonth} className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-400">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Comparison cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card-sm">
          <div className="stat-label">This Month</div>
          <div className="stat-value text-white mt-1">{formatCAD(totalSpent)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">3-Month Avg</div>
          <div className="stat-value text-white mt-1">{formatCAD(threeMonthAvg)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Same Month Last Year</div>
          <div className="stat-value text-white mt-1">{formatCAD(lastYearTotal)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Year-over-Year</div>
          <div className={`stat-value mt-1 ${yoyChange > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {lastYearTotal > 0 ? `${yoyChange > 0 ? '+' : ''}${yoyChange.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs">
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-right px-4 py-3 font-medium w-28">Spent</th>
              <th className="text-right px-4 py-3 font-medium w-20">% Total</th>
              <th className="text-right px-4 py-3 font-medium w-20">Txns</th>
              <th className="px-4 py-3 font-medium w-40">6-Month Trend</th>
              <th className="px-4 py-3 font-medium w-48">Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {categories.map(cat => {
              const isExpanded = expanded.has(cat.id)
              const hasChildren = cat.children.length > 0
              const pctOfTotal = totalSpent > 0 ? (cat.total / totalSpent) * 100 : 0

              return (
                <tr key={cat.id} className="group">
                  <td colSpan={6} className="p-0">
                    {/* Parent row */}
                    <div
                      className={`flex items-center hover:bg-gray-800/30 transition-colors ${hasChildren ? 'cursor-pointer' : ''}`}
                      onClick={() => hasChildren && toggleExpand(cat.id)}
                    >
                      <div className="flex items-center gap-2 px-4 py-3 flex-1">
                        {hasChildren ? (
                          isExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />
                        ) : <div className="w-3.5" />}
                        {cat.color && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />}
                        <span className="font-medium text-white">{cat.name}</span>
                      </div>
                      <div className="w-28 text-right px-4 py-3 font-mono text-white">{formatCAD(cat.total)}</div>
                      <div className="w-20 text-right px-4 py-3 text-gray-400">{pctOfTotal.toFixed(1)}%</div>
                      <div className="w-20 text-right px-4 py-3 text-gray-400">{cat.count}</div>
                      <div className="w-40 px-4 py-3">
                        <CategoryTrendChart data={cat.trend} color={cat.color ?? '#6366f1'} />
                      </div>
                      <div className="w-48 px-4 py-3">
                        {cat.budgeted > 0 ? (
                          <BudgetProgressBar budgeted={cat.budgeted} spent={cat.total} />
                        ) : (
                          <span className="text-xs text-gray-600">No budget set</span>
                        )}
                      </div>
                    </div>

                    {/* Child rows */}
                    {isExpanded && cat.children.map(child => (
                      <div key={child.id} className="flex items-center bg-gray-800/20 border-t border-gray-800/30">
                        <div className="flex items-center gap-2 px-4 py-2.5 pl-12 flex-1">
                          {child.color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: child.color }} />}
                          <span className="text-gray-300 text-xs">{child.name}</span>
                        </div>
                        <div className="w-28 text-right px-4 py-2.5 font-mono text-gray-300 text-xs">{formatCAD(child.total)}</div>
                        <div className="w-20 text-right px-4 py-2.5 text-gray-500 text-xs">
                          {totalSpent > 0 ? ((child.total / totalSpent) * 100).toFixed(1) : 0}%
                        </div>
                        <div className="w-20 text-right px-4 py-2.5 text-gray-500 text-xs">{child.count}</div>
                        <div className="w-40 px-4 py-2.5" />
                        <div className="w-48 px-4 py-2.5" />
                      </div>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
