import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X, Check, Wand2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { CategorizationRule, Category, RuleMatchType } from '@/types'

const MATCH_TYPES: RuleMatchType[] = ['contains', 'starts_with', 'exact']

const emptyForm = {
  pattern: '',
  match_type: 'contains' as RuleMatchType,
  category_id: '',
  merchant_name: '',
  is_recurring: false,
  priority: 0,
  is_active: true,
}

export default function RulesPage() {
  const [rules, setRules] = useState<CategorizationRule[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showAdd, setShowAdd] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [rulesRes, catRes] = await Promise.all([
      supabase
        .from('categorization_rules')
        .select('*, category:categories(id, name, parent_id)')
        .order('priority', { ascending: false }),
      supabase.from('categories').select('id, name, parent_id').order('name'),
    ])
    setRules((rulesRes.data ?? []) as CategorizationRule[])
    setCategories((catRes.data ?? []) as Category[])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.pattern.trim() || !form.category_id) return

    const record = {
      pattern: form.pattern.trim().toLowerCase(),
      match_type: form.match_type,
      category_id: form.category_id,
      merchant_name: form.merchant_name.trim() || null,
      is_recurring: form.is_recurring,
      priority: form.priority,
      is_active: form.is_active,
    }

    if (editingId) {
      await supabase.from('categorization_rules').update(record).eq('id', editingId)
    } else {
      await supabase.from('categorization_rules').insert(record)
    }

    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
    await loadData()
  }

  async function handleDelete(id: string) {
    await supabase.from('categorization_rules').delete().eq('id', id)
    await loadData()
  }

  function startEdit(r: CategorizationRule) {
    setEditingId(r.id)
    setShowAdd(true)
    setForm({
      pattern: r.pattern,
      match_type: r.match_type,
      category_id: r.category_id,
      merchant_name: r.merchant_name ?? '',
      is_recurring: r.is_recurring,
      priority: r.priority,
      is_active: r.is_active,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
  }

  // Build a flat category list with parent prefixes for the dropdown
  const parentMap = new Map(
    categories.filter(c => !c.parent_id).map(c => [c.id, c.name])
  )
  const categoryOptions = categories.map(c => ({
    id: c.id,
    label: c.parent_id ? `${parentMap.get(c.parent_id) ?? ''} > ${c.name}` : c.name,
  })).sort((a, b) => a.label.localeCompare(b.label))

  function getCategoryLabel(catId: string): string {
    return categoryOptions.find(c => c.id === catId)?.label ?? '—'
  }

  async function generateFromHistory() {
    setGenerating(true)
    try {
      // Find the most common payee → category pairs (where both exist)
      const { data: txns } = await supabase
        .from('transactions')
        .select('payee, category_id, merchant_name')
        .not('category_id', 'is', null)
        .not('payee', 'eq', '')
        .eq('is_ignored', false)
        .eq('is_transfer', false)
        .limit(5000)

      if (!txns?.length) { setGenerating(false); return }

      // Group by payee and find most common category
      const payeeMap = new Map<string, { category_id: string; merchant_name: string | null; count: number }>()
      for (const tx of txns) {
        const key = tx.payee.toLowerCase().trim()
        const existing = payeeMap.get(key)
        if (!existing || tx.category_id === existing.category_id) {
          payeeMap.set(key, {
            category_id: tx.category_id,
            merchant_name: tx.merchant_name,
            count: (existing?.count ?? 0) + 1,
          })
        }
      }

      // Only create rules for payees seen 3+ times with consistent category
      const existingPatterns = new Set(rules.map(r => r.pattern.toLowerCase()))
      const newRules: typeof emptyForm[] = []

      for (const [payee, info] of payeeMap) {
        if (info.count >= 3 && !existingPatterns.has(payee)) {
          newRules.push({
            pattern: payee,
            match_type: 'contains',
            category_id: info.category_id,
            merchant_name: info.merchant_name ?? '',
            is_recurring: false,
            priority: 0,
            is_active: true,
          })
        }
      }

      if (newRules.length > 0) {
        const records = newRules.map(r => ({
          pattern: r.pattern,
          match_type: r.match_type,
          category_id: r.category_id,
          merchant_name: r.merchant_name || null,
          is_recurring: r.is_recurring,
          priority: r.priority,
          is_active: r.is_active,
        }))
        await supabase.from('categorization_rules').insert(records)
        await loadData()
      }
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Categorization Rules</h1>
          <p className="text-sm text-gray-400 mt-1">Auto-categorize transactions by payee patterns</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generateFromHistory}
            disabled={generating}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <Wand2 size={16} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Scanning...' : 'Generate from History'}
          </button>
          {!showAdd && (
            <button
              onClick={() => { setShowAdd(true); setForm(emptyForm); setEditingId(null) }}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={16} />
              Add Rule
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-sm">
          <div className="stat-label">Total Rules</div>
          <div className="stat-value text-white mt-1">{rules.length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Active Rules</div>
          <div className="stat-value text-green-400 mt-1">{rules.filter(r => r.is_active).length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Recurring Tags</div>
          <div className="stat-value text-indigo-400 mt-1">{rules.filter(r => r.is_recurring).length}</div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAdd && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium text-white">
            {editingId ? 'Edit Rule' : 'New Rule'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Pattern (payee text)</label>
              <input
                type="text"
                value={form.pattern}
                onChange={e => setForm({ ...form, pattern: e.target.value })}
                placeholder="e.g. loblaws"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Match Type</label>
              <select
                value={form.match_type}
                onChange={e => setForm({ ...form, match_type: e.target.value as RuleMatchType })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {MATCH_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                value={form.category_id}
                onChange={e => setForm({ ...form, category_id: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Select category...</option>
                {categoryOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Merchant Name</label>
              <input
                type="text"
                value={form.merchant_name}
                onChange={e => setForm({ ...form, merchant_name: e.target.value })}
                placeholder="Clean merchant name (optional)"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={e => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center gap-4 self-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.is_recurring}
                  onChange={e => setForm({ ...form, is_recurring: e.target.checked })}
                  className="rounded bg-gray-800 border-gray-700 text-indigo-500 focus:ring-indigo-500"
                />
                Recurring
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded bg-gray-800 border-gray-700 text-indigo-500 focus:ring-indigo-500"
                />
                Active
              </label>
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

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <p className="text-sm">No rules added yet.</p>
            <p className="text-xs mt-1">Add rules or generate them from your transaction history.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left px-4 py-3 font-medium">Pattern</th>
                <th className="text-left px-4 py-3 font-medium">Match</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Merchant</th>
                <th className="text-center px-4 py-3 font-medium">Recurring</th>
                <th className="text-center px-4 py-3 font-medium">Priority</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-white">{r.pattern}</td>
                  <td className="px-4 py-3 text-gray-400">{r.match_type.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-gray-300">{getCategoryLabel(r.category_id)}</td>
                  <td className="px-4 py-3 text-gray-400">{r.merchant_name ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {r.is_recurring && <span className="text-green-400 text-xs">Yes</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">{r.priority}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.is_active
                        ? 'bg-green-400/10 text-green-400'
                        : 'bg-gray-700 text-gray-500'
                    }`}>
                      {r.is_active ? 'Active' : 'Off'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => startEdit(r)}
                        className="p-1.5 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
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
