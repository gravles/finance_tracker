import { useEffect, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD } from '@/lib/utils'
import BudgetProgressBar from '@/components/BudgetProgressBar'
import type { Category, BudgetPeriod } from '@/types'

interface CategoryBudget {
  category: Category
  budgeted: number
  spent: number
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

export default function BudgetPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [categories, setCategories] = useState<Category[]>([])
  const [budgets, setBudgets] = useState<Map<string, BudgetPeriod>>(new Map())
  const [spending, setSpending] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [localBudgets, setLocalBudgets] = useState<Map<string, string>>(new Map())

  const { start, end } = monthRange(year, month)

  const loadData = useCallback(async () => {
    setLoading(true)

    const [catRes, budgetRes, txRes] = await Promise.all([
      supabase.from('categories').select('*').is('parent_id', null).order('name'),
      supabase
        .from('budget_periods')
        .select('*')
        .eq('period_start', start),
      supabase
        .from('transactions')
        .select('category_id, amount, category:categories(parent_id)')
        .gte('date', start)
        .lte('date', end)
        .eq('is_ignored', false)
        .eq('is_transfer', false)
        .lt('amount', 0),
    ])

    const cats = (catRes.data ?? []) as Category[]
    setCategories(cats)

    const budgetMap = new Map<string, BudgetPeriod>()
    for (const b of (budgetRes.data ?? []) as BudgetPeriod[]) {
      budgetMap.set(b.category_id, b)
    }
    setBudgets(budgetMap)

    // Initialize local budget inputs
    const localMap = new Map<string, string>()
    for (const cat of cats) {
      const b = budgetMap.get(cat.id)
      localMap.set(cat.id, b ? String(b.budgeted) : '')
    }
    setLocalBudgets(localMap)

    // Sum spending by parent category
    const spendMap = new Map<string, number>()
    for (const tx of txRes.data ?? []) {
      const cat = tx.category as unknown as { parent_id: string | null } | null
      const parentId = cat?.parent_id ?? tx.category_id
      const key = parentId ?? 'uncategorized'
      spendMap.set(key, (spendMap.get(key) ?? 0) + Math.abs(tx.amount as number))
    }
    setSpending(spendMap)
    setLoading(false)
  }, [start, end])

  useEffect(() => { loadData() }, [loadData])

  function prevMonth() {
    if (month === 1) { setYear(year - 1); setMonth(12) }
    else setMonth(month - 1)
  }

  function nextMonth() {
    if (month === 12) { setYear(year + 1); setMonth(1) }
    else setMonth(month + 1)
  }

  async function saveBudget(categoryId: string) {
    const val = parseFloat(localBudgets.get(categoryId) ?? '')
    if (isNaN(val) || val < 0) return

    setSaving(true)
    const existing = budgets.get(categoryId)

    if (existing) {
      await supabase
        .from('budget_periods')
        .update({ budgeted: val })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('budget_periods')
        .insert({
          category_id: categoryId,
          period_start: start,
          period_end: end,
          budgeted: val,
        })
    }
    await loadData()
    setSaving(false)
  }

  async function copyFromPrevious() {
    const prevMonth_ = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const prevStart = `${prevYear}-${String(prevMonth_).padStart(2, '0')}-01`

    const { data } = await supabase
      .from('budget_periods')
      .select('*')
      .eq('period_start', prevStart)

    if (!data?.length) return

    const inserts = (data as BudgetPeriod[]).map(b => ({
      category_id: b.category_id,
      period_start: start,
      period_end: end,
      budgeted: b.budgeted,
    }))

    await supabase
      .from('budget_periods')
      .upsert(inserts, { onConflict: 'category_id,period_start' })

    await loadData()
  }

  const rows: CategoryBudget[] = categories.map(cat => ({
    category: cat,
    budgeted: budgets.get(cat.id)?.budgeted ?? 0,
    spent: spending.get(cat.id) ?? 0,
  }))

  const totalBudgeted = rows.reduce((s, r) => s + r.budgeted, 0)
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      {/* Header with month selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Budget</h1>
          <p className="text-sm text-gray-400 mt-1">Set and track monthly spending targets</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={copyFromPrevious}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
          >
            <Copy size={14} />
            Copy Previous
          </button>
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
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-sm">
          <div className="stat-label">Total Budgeted</div>
          <div className="stat-value text-white mt-1">{formatCAD(totalBudgeted)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Total Spent</div>
          <div className="stat-value text-white mt-1">{formatCAD(totalSpent)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Remaining</div>
          <div className={`stat-value mt-1 ${totalBudgeted - totalSpent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCAD(totalBudgeted - totalSpent)}
          </div>
        </div>
      </div>

      {/* Budget rows */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs">
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-right px-4 py-3 font-medium w-36">Budget</th>
              <th className="text-right px-4 py-3 font-medium w-28">Spent</th>
              <th className="text-right px-4 py-3 font-medium w-28">Delta</th>
              <th className="px-4 py-3 font-medium w-64">Progress</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {rows.map(({ category, budgeted, spent }) => {
              const delta = budgeted - spent
              return (
                <tr key={category.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {category.color && (
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                      )}
                      <span className="font-medium text-white">{category.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      <span className="text-gray-500 text-xs">$</span>
                      <input
                        type="number"
                        value={localBudgets.get(category.id) ?? ''}
                        onChange={e => {
                          const m = new Map(localBudgets)
                          m.set(category.id, e.target.value)
                          setLocalBudgets(m)
                        }}
                        onBlur={() => saveBudget(category.id)}
                        onKeyDown={e => { if (e.key === 'Enter') saveBudget(category.id) }}
                        placeholder="0.00"
                        className="w-24 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-white text-right placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        disabled={saving}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    {formatCAD(spent)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${
                    budgeted === 0 ? 'text-gray-600' : delta >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {budgeted > 0 ? formatCAD(delta) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {budgeted > 0 ? (
                      <BudgetProgressBar budgeted={budgeted} spent={spent} />
                    ) : (
                      <div className="w-full bg-gray-800 rounded-full h-2" />
                    )}
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
