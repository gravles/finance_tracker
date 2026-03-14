import { useEffect, useState, useCallback } from 'react'
import { Search, ChevronLeft, ChevronRight, Filter, X, Check, Pencil } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCAD, formatDate } from '@/lib/utils'
import type { Transaction, Category } from '@/types'
import AnalyzeButton from '@/components/AnalyzeButton'

const PAGE_SIZE = 50

interface Filters {
  search: string
  categoryId: string
  accountId: string
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
  type: '' | 'debit' | 'credit'
  recurring: '' | 'yes' | 'no'
}

const emptyFilters: Filters = {
  search: '',
  categoryId: '',
  accountId: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
  type: '',
  recurring: '',
}

interface EditForm {
  category_id: string
  merchant_name: string
  payee: string
  is_recurring: boolean
  notes: string
}

export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ category_id: '', merchant_name: '', payee: '', is_recurring: false, notes: '' })

  // Initialize filters from URL params
  const [filters, setFilters] = useState<Filters>(() => ({
    search: searchParams.get('search') ?? '',
    categoryId: searchParams.get('category') ?? '',
    accountId: searchParams.get('account') ?? '',
    dateFrom: searchParams.get('from') ?? '',
    dateTo: searchParams.get('to') ?? '',
    amountMin: searchParams.get('amountMin') ?? '',
    amountMax: searchParams.get('amountMax') ?? '',
    type: (searchParams.get('type') ?? '') as Filters['type'],
    recurring: (searchParams.get('recurring') ?? '') as Filters['recurring'],
  }))

  const hasActiveFilters = filters.categoryId || filters.accountId || filters.dateFrom ||
    filters.dateTo || filters.amountMin || filters.amountMax || filters.type || filters.recurring

  // Load categories and accounts once
  useEffect(() => {
    async function loadMeta() {
      const [catRes, accRes] = await Promise.all([
        supabase.from('categories').select('id, name, parent_id, color').order('name'),
        supabase.from('accounts').select('id, name').order('name'),
      ])
      setCategories((catRes.data ?? []) as Category[])
      setAccounts(accRes.data ?? [])
    }
    loadMeta()
  }, [])

  // Build category label map
  const parentMap = new Map(categories.filter(c => !c.parent_id).map(c => [c.id, c.name]))
  const categoryOptions = categories.map(c => ({
    id: c.id,
    label: c.parent_id ? `${parentMap.get(c.parent_id) ?? ''} > ${c.name}` : c.name,
    color: c.color,
  })).sort((a, b) => a.label.localeCompare(b.label))

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('transactions')
      .select('*, account:accounts(name), category:categories(name, color)', { count: 'exact' })
      .eq('is_ignored', false)
      .order('date', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filters.search) {
      query = query.or(`payee.ilike.%${filters.search}%,merchant_name.ilike.%${filters.search}%`)
    }
    if (filters.categoryId) {
      query = query.eq('category_id', filters.categoryId)
    }
    if (filters.accountId) {
      query = query.eq('account_id', filters.accountId)
    }
    if (filters.dateFrom) {
      query = query.gte('date', filters.dateFrom)
    }
    if (filters.dateTo) {
      query = query.lte('date', filters.dateTo)
    }
    if (filters.amountMin) {
      const min = parseFloat(filters.amountMin)
      if (!isNaN(min)) query = query.gte('amount', min)
    }
    if (filters.amountMax) {
      const max = parseFloat(filters.amountMax)
      if (!isNaN(max)) query = query.lte('amount', max)
    }
    if (filters.type === 'debit') {
      query = query.lt('amount', 0)
    } else if (filters.type === 'credit') {
      query = query.gte('amount', 0)
    }
    if (filters.recurring === 'yes') {
      query = query.eq('is_recurring', true)
    } else if (filters.recurring === 'no') {
      query = query.eq('is_recurring', false)
    }

    const { data, count, error } = await query
    if (!error) {
      setTransactions((data ?? []) as unknown as Transaction[])
      setTotal(count ?? 0)
    }
    setLoading(false)
  }, [page, filters])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  // Sync filters to URL params
  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.search) params.set('search', filters.search)
    if (filters.categoryId) params.set('category', filters.categoryId)
    if (filters.accountId) params.set('account', filters.accountId)
    if (filters.dateFrom) params.set('from', filters.dateFrom)
    if (filters.dateTo) params.set('to', filters.dateTo)
    if (filters.amountMin) params.set('amountMin', filters.amountMin)
    if (filters.amountMax) params.set('amountMax', filters.amountMax)
    if (filters.type) params.set('type', filters.type)
    if (filters.recurring) params.set('recurring', filters.recurring)
    setSearchParams(params, { replace: true })
  }, [filters, setSearchParams])

  function updateFilter(key: keyof Filters, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(0)
  }

  function clearFilters() {
    setFilters(emptyFilters)
    setPage(0)
  }

  // ── Editing ──────────────────────────────────────────────────────
  function startEdit(tx: Transaction) {
    setEditingId(tx.id)
    setEditForm({
      category_id: tx.category_id ?? '',
      merchant_name: tx.merchant_name ?? '',
      payee: tx.payee,
      is_recurring: tx.is_recurring,
      notes: tx.notes ?? '',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    await supabase.from('transactions').update({
      category_id: editForm.category_id || null,
      merchant_name: editForm.merchant_name.trim() || null,
      payee: editForm.payee.trim(),
      is_recurring: editForm.is_recurring,
      notes: editForm.notes.trim() || null,
    }).eq('id', editingId)
    setEditingId(null)
    await fetchTransactions()
  }

  function cancelEdit() {
    setEditingId(null)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Compute filtered totals
  const filteredExpenses = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const filteredIncome = transactions.filter(t => t.amount >= 0).reduce((s, t) => s + t.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Transactions</h1>
          <p className="text-sm text-gray-400 mt-1">{total.toLocaleString()} total</p>
        </div>
        <AnalyzeButton
          force
          label="Re-analyze all"
          onComplete={() => fetchTransactions()}
        />
      </div>

      {/* Search + Filter toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input
            type="text"
            placeholder="Search payee or merchant…"
            value={filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
            hasActiveFilters
              ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
              : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white'
          }`}
        >
          <Filter size={14} />
          Filters
          {hasActiveFilters && (
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
          )}
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-300"
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="card space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                value={filters.categoryId}
                onChange={e => updateFilter('categoryId', e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All categories</option>
                {categoryOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Account</label>
              <select
                value={filters.accountId}
                onChange={e => updateFilter('accountId', e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All accounts</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">From</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={e => updateFilter('dateFrom', e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">To</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={e => updateFilter('dateTo', e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Min Amount</label>
              <input
                type="number"
                value={filters.amountMin}
                onChange={e => updateFilter('amountMin', e.target.value)}
                placeholder="-500"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Max Amount</label>
              <input
                type="number"
                value={filters.amountMax}
                onChange={e => updateFilter('amountMax', e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select
                value={filters.type}
                onChange={e => updateFilter('type', e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All</option>
                <option value="debit">Expenses only</option>
                <option value="credit">Income only</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Recurring</label>
              <select
                value={filters.recurring}
                onChange={e => updateFilter('recurring', e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All</option>
                <option value="yes">Recurring only</option>
                <option value="no">Non-recurring</option>
              </select>
            </div>
          </div>
          {/* Page totals for current filter results */}
          {(filteredExpenses > 0 || filteredIncome > 0) && (
            <div className="flex gap-4 text-xs text-gray-500 pt-1 border-t border-gray-800">
              <span>Page expenses: <span className="text-gray-300 font-mono">{formatCAD(filteredExpenses)}</span></span>
              <span>Page income: <span className="text-green-400 font-mono">{formatCAD(filteredIncome)}</span></span>
            </div>
          )}
        </div>
      )}

      {/* Active filter chips */}
      {hasActiveFilters && !showFilters && (
        <div className="flex flex-wrap gap-2">
          {filters.categoryId && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded-full">
              {categoryOptions.find(c => c.id === filters.categoryId)?.label ?? 'Category'}
              <button onClick={() => updateFilter('categoryId', '')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
          {filters.accountId && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded-full">
              {accounts.find(a => a.id === filters.accountId)?.name ?? 'Account'}
              <button onClick={() => updateFilter('accountId', '')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
          {filters.dateFrom && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded-full">
              From {filters.dateFrom}
              <button onClick={() => updateFilter('dateFrom', '')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
          {filters.dateTo && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded-full">
              To {filters.dateTo}
              <button onClick={() => updateFilter('dateTo', '')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
          {filters.type && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded-full">
              {filters.type === 'debit' ? 'Expenses' : 'Income'}
              <button onClick={() => updateFilter('type', '')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
          {filters.recurring && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-500/15 text-indigo-300 rounded-full">
              {filters.recurring === 'yes' ? 'Recurring' : 'Non-recurring'}
              <button onClick={() => updateFilter('recurring', '')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs">
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Payee</th>
              <th className="text-left px-4 py-3 font-medium">Merchant</th>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Account</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-center px-4 py-3 font-medium w-16">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {filters.search || hasActiveFilters ? 'No matches found' : 'No transactions yet — import a CSV to get started'}
                </td>
              </tr>
            ) : (
              transactions.map(tx => {
                const cat = tx.category as { name: string; color: string | null } | null
                const acc = tx.account as { name: string } | null
                const isEditing = editingId === tx.id

                if (isEditing) {
                  return (
                    <tr key={tx.id} className="bg-gray-800/40">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="font-mono">{formatDate(tx.date)}</span>
                            <span>{formatCAD(tx.amount)}</span>
                            {acc && <span className="text-gray-600">· {acc.name}</span>}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Payee</label>
                              <input
                                type="text"
                                value={editForm.payee}
                                onChange={e => setEditForm({ ...editForm, payee: e.target.value })}
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Merchant Name</label>
                              <input
                                type="text"
                                value={editForm.merchant_name}
                                onChange={e => setEditForm({ ...editForm, merchant_name: e.target.value })}
                                placeholder="Clean name"
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Category</label>
                              <select
                                value={editForm.category_id}
                                onChange={e => setEditForm({ ...editForm, category_id: e.target.value })}
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="">None</option>
                                {categoryOptions.map(c => (
                                  <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Notes</label>
                              <input
                                type="text"
                                value={editForm.notes}
                                onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                                placeholder="Optional"
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs text-gray-400">
                              <input
                                type="checkbox"
                                checked={editForm.is_recurring}
                                onChange={e => setEditForm({ ...editForm, is_recurring: e.target.checked })}
                                className="rounded bg-gray-800 border-gray-700 text-indigo-500 focus:ring-indigo-500"
                              />
                              Recurring
                            </label>
                            <div className="flex-1" />
                            <button
                              onClick={saveEdit}
                              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded transition-colors"
                            >
                              <Check size={12} /> Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300"
                            >
                              <X size={12} /> Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={tx.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    <td className="px-4 py-2.5 text-white max-w-[160px] truncate">
                      {tx.payee}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs max-w-[120px] truncate">
                      {tx.merchant_name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {cat ? (
                        <span
                          className="inline-flex items-center text-xs px-2 py-0.5 rounded-full whitespace-nowrap cursor-pointer hover:opacity-80"
                          style={{
                            backgroundColor: `${cat.color ?? '#6b7280'}22`,
                            color: cat.color ?? '#6b7280',
                          }}
                          onClick={() => {
                            if (tx.category_id) {
                              updateFilter('categoryId', tx.category_id)
                              setShowFilters(true)
                            }
                          }}
                          title="Filter by this category"
                        >
                          {cat.name}
                        </span>
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs hidden md:table-cell truncate max-w-[120px]">
                      {acc?.name ?? '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-medium whitespace-nowrap ${
                      tx.amount >= 0 ? 'text-green-400' : 'text-gray-100'
                    }`}>
                      {formatCAD(tx.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => startEdit(tx)}
                        className="p-1.5 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
                        title="Edit transaction"
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>Page {page + 1} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded hover:bg-gray-800 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="p-1.5 rounded hover:bg-gray-800 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
