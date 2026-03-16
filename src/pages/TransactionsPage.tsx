import { useEffect, useState, useCallback } from 'react'
import { Search, ChevronLeft, ChevronRight, Filter, X, Check, Pencil, Wand2, ArrowUp, ArrowDown, Repeat, CalendarClock, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCAD, formatDate } from '@/lib/utils'
import type { Transaction, Category } from '@/types'
import AnalyzeButton from '@/components/AnalyzeButton'

const PAGE_SIZE = 50

type SortColumn = 'date' | 'payee' | 'merchant_name' | 'amount'
type SortDir = 'asc' | 'desc'

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

interface BulkForm {
  category_id: string
  is_recurring: '' | 'true' | 'false'
}

interface NewCatForm {
  name: string
  parent_id: string
  color: string
}

const COLOR_PRESETS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6']

export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(() => {
    // Auto-show filters if arriving with filter params in URL
    return !!(searchParams.get('category') || searchParams.get('account') ||
      searchParams.get('from') || searchParams.get('to') ||
      searchParams.get('amountMin') || searchParams.get('amountMax') ||
      searchParams.get('type') || searchParams.get('recurring'))
  })
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])

  // Sorting
  const [sortCol, setSortCol] = useState<SortColumn>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleSort(col: SortColumn) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir(col === 'amount' ? 'desc' : 'asc')
    }
    setPage(0)
  }

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ category_id: '', merchant_name: '', payee: '', is_recurring: false, notes: '' })

  // Multi-select state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [bulkForm, setBulkForm] = useState<BulkForm>({ category_id: '', is_recurring: '' })
  const [bulkSaving, setBulkSaving] = useState(false)

  // Inline new category creation
  const [newCatForm, setNewCatForm] = useState<NewCatForm | null>(null)
  const [newCatContext, setNewCatContext] = useState<'single' | 'bulk' | null>(null)
  const [newCatSaving, setNewCatSaving] = useState(false)

  // Rule suggestion after category correction
  const [rulePrompt, setRulePrompt] = useState<{
    payee: string
    merchantName: string
    categoryId: string
    categoryLabel: string
    isRecurring: boolean
    matchCount: number
  } | null>(null)
  const [ruleSaving, setRuleSaving] = useState(false)

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

  // Load categories and accounts
  const loadMeta = useCallback(async () => {
    const [catRes, accRes] = await Promise.all([
      supabase.from('categories').select('id, name, parent_id, color').order('name'),
      supabase.from('accounts').select('id, name').order('name'),
    ])
    setCategories((catRes.data ?? []) as Category[])
    setAccounts(accRes.data ?? [])
  }, [])

  useEffect(() => { loadMeta() }, [loadMeta])

  // Build category label map
  const parentMap = new Map(categories.filter(c => !c.parent_id).map(c => [c.id, c.name]))
  const categoryOptions = categories.map(c => ({
    id: c.id,
    label: c.parent_id ? `${parentMap.get(c.parent_id) ?? ''} > ${c.name}` : c.name,
    color: c.color,
  })).sort((a, b) => a.label.localeCompare(b.label))

  const topLevelCategories = categories.filter(c => !c.parent_id)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('transactions')
      .select('*, account:accounts(name), category:categories(name, color)', { count: 'exact' })
      .eq('is_ignored', false)
      .order(sortCol, { ascending: sortDir === 'asc' })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filters.search) {
      query = query.or(`payee.ilike.%${filters.search}%,merchant_name.ilike.%${filters.search}%`)
    }
    if (filters.categoryId) {
      // If this is a parent category, include all its children too
      const children = categories.filter(c => c.parent_id === filters.categoryId)
      if (children.length > 0) {
        const ids = [filters.categoryId, ...children.map(c => c.id)]
        query = query.in('category_id', ids)
      } else {
        query = query.eq('category_id', filters.categoryId)
      }
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
  }, [page, filters, sortCol, sortDir, categories])

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

  // Clear selection on page change
  useEffect(() => {
    setSelected(new Set())
    setSelectAll(false)
  }, [page])

  function updateFilter(key: keyof Filters, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(0)
  }

  function clearFilters() {
    setFilters(emptyFilters)
    setPage(0)
  }

  // ── Multi-select ─────────────────────────────────────────────────
  function toggleSelectAll() {
    if (selectAll) {
      setSelected(new Set())
      setSelectAll(false)
    } else {
      setSelected(new Set(transactions.map(t => t.id)))
      setSelectAll(true)
    }
    // Cancel single edit when selecting
    setEditingId(null)
  }

  function toggleSelect(id: string) {
    // Cancel single edit when selecting
    setEditingId(null)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      setSelectAll(next.size === transactions.length && transactions.length > 0)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
    setSelectAll(false)
    setBulkForm({ category_id: '', is_recurring: '' })
  }

  // ── Editing ──────────────────────────────────────────────────────
  function startEdit(tx: Transaction) {
    // Cancel selection when starting single edit
    setSelected(new Set())
    setSelectAll(false)
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
    const tx = transactions.find(t => t.id === editingId)
    const oldCategoryId = tx?.category_id ?? ''
    const newCategoryId = editForm.category_id || null

    await supabase.from('transactions').update({
      category_id: newCategoryId,
      merchant_name: editForm.merchant_name.trim() || null,
      payee: editForm.payee.trim(),
      is_recurring: editForm.is_recurring,
      notes: editForm.notes.trim() || null,
    }).eq('id', editingId)

    // If category was changed, offer to create a rule
    if (tx && newCategoryId && newCategoryId !== oldCategoryId) {
      const payeePattern = tx.payee.toLowerCase().trim()
      // Check if a rule already exists for this payee pattern
      const { data: existing } = await supabase
        .from('categorization_rules')
        .select('id')
        .ilike('pattern', payeePattern)
        .limit(1)

      if (!existing || existing.length === 0) {
        // Count how many other transactions share this payee pattern
        const { count } = await supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .ilike('payee', `%${payeePattern}%`)

        const catLabel = categoryOptions.find(c => c.id === newCategoryId)?.label ?? 'selected category'

        setRulePrompt({
          payee: tx.payee,
          merchantName: editForm.merchant_name.trim(),
          categoryId: newCategoryId,
          categoryLabel: catLabel,
          isRecurring: editForm.is_recurring,
          matchCount: (count ?? 1),
        })
      }
    }

    setEditingId(null)
    await fetchTransactions()
  }

  // ── Bulk edit ────────────────────────────────────────────────────
  async function saveBulk() {
    if (selected.size === 0) return
    setBulkSaving(true)

    const record: Record<string, unknown> = {}
    if (bulkForm.category_id) {
      record.category_id = bulkForm.category_id
    }
    if (bulkForm.is_recurring === 'true') {
      record.is_recurring = true
    } else if (bulkForm.is_recurring === 'false') {
      record.is_recurring = false
    }

    if (Object.keys(record).length === 0) {
      setBulkSaving(false)
      return
    }

    await supabase.from('transactions').update(record).in('id', [...selected])

    // If category changed, offer rule creation for shared payees
    if (bulkForm.category_id) {
      const selectedTxs = transactions.filter(t => selected.has(t.id))
      // Use the most common payee among selected for the rule prompt
      const payeeCounts = new Map<string, number>()
      for (const tx of selectedTxs) {
        const p = tx.payee.toLowerCase().trim()
        payeeCounts.set(p, (payeeCounts.get(p) ?? 0) + 1)
      }
      let topPayee = ''
      let topCount = 0
      for (const [p, c] of payeeCounts) {
        if (c > topCount) { topPayee = p; topCount = c }
      }

      if (topPayee) {
        const { data: existing } = await supabase
          .from('categorization_rules')
          .select('id')
          .ilike('pattern', topPayee)
          .limit(1)

        if (!existing || existing.length === 0) {
          const { count } = await supabase
            .from('transactions')
            .select('id', { count: 'exact', head: true })
            .ilike('payee', `%${topPayee}%`)

          const catLabel = categoryOptions.find(c => c.id === bulkForm.category_id)?.label ?? 'selected category'
          const originalTx = selectedTxs.find(t => t.payee.toLowerCase().trim() === topPayee)

          setRulePrompt({
            payee: originalTx?.payee ?? topPayee,
            merchantName: originalTx?.merchant_name ?? '',
            categoryId: bulkForm.category_id,
            categoryLabel: catLabel,
            isRecurring: bulkForm.is_recurring === 'true',
            matchCount: count ?? 1,
          })
        }
      }
    }

    clearSelection()
    setBulkSaving(false)
    await fetchTransactions()
  }

  async function createRuleFromPrompt() {
    if (!rulePrompt) return
    setRuleSaving(true)
    // Extract a clean keyword from the payee for matching
    const pattern = rulePrompt.payee.toLowerCase().trim()
    await supabase.from('categorization_rules').insert({
      pattern,
      match_type: 'contains',
      category_id: rulePrompt.categoryId,
      merchant_name: rulePrompt.merchantName || null,
      is_recurring: rulePrompt.isRecurring,
      priority: 0,
      is_active: true,
    })

    // Also update all other transactions matching this pattern to the same category
    if (rulePrompt.matchCount > 1) {
      await supabase
        .from('transactions')
        .update({
          category_id: rulePrompt.categoryId,
          ...(rulePrompt.merchantName ? { merchant_name: rulePrompt.merchantName } : {}),
          is_recurring: rulePrompt.isRecurring,
        })
        .ilike('payee', `%${pattern}%`)
    }

    setRuleSaving(false)
    setRulePrompt(null)
    await fetchTransactions()
  }

  function cancelEdit() {
    setEditingId(null)
  }

  // ── Inline new category creation ─────────────────────────────────
  function handleCategorySelectChange(value: string, context: 'single' | 'bulk') {
    if (value === '__new__') {
      setNewCatForm({ name: '', parent_id: '', color: COLOR_PRESETS[0] })
      setNewCatContext(context)
      // Reset the select back so it doesn't stay on "__new__"
      if (context === 'single') {
        setEditForm(f => ({ ...f, category_id: '' }))
      } else {
        setBulkForm(f => ({ ...f, category_id: '' }))
      }
    } else {
      if (context === 'single') {
        setEditForm(f => ({ ...f, category_id: value }))
      } else {
        setBulkForm(f => ({ ...f, category_id: value }))
      }
    }
  }

  async function createCategory() {
    if (!newCatForm || !newCatForm.name.trim()) return
    setNewCatSaving(true)

    const { data, error } = await supabase.from('categories').insert({
      name: newCatForm.name.trim(),
      parent_id: newCatForm.parent_id || null,
      color: newCatForm.color || null,
    }).select('id').single()

    if (!error && data) {
      await loadMeta()
      // Auto-select the newly created category
      if (newCatContext === 'single') {
        setEditForm(f => ({ ...f, category_id: data.id }))
      } else {
        setBulkForm(f => ({ ...f, category_id: data.id }))
      }
    }

    setNewCatSaving(false)
    setNewCatForm(null)
    setNewCatContext(null)
  }

  function cancelNewCategory() {
    setNewCatForm(null)
    setNewCatContext(null)
  }

  // ── Add as subscription or fixed bill ──────────────────────────────
  const [addingAs, setAddingAs] = useState<{ type: 'subscription' | 'bill'; tx: Transaction } | null>(null)
  const [addingSaving, setAddingSaving] = useState(false)

  async function addAsRecurring(type: 'subscription' | 'bill', tx: Transaction) {
    setAddingSaving(true)
    const merchantName = tx.merchant_name || tx.payee
    const amount = Math.abs(tx.amount)

    // Find matching transactions to determine frequency and average amount
    const { data: matches } = await supabase
      .from('transactions')
      .select('amount, date')
      .eq('is_ignored', false)
      .eq('is_transfer', false)
      .lt('amount', 0)
      .or(`merchant_name.ilike.%${merchantName}%,payee.ilike.%${tx.payee}%`)
      .order('date', { ascending: true })

    const txDates = (matches ?? []).map(m => m.date).sort()
    const amounts = (matches ?? []).map(m => Math.abs(m.amount))
    const avgAmount = amounts.length > 0 ? amounts.reduce((s, a) => s + a, 0) / amounts.length : amount

    // Detect frequency from intervals
    let frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' = 'monthly'
    if (txDates.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < txDates.length; i++) {
        const days = Math.round(
          (new Date(txDates[i]).getTime() - new Date(txDates[i - 1]).getTime()) / (1000 * 60 * 60 * 24)
        )
        if (days > 0) intervals.push(days)
      }
      if (intervals.length > 0) {
        const median = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)]
        if (median >= 5 && median <= 10) frequency = 'weekly'
        else if (median >= 11 && median <= 18) frequency = 'biweekly'
        else if (median >= 19 && median <= 45) frequency = 'monthly'
        else if (median >= 75 && median <= 110) frequency = 'quarterly'
        else if (median >= 330 && median <= 400) frequency = 'annual'
      }
    }

    const roundedAmount = Math.round(avgAmount * 100) / 100

    if (type === 'subscription') {
      await supabase.from('subscriptions').insert({
        merchant_name: merchantName,
        amount: roundedAmount,
        frequency,
        category_id: tx.category_id || null,
        is_active: true,
        last_seen: txDates[txDates.length - 1] ?? tx.date,
        occurrence_count: txDates.length,
      })
    } else {
      await supabase.from('recurring_expenses').insert({
        name: merchantName,
        amount: roundedAmount,
        frequency,
        category_id: tx.category_id || null,
        is_active: true,
        notes: `Added from transaction, ${txDates.length} occurrences found`,
      })
    }

    // Mark all matching transactions as recurring
    await supabase
      .from('transactions')
      .update({ is_recurring: true })
      .or(`merchant_name.ilike.%${merchantName}%,payee.ilike.%${tx.payee}%`)
      .eq('is_ignored', false)

    setAddingSaving(false)
    setAddingAs(null)
    await fetchTransactions()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Compute filtered totals
  const filteredExpenses = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const filteredIncome = transactions.filter(t => t.amount >= 0).reduce((s, t) => s + t.amount, 0)

  const COL_COUNT = 8 // checkbox + date + payee + merchant + category + account + amount + edit

  // Inline new category form component
  const newCategoryFormUI = newCatForm && (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-3 mt-2">
      <p className="text-xs text-gray-400 font-medium flex items-center gap-1">
        <Plus size={12} /> New Category
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Name *</label>
          <input
            type="text"
            value={newCatForm.name}
            onChange={e => setNewCatForm({ ...newCatForm, name: e.target.value })}
            placeholder="e.g. Groceries"
            autoFocus
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Parent (optional)</label>
          <select
            value={newCatForm.parent_id}
            onChange={e => setNewCatForm({ ...newCatForm, parent_id: e.target.value })}
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">None (top-level)</option>
            {topLevelCategories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Color</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCatForm.color}
              onChange={e => setNewCatForm({ ...newCatForm, color: e.target.value })}
              placeholder="#6366f1"
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <span
              className="w-6 h-6 rounded flex-shrink-0 border border-gray-600"
              style={{ backgroundColor: newCatForm.color || '#6b7280' }}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Presets</label>
          <div className="flex flex-wrap gap-1">
            {COLOR_PRESETS.map(c => (
              <button
                key={c}
                onClick={() => setNewCatForm({ ...newCatForm, color: c })}
                className={`w-5 h-5 rounded-full border-2 transition-colors ${newCatForm.color === c ? 'border-white' : 'border-transparent hover:border-gray-500'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={createCategory}
          disabled={!newCatForm.name.trim() || newCatSaving}
          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
        >
          {newCatSaving ? 'Creating...' : 'Create'}
        </button>
        <button
          onClick={cancelNewCategory}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Transactions</h1>
          <p className="text-sm text-gray-400 mt-1">{total.toLocaleString()} total</p>
        </div>
        <AnalyzeButton
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

      {/* Rule creation prompt */}
      {rulePrompt && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <Wand2 size={16} className="text-indigo-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-1">
            <p className="text-sm text-white">
              Create a rule so all "<span className="text-indigo-300">{rulePrompt.payee}</span>" transactions
              are categorized as <span className="text-indigo-300">{rulePrompt.categoryLabel}</span>?
            </p>
            <p className="text-xs text-gray-400">
              {rulePrompt.matchCount > 1
                ? `This will also update ${rulePrompt.matchCount - 1} other matching transaction${rulePrompt.matchCount - 1 === 1 ? '' : 's'}.`
                : 'Future imports and re-analysis will use this rule automatically.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={createRuleFromPrompt}
              disabled={ruleSaving}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
            >
              {ruleSaving ? 'Saving…' : 'Create rule'}
            </button>
            <button
              onClick={() => setRulePrompt(null)}
              className="p-1.5 text-gray-500 hover:text-gray-300"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Add as subscription/bill confirmation */}
      {addingAs && (
        <div className={`${addingAs.type === 'subscription' ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-amber-500/10 border-amber-500/30'} border rounded-lg px-4 py-3 flex items-start gap-3`}>
          {addingAs.type === 'subscription'
            ? <Repeat size={16} className="text-indigo-400 mt-0.5 flex-shrink-0" />
            : <CalendarClock size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          }
          <div className="flex-1 space-y-1">
            <p className="text-sm text-white">
              Add "<span className={addingAs.type === 'subscription' ? 'text-indigo-300' : 'text-amber-300'}>{addingAs.tx.merchant_name || addingAs.tx.payee}</span>"
              as a {addingAs.type === 'subscription' ? 'subscription' : 'fixed bill'}?
            </p>
            <p className="text-xs text-gray-400">
              This will find all matching transactions, detect the frequency and average amount, and mark them all as recurring.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => addAsRecurring(addingAs.type, addingAs.tx)}
              disabled={addingSaving}
              className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                addingAs.type === 'subscription'
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {addingSaving ? 'Adding...' : `Add ${addingAs.type === 'subscription' ? 'subscription' : 'bill'}`}
            </button>
            <button
              onClick={() => setAddingAs(null)}
              className="p-1.5 text-gray-500 hover:text-gray-300"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-4 py-3 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm text-indigo-300 font-medium">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-3 flex-wrap flex-1">
              <div>
                <select
                  value={bulkForm.category_id}
                  onChange={e => handleCategorySelectChange(e.target.value, 'bulk')}
                  className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">— Category: Don't change —</option>
                  <option value="__new__">+ New category...</option>
                  {categoryOptions.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <select
                  value={bulkForm.is_recurring}
                  onChange={e => setBulkForm(f => ({ ...f, is_recurring: e.target.value as BulkForm['is_recurring'] }))}
                  className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">— Recurring: Don't change —</option>
                  <option value="true">Recurring: Yes</option>
                  <option value="false">Recurring: No</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveBulk}
                disabled={bulkSaving || (!bulkForm.category_id && !bulkForm.is_recurring)}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
              >
                {bulkSaving ? 'Applying...' : 'Apply'}
              </button>
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300"
              >
                Deselect all
              </button>
            </div>
          </div>
          {newCatContext === 'bulk' && newCategoryFormUI}
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-xs">
              <th className="px-2 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={toggleSelectAll}
                  className="rounded bg-gray-800 border-gray-700 text-indigo-500 focus:ring-indigo-500"
                />
              </th>
              {([
                { key: 'date' as SortColumn, label: 'Date', align: 'left' },
                { key: 'payee' as SortColumn, label: 'Payee', align: 'left' },
                { key: 'merchant_name' as SortColumn, label: 'Merchant', align: 'left' },
              ]).map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`text-${col.align} px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-200 transition-colors`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortCol === col.key && (
                      sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                    )}
                  </span>
                </th>
              ))}
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Account</th>
              <th
                onClick={() => toggleSort('amount')}
                className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-200 transition-colors"
              >
                <span className="inline-flex items-center justify-end gap-1">
                  Amount
                  {sortCol === 'amount' && (
                    sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                  )}
                </span>
              </th>
              <th className="text-center px-4 py-3 font-medium w-16">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {loading ? (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-8 text-center text-gray-500">Loading…</td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="px-4 py-8 text-center text-gray-500">
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
                      <td colSpan={COL_COUNT} className="px-4 py-3">
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
                                onChange={e => handleCategorySelectChange(e.target.value, 'single')}
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="">None</option>
                                <option value="__new__">+ New category...</option>
                                {categoryOptions.map(c => (
                                  <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                              </select>
                              {newCatContext === 'single' && newCategoryFormUI}
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
                          <div className="flex items-center gap-3 flex-wrap">
                            <label className="flex items-center gap-1.5 text-xs text-gray-400">
                              <input
                                type="checkbox"
                                checked={editForm.is_recurring}
                                onChange={e => setEditForm({ ...editForm, is_recurring: e.target.checked })}
                                className="rounded bg-gray-800 border-gray-700 text-indigo-500 focus:ring-indigo-500"
                              />
                              Recurring
                            </label>
                            <span className="w-px h-4 bg-gray-700" />
                            <button
                              onClick={() => setAddingAs({ type: 'subscription', tx })}
                              disabled={addingSaving}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-indigo-300 hover:bg-indigo-500/10 rounded transition-colors"
                              title="Add this merchant as a subscription and mark all matching transactions as recurring"
                            >
                              <Repeat size={11} /> Add as Subscription
                            </button>
                            <button
                              onClick={() => setAddingAs({ type: 'bill', tx })}
                              disabled={addingSaving}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-amber-300 hover:bg-amber-500/10 rounded transition-colors"
                              title="Add this merchant as a fixed bill and mark all matching transactions as recurring"
                            >
                              <CalendarClock size={11} /> Add as Fixed Bill
                            </button>
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
                  <tr key={tx.id} className={`hover:bg-gray-800/30 transition-colors ${selected.has(tx.id) ? 'bg-indigo-500/5' : ''}`}>
                    <td className="px-2 py-2.5 w-10">
                      <input
                        type="checkbox"
                        checked={selected.has(tx.id)}
                        onChange={() => toggleSelect(tx.id)}
                        className="rounded bg-gray-800 border-gray-700 text-indigo-500 focus:ring-indigo-500"
                      />
                    </td>
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
