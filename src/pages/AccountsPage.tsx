import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Account, AccountType } from '@/types'

const ACCOUNT_TYPES: AccountType[] = ['chequing', 'savings', 'credit_card', 'investment', 'mortgage', 'loan', 'other']
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  chequing: 'Chequing',
  savings: 'Savings',
  credit_card: 'Credit Card',
  investment: 'Investment',
  mortgage: 'Mortgage',
  loan: 'Loan',
  other: 'Other',
}

const emptyForm = {
  name: '',
  type: 'chequing' as AccountType,
  institution: '',
  currency: 'CAD',
  is_active: true,
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => { loadAccounts() }, [])

  async function loadAccounts() {
    const { data } = await supabase
      .from('accounts')
      .select('*')
      .order('name')
    setAccounts((data ?? []) as Account[])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.name.trim()) return

    const record = {
      name: form.name.trim(),
      type: form.type,
      institution: form.institution.trim() || null,
      currency: form.currency,
      is_active: form.is_active,
    }

    if (editingId) {
      await supabase.from('accounts').update(record).eq('id', editingId)
    } else {
      await supabase.from('accounts').insert(record)
    }

    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
    await loadAccounts()
  }

  async function handleDelete(id: string) {
    await supabase.from('accounts').delete().eq('id', id)
    await loadAccounts()
  }

  function startEdit(a: Account) {
    setEditingId(a.id)
    setShowAdd(true)
    setForm({
      name: a.name,
      type: a.type,
      institution: a.institution ?? '',
      currency: a.currency,
      is_active: a.is_active,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Accounts</h1>
          <p className="text-sm text-gray-400 mt-1">Manage your financial accounts</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setForm(emptyForm); setEditingId(null) }}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Account
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-sm">
          <div className="stat-label">Total Accounts</div>
          <div className="stat-value text-white mt-1">{accounts.length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Active</div>
          <div className="stat-value text-green-400 mt-1">{accounts.filter(a => a.is_active).length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Institutions</div>
          <div className="stat-value text-white mt-1">
            {new Set(accounts.filter(a => a.institution).map(a => a.institution)).size}
          </div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAdd && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium text-white">
            {editingId ? 'Edit Account' : 'New Account'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Account Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. TD Chequing"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as AccountType })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {ACCOUNT_TYPES.map(t => (
                  <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Institution</label>
              <input
                type="text"
                value={form.institution}
                onChange={e => setForm({ ...form, institution: e.target.value })}
                placeholder="e.g. TD Bank, Simplii"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
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

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <p className="text-sm">No accounts added yet.</p>
            <p className="text-xs mt-1">Add your bank accounts, credit cards, and investment accounts.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Institution</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {accounts.map(a => (
                <tr key={a.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{a.name}</td>
                  <td className="px-4 py-3 text-gray-400">{ACCOUNT_TYPE_LABELS[a.type]}</td>
                  <td className="px-4 py-3 text-gray-400">{a.institution ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      a.is_active
                        ? 'bg-green-400/10 text-green-400'
                        : 'bg-gray-700 text-gray-500'
                    }`}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => startEdit(a)}
                        className="p-1.5 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
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
