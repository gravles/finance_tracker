import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X, Check, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD, toMonthlyAmount } from '@/lib/utils'
import type { RecurringExpense, RecurringFrequency, Category } from '@/types'

const FREQUENCIES: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annual']

interface DetectedBill {
  merchant: string
  amount: number
  frequency: RecurringFrequency
  occurrences: number
  lastSeen: string
  categoryId: string | null
  categoryName: string | null
  confidence: 'high' | 'medium'
}

const emptyForm = {
  name: '',
  category_id: '',
  amount: '',
  frequency: 'monthly' as RecurringFrequency,
  is_active: true,
  notes: '',
}

export default function RecurringExpensesPage() {
  const [expenses, setExpenses] = useState<RecurringExpense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showAdd, setShowAdd] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [detected, setDetected] = useState<DetectedBill[]>([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [expRes, catRes] = await Promise.all([
      supabase
        .from('recurring_expenses')
        .select('*, category:categories(id, name, parent_id)')
        .order('created_at', { ascending: false }),
      supabase.from('categories').select('id, name, parent_id').order('name'),
    ])
    setExpenses((expRes.data ?? []) as RecurringExpense[])
    setCategories((catRes.data ?? []) as Category[])
    setLoading(false)
  }

  const activeExpenses = expenses.filter(e => e.is_active)
  const totalMonthly = activeExpenses.reduce(
    (sum, e) => sum + toMonthlyAmount(e.amount, e.frequency), 0
  )
  const totalAnnual = totalMonthly * 12

  async function handleSave() {
    const amount = parseFloat(form.amount)
    if (!form.name.trim() || isNaN(amount) || amount <= 0) return

    const record = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      amount,
      frequency: form.frequency,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    }

    if (editingId) {
      await supabase.from('recurring_expenses').update(record).eq('id', editingId)
    } else {
      await supabase.from('recurring_expenses').insert(record)
    }

    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
    await loadData()
  }

  async function handleDelete(id: string) {
    await supabase.from('recurring_expenses').delete().eq('id', id)
    await loadData()
  }

  function startEdit(e: RecurringExpense) {
    setEditingId(e.id)
    setShowAdd(true)
    setForm({
      name: e.name,
      category_id: e.category_id ?? '',
      amount: String(e.amount),
      frequency: e.frequency,
      is_active: e.is_active,
      notes: e.notes ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
  }

  async function scanForBills() {
    setScanning(true)
    try {
      // Fetch 12 months of expense transactions that are marked recurring
      const twelveMonthsAgo = new Date()
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
      const since = twelveMonthsAgo.toISOString().split('T')[0]

      const { data: txns } = await supabase
        .from('transactions')
        .select('merchant_name, payee, amount, date, is_recurring, category_id, category:categories(name)')
        .eq('is_ignored', false)
        .eq('is_transfer', false)
        .lt('amount', 0)
        .gte('date', since)
        .order('date', { ascending: true })

      if (!txns?.length) { setScanning(false); return }

      // Group by merchant
      const groups = new Map<string, {
        displayName: string
        amounts: number[]
        dates: string[]
        recurringCount: number
        categoryId: string | null
        categoryName: string | null
      }>()

      for (const tx of txns) {
        const raw = (tx.merchant_name || tx.payee || '').trim()
        if (!raw) continue
        const key = raw.toLowerCase()

        const g = groups.get(key) ?? {
          displayName: raw,
          amounts: [], dates: [],
          recurringCount: 0,
          categoryId: null, categoryName: null,
        }
        g.amounts.push(Math.abs(tx.amount))
        g.dates.push(tx.date)
        if (tx.is_recurring) g.recurringCount++
        if (tx.merchant_name?.trim()) g.displayName = tx.merchant_name.trim()
        if (tx.category_id) {
          g.categoryId = tx.category_id
          g.categoryName = (tx.category as { name: string } | null)?.name ?? null
        }
        groups.set(key, g)
      }

      // Already-tracked names
      const existingNames = new Set(expenses.map(e => e.name.toLowerCase()))
      // Also check subscriptions so we don't duplicate
      const { data: subs } = await supabase.from('subscriptions').select('merchant_name').eq('is_active', true)
      for (const s of subs ?? []) {
        existingNames.add(s.merchant_name.toLowerCase())
      }

      const bills: DetectedBill[] = []

      for (const [, g] of groups) {
        if (g.amounts.length < 2) continue
        if (existingNames.has(g.displayName.toLowerCase())) continue

        // Amount consistency — coefficient of variation
        const avg = g.amounts.reduce((s, a) => s + a, 0) / g.amounts.length
        const stdDev = Math.sqrt(g.amounts.reduce((s, a) => s + (a - avg) ** 2, 0) / g.amounts.length)
        const cv = avg > 0 ? stdDev / avg : 1

        // Fixed bills should have very consistent amounts (cv < 0.15)
        // or be flagged recurring by Claude
        if (cv > 0.20 && g.recurringCount === 0) continue

        // Compute intervals
        const sorted = [...g.dates].sort()
        const intervals: number[] = []
        for (let i = 1; i < sorted.length; i++) {
          const days = Math.round(
            (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / (1000 * 60 * 60 * 24)
          )
          if (days > 0) intervals.push(days)
        }

        const median = intervals.length > 0
          ? [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)]
          : 30

        let frequency: RecurringFrequency = 'monthly'
        if (median >= 5 && median <= 10) frequency = 'weekly'
        else if (median >= 11 && median <= 18) frequency = 'biweekly'
        else if (median >= 19 && median <= 45) frequency = 'monthly'
        else if (median >= 75 && median <= 110) frequency = 'quarterly'
        else if (median >= 330 && median <= 400) frequency = 'annual'
        else if (g.recurringCount === 0) continue // can't determine frequency, skip

        const confidence: 'high' | 'medium' =
          (g.recurringCount > 0 && g.amounts.length >= 3 && cv < 0.10) ? 'high' : 'medium'

        bills.push({
          merchant: g.displayName,
          amount: Math.round(avg * 100) / 100,
          frequency,
          occurrences: g.amounts.length,
          lastSeen: sorted[sorted.length - 1],
          categoryId: g.categoryId,
          categoryName: g.categoryName,
          confidence,
        })
      }

      bills.sort((a, b) => {
        const co = { high: 0, medium: 1 }
        return (co[a.confidence] - co[b.confidence]) || (b.amount - a.amount)
      })

      setDetected(bills)
    } catch {
      // ignore
    }
    setScanning(false)
  }

  async function addDetectedBill(bill: DetectedBill) {
    await supabase.from('recurring_expenses').insert({
      name: bill.merchant,
      category_id: bill.categoryId,
      amount: bill.amount,
      frequency: bill.frequency,
      is_active: true,
      notes: `Detected from ${bill.occurrences} transactions, last seen ${bill.lastSeen}`,
    })
    setDetected(prev => prev.filter(d => d.merchant !== bill.merchant))
    await loadData()
  }

  async function addAllDetected() {
    const records = detected.map(bill => ({
      name: bill.merchant,
      category_id: bill.categoryId,
      amount: bill.amount,
      frequency: bill.frequency,
      is_active: true,
      notes: `Detected from ${bill.occurrences} transactions, last seen ${bill.lastSeen}`,
    }))
    if (records.length > 0) {
      await supabase.from('recurring_expenses').insert(records)
    }
    setDetected([])
    await loadData()
  }

  // Build category options with parent prefix
  const parentMap = new Map(
    categories.filter(c => !c.parent_id).map(c => [c.id, c.name])
  )
  const categoryOptions = categories.map(c => ({
    id: c.id,
    label: c.parent_id ? `${parentMap.get(c.parent_id) ?? ''} > ${c.name}` : c.name,
  })).sort((a, b) => a.label.localeCompare(b.label))

  function getCategoryLabel(catId: string | null): string {
    if (!catId) return '—'
    return categoryOptions.find(c => c.id === catId)?.label ?? '—'
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Recurring Expenses</h1>
          <p className="text-sm text-gray-400 mt-1">Track fixed bills like mortgage, insurance, and utilities</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setForm(emptyForm); setEditingId(null) }}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Expense
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-sm">
          <div className="stat-label">Monthly Fixed Costs</div>
          <div className="stat-value text-red-400 mt-1">{formatCAD(totalMonthly)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Annual Total</div>
          <div className="stat-value text-white mt-1">{formatCAD(totalAnnual)}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Active Bills</div>
          <div className="stat-value text-white mt-1">{activeExpenses.length}</div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAdd && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium text-white">
            {editingId ? 'Edit Recurring Expense' : 'New Recurring Expense'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Mortgage, Car Insurance"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                value={form.category_id}
                onChange={e => setForm({ ...form, category_id: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">None</option>
                {categoryOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Amount (CAD)</label>
              <input
                type="number"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                placeholder="Amount per period"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Frequency</label>
              <select
                value={form.frequency}
                onChange={e => setForm({ ...form, frequency: e.target.value as RecurringFrequency })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {FREQUENCIES.map(f => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })}
                className="rounded bg-gray-800 border-gray-700 text-indigo-500 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-300">Active</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
            >
              <Check size={14} />
              {editingId ? 'Update' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Scan button */}
      <div className="flex items-center gap-3">
        <button
          onClick={scanForBills}
          disabled={scanning}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Search size={16} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning...' : 'Detect from Transactions'}
        </button>
        {detected.length > 0 && (
          <span className="text-sm text-gray-400">{detected.length} recurring bill(s) found</span>
        )}
      </div>

      {/* Detected bills */}
      {detected.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Detected Recurring Bills</h3>
            <button
              onClick={addAllDetected}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <Plus size={12} /> Add all
            </button>
          </div>
          <div className="space-y-2">
            {detected.map(d => (
              <div key={d.merchant} className="flex items-center justify-between px-3 py-2.5 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-white font-medium text-sm truncate">{d.merchant}</span>
                  {d.categoryName && (
                    <span className="text-gray-500 text-xs truncate hidden sm:inline">{d.categoryName}</span>
                  )}
                  <span className="text-gray-400 text-xs capitalize flex-shrink-0">{d.frequency}</span>
                  <span className="text-gray-500 text-xs flex-shrink-0">{d.occurrences} txns</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                    d.confidence === 'high' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400'
                  }`}>{d.confidence}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span className="text-white font-mono text-sm">{formatCAD(d.amount)}</span>
                  <button
                    onClick={() => addDetectedBill(d)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded text-white transition-colors"
                  >
                    <Plus size={12} /> Add
                  </button>
                  <button
                    onClick={() => setDetected(prev => prev.filter(x => x.merchant !== d.merchant))}
                    className="p-1 text-gray-600 hover:text-gray-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <p className="text-sm">No recurring expenses added yet.</p>
            <p className="text-xs mt-1">Add your fixed bills to improve projections accuracy.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-left px-4 py-3 font-medium">Frequency</th>
                <th className="text-right px-4 py-3 font-medium">Monthly</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {expenses.map(e => (
                <tr key={e.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{e.name}</td>
                  <td className="px-4 py-3 text-gray-400">{getCategoryLabel(e.category_id)}</td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    {formatCAD(e.amount)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 capitalize">{e.frequency}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-400">
                    {formatCAD(toMonthlyAmount(e.amount, e.frequency))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      e.is_active
                        ? 'bg-green-400/10 text-green-400'
                        : 'bg-gray-700 text-gray-500'
                    }`}>
                      {e.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => startEdit(e)}
                        className="p-1.5 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
