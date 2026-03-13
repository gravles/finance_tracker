import { useEffect, useState } from 'react'
import { Check, X, AlertCircle, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCAD, formatDate } from '@/lib/utils'
import type { Subscription, KeepFlag } from '@/types'

const FLAG_CONFIG: Record<KeepFlag, { label: string; icon: typeof Check; class: string }> = {
  keep:   { label: 'Keep',   icon: Check,        class: 'text-green-400 bg-green-400/10' },
  cancel: { label: 'Cancel', icon: X,            class: 'text-red-400 bg-red-400/10' },
  review: { label: 'Review', icon: AlertCircle,  class: 'text-amber-400 bg-amber-400/10' },
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('subscriptions')
      .select('*, category:categories(name, color)')
      .eq('is_active', true)
      .order('amount', { ascending: false })
      .then(({ data }) => {
        setSubs((data ?? []) as unknown as Subscription[])
        setLoading(false)
      })
  }, [])

  async function setFlag(id: string, flag: KeepFlag | null) {
    await supabase.from('subscriptions').update({ keep_flag: flag }).eq('id', id)
    setSubs(prev => prev.map(s => s.id === id ? { ...s, keep_flag: flag } : s))
  }

  const monthlyTotal = subs.reduce((sum, s) => {
    const m = s.frequency === 'monthly' ? 1
      : s.frequency === 'annual' ? 1/12
      : s.frequency === 'quarterly' ? 1/3
      : s.frequency === 'weekly' ? 4.33
      : s.frequency === 'biweekly' ? 2.17
      : 1
    return sum + s.amount * m
  }, 0)

  const toCancel = subs.filter(s => s.keep_flag === 'cancel')
  const cancelSavings = toCancel.reduce((sum, s) => sum + s.amount, 0)

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Subscriptions</h1>
        <p className="text-sm text-gray-400 mt-1">Audit your recurring charges</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-sm">
          <div className="stat-label">Monthly cost</div>
          <div className="stat-value text-white mt-1">{formatCAD(monthlyTotal)}</div>
          <div className="text-xs text-gray-500 mt-1">{formatCAD(monthlyTotal * 12)}/yr</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Active subscriptions</div>
          <div className="stat-value text-white mt-1">{subs.length}</div>
        </div>
        <div className="card-sm">
          <div className="stat-label">Potential savings</div>
          <div className="stat-value text-green-400 mt-1">{formatCAD(cancelSavings)}<span className="text-sm text-gray-400">/mo</span></div>
          <div className="text-xs text-gray-500 mt-1">{toCancel.length} marked to cancel</div>
        </div>
      </div>

      {/* List */}
      <div className="card p-0 overflow-hidden">
        {subs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <RefreshCw size={32} className="mb-3 opacity-40" />
            <p className="text-sm">No subscriptions detected yet.</p>
            <p className="text-xs mt-1">Import transactions to auto-detect recurring charges.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-xs">
                <th className="text-left px-4 py-3 font-medium">Merchant</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Frequency</th>
                <th className="text-left px-4 py-3 font-medium">Last seen</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-center px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {subs.map(s => {
                const flag = s.keep_flag
                const flagCfg = flag ? FLAG_CONFIG[flag] : null
                return (
                  <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{s.merchant_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {s.category ? (s.category as { name: string }).name : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 capitalize">{s.frequency}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {s.last_seen ? formatDate(s.last_seen) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-white">
                      {formatCAD(s.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {(['keep', 'review', 'cancel'] as KeepFlag[]).map(f => {
                          const cfg = FLAG_CONFIG[f]
                          const Icon = cfg.icon
                          const isActive = flag === f
                          return (
                            <button
                              key={f}
                              onClick={() => setFlag(s.id, isActive ? null : f)}
                              title={cfg.label}
                              className={`p-1.5 rounded transition-colors ${
                                isActive ? cfg.class : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800'
                              }`}
                            >
                              <Icon size={14} />
                            </button>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
