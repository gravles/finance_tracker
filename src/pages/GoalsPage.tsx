import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import GoalProgressCard from '@/components/GoalProgressCard'
import type { Goal, GoalType } from '@/types'

const GOAL_TYPES: GoalType[] = ['savings', 'mortgage_qual', 'equalization', 'travel', 'emergency', 'investment', 'debt_payoff']
const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  savings: 'Savings',
  mortgage_qual: 'Mortgage Qualification',
  equalization: 'Equalization',
  travel: 'Travel',
  emergency: 'Emergency Fund',
  investment: 'Investment',
  debt_payoff: 'Debt Payoff',
}

const emptyForm = {
  name: '',
  type: 'savings' as GoalType,
  description: '',
  target_amount: '',
  target_date: '',
  color: '#6366f1',
  is_active: true,
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => { loadGoals() }, [])

  async function loadGoals() {
    const { data } = await supabase.from('goals').select('*').order('sort_order')
    setGoals((data ?? []) as Goal[])
    setLoading(false)
  }

  async function addContribution(goalId: string, amount: number, note: string) {
    const { error } = await supabase.from('goal_contributions').insert({
      goal_id: goalId,
      amount,
      note: note || null,
      contributed_at: new Date().toISOString().split('T')[0],
    })
    if (!error) await loadGoals()
  }

  async function handleSave() {
    const target = parseFloat(form.target_amount)
    if (!form.name.trim() || isNaN(target) || target <= 0) return

    const record = {
      name: form.name.trim(),
      type: form.type,
      description: form.description.trim() || null,
      target_amount: target,
      target_date: form.target_date || null,
      color: form.color || null,
      is_active: form.is_active,
    }

    if (editingId) {
      await supabase.from('goals').update(record).eq('id', editingId)
    } else {
      const maxSort = goals.length > 0 ? Math.max(...goals.map(g => g.sort_order)) + 1 : 0
      await supabase.from('goals').insert({ ...record, current_amount: 0, currency: 'CAD', sort_order: maxSort })
    }

    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
    await loadGoals()
  }

  async function handleDelete(id: string) {
    await supabase.from('goals').delete().eq('id', id)
    await loadGoals()
  }

  function startEdit(g: Goal) {
    setEditingId(g.id)
    setShowAdd(true)
    setForm({
      name: g.name,
      type: g.type,
      description: g.description ?? '',
      target_amount: String(g.target_amount),
      target_date: g.target_date ?? '',
      color: g.color ?? '#6366f1',
      is_active: g.is_active,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Goals</h1>
          <p className="text-sm text-gray-400 mt-1">Track your financial milestones</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setForm(emptyForm); setEditingId(null) }}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Goal
          </button>
        )}
      </div>

      {/* Add/Edit Form */}
      {showAdd && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium text-white">
            {editingId ? 'Edit Goal' : 'New Goal'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Emergency Fund"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as GoalType })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {GOAL_TYPES.map(t => (
                  <option key={t} value={t}>{GOAL_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Target Amount (CAD)</label>
              <input
                type="number"
                value={form.target_amount}
                onChange={e => setForm({ ...form, target_amount: e.target.value })}
                placeholder="e.g. 10000"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Target Date (optional)</label>
              <input
                type="date"
                value={form.target_date}
                onChange={e => setForm({ ...form, target_date: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Color</label>
              <input
                type="color"
                value={form.color}
                onChange={e => setForm({ ...form, color: e.target.value })}
                className="h-10 w-full bg-gray-800 border border-gray-700 rounded-lg cursor-pointer"
              />
            </div>
            <div className="col-span-1">
              <label className="text-xs text-gray-400 block mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
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

      {goals.length === 0 && !showAdd ? (
        <div className="card flex flex-col items-center justify-center py-16 text-gray-500">
          <p>No goals yet. Add one to start tracking.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {goals.map(g => (
            <div key={g.id} className="relative group">
              <GoalProgressCard
                goal={g}
                showContributeButton
                onContribute={(amount, note) => addContribution(g.id, amount, note)}
              />
              {/* Edit/Delete overlay */}
              <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => startEdit(g)}
                  className="p-1.5 rounded bg-gray-800/80 text-gray-400 hover:text-white transition-colors"
                  title="Edit goal"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => handleDelete(g.id)}
                  className="p-1.5 rounded bg-gray-800/80 text-gray-400 hover:text-red-400 transition-colors"
                  title="Delete goal"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
