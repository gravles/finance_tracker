import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, X, Check, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCAD, toMonthlyAmount } from '@/lib/utils'
import type { IncomeSource, IncomeFrequency } from '@/types'

const INCOME_TYPES = ['employment', 'rental', 'investment', 'other'] as const
const FREQUENCIES: IncomeFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'annual', 'irregular']

const emptyForm = {
  name: '',
  type: 'employment' as IncomeSource['type'],
  gross_cad: '',
  net_cad: '',
  frequency: 'biweekly' as IncomeFrequency,
  is_active: true,
  notes: '',
}

export default function IncomeSourcesPage() {
  const navigate = useNavigate()
  const [sources, setSources] = useState<IncomeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    loadSources()
  }, [])

  async function loadSources() {
    const { data } = await supabase
      .from('income_sources')
      .select('*')
      .order('created_at', { ascending: false })
    setSources((data ?? []) as IncomeSource[])
    setLoading(false)
  }

  const totalMonthlyGross = sources
    .filter(s => s.is_active)
    .reduce((sum, s) => sum + toMonthlyAmount(s.gross_cad, s.frequency), 0)

  const totalMonthlyNet = sources
    .filter(s => s.is_active)
    .reduce((sum, s) => sum + toMonthlyAmount(s.net_cad ?? s.gross_cad, s.frequency), 0)

  const totalMonthly = totalMonthlyGross

  async function handleSave() {
    const gross = parseFloat(form.gross_cad)
    if (!form.name.trim() || isNaN(gross) || gross <= 0) return

    const netParsed = parseFloat(form.net_cad)
    const net_cad = !isNaN(netParsed) && netParsed > 0 ? netParsed : null

    const record = {
      name: form.name.trim(),
      type: form.type,
      gross_cad: gross,
      net_cad,
      frequency: form.frequency,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    }

    if (editingId) {
      await supabase.from('income_sources').update(record).eq('id', editingId)
    } else {
      await supabase.from('income_sources').insert(record)
    }

    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm)
    await loadSources()
  }

  async function handleDelete(id: string) {
    await supabase.from('income_sources').delete().eq('id', id)
    await loadSources()
  }

  function startEdit(s: IncomeSource) {
    setEditingId(s.id)
    setShowAdd(true)
    setForm({
      name: s.name,
      type: s.type,
      gross_cad: String(s.gross_cad),
      net_cad: s.net_cad != null ? String(s.net_cad) : '',
      frequency: s.frequency,
      is_active: s.is_active,
      notes: s.notes ?? '',
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
          <h1 className="text-2xl font-semibold text-white">Income Sources</h1>
          <p className="text-sm text-gray-400 mt-1">Track your recurring income</p>
        </div>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setForm(emptyForm); setEditingId(null) }}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Source
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card-sm">
          <div className="stat-label">Monthly Gross</div>
          <div className="stat-value text-white mt-1">{formatCAD(totalMonthlyGross)}</div>
          <div className="text-xs text-gray-500 mt-1">{formatCAD(totalMonthlyGross * 12)}/yr</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Monthly Net</div>
          <div className="stat-value text-green-400 mt-1">{formatCAD(totalMonthlyNet)}</div>
          <div className="text-xs text-gray-500 mt-1">{formatCAD(totalMonthlyNet * 12)}/yr</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Active Sources</div>
          <div className="stat-value text-white mt-1">{sources.filter(s => s.is_active).length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Total Sources</div>
          <div className="stat-value text-white mt-1">{sources.length}</div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAdd && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium text-white">
            {editingId ? 'Edit Income Source' : 'New Income Source'}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Employment - Gartner"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as IncomeSource['type'] })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {INCOME_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Gross per {form.frequency === 'annual' ? 'year' : form.frequency === 'monthly' ? 'month' : 'pay period'} (CAD)
              </label>
              <input
                type="number"
                value={form.gross_cad}
                onChange={e => setForm({ ...form, gross_cad: e.target.value })}
                placeholder={form.frequency === 'biweekly' ? 'e.g. 7000 (per paycheque)' : 'Amount per period'}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Net per {form.frequency === 'annual' ? 'year' : form.frequency === 'monthly' ? 'month' : 'pay period'} (CAD)
              </label>
              <input
                type="number"
                value={form.net_cad}
                onChange={e => setForm({ ...form, net_cad: e.target.value })}
                placeholder="Take-home pay (optional)"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Frequency</label>
              <select
                value={form.frequency}
                onChange={e => setForm({ ...form, frequency: e.target.value as IncomeFrequency })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {FREQUENCIES.map(f => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>
            {/* Live calculation preview */}
            {(() => {
              const gross = parseFloat(form.gross_cad)
              const net = parseFloat(form.net_cad)
              if (isNaN(gross) || gross <= 0) return null
              const grossMonthly = toMonthlyAmount(gross, form.frequency)
              const grossAnnual = grossMonthly * 12
              const netMonthly = !isNaN(net) && net > 0 ? toMonthlyAmount(net, form.frequency) : null
              const netAnnual = netMonthly != null ? netMonthly * 12 : null
              const looksWrong = grossAnnual > 500000 || grossMonthly < 100
              return (
                <div className={`col-span-2 text-xs rounded-lg px-3 py-2 ${looksWrong ? 'bg-amber-400/10 border border-amber-400/30 text-amber-300' : 'bg-gray-800/60 text-gray-400'}`}>
                  {looksWrong && <span className="font-medium text-amber-400 mr-1">Check values:</span>}
                  Gross = {formatCAD(grossMonthly)}/mo · {formatCAD(grossAnnual)}/yr
                  {netMonthly != null && netAnnual != null && (
                    <span className="ml-3 text-green-400">
                      Net = {formatCAD(netMonthly)}/mo · {formatCAD(netAnnual)}/yr
                    </span>
                  )}
                </div>
              )
            })()}
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

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <p className="text-sm">No income sources added yet.</p>
            <p className="text-xs mt-1">Add your income sources to enable projections.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">Gross</th>
                <th className="text-right px-4 py-3 font-medium">Net</th>
                <th className="text-left px-4 py-3 font-medium">Frequency</th>
                <th className="text-right px-4 py-3 font-medium">Monthly Net</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {sources.map(s => (
                <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/transactions?search=${encodeURIComponent(s.name)}`)}
                      className="font-medium text-white hover:text-indigo-300 transition-colors flex items-center gap-1 group/link"
                      title="View transactions"
                    >
                      {s.name}
                      <ExternalLink size={11} className="opacity-0 group-hover/link:opacity-60 transition-opacity" />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-400 capitalize">{s.type}</td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    {formatCAD(s.gross_cad)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">
                    {s.net_cad != null ? formatCAD(s.net_cad) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 capitalize">{s.frequency}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-400">
                    {formatCAD(toMonthlyAmount(s.net_cad ?? s.gross_cad, s.frequency))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.is_active
                        ? 'bg-green-400/10 text-green-400'
                        : 'bg-gray-700 text-gray-500'
                    }`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => startEdit(s)}
                        className="p-1.5 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
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
