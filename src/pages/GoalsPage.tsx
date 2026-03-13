import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import GoalProgressCard from '@/components/GoalProgressCard'
import type { Goal } from '@/types'

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('goals')
      .select('*')
      .order('sort_order')
      .then(({ data }) => {
        setGoals((data ?? []) as Goal[])
        setLoading(false)
      })
  }, [])

  async function addContribution(goalId: string, amount: number, note: string) {
    const { error } = await supabase.from('goal_contributions').insert({
      goal_id: goalId,
      amount,
      note: note || null,
      contributed_at: new Date().toISOString().split('T')[0],
    })
    if (!error) {
      // Refresh goals (trigger will have updated current_amount)
      const { data } = await supabase.from('goals').select('*').order('sort_order')
      setGoals((data ?? []) as Goal[])
    }
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Goals</h1>
          <p className="text-sm text-gray-400 mt-1">Track your financial milestones</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus size={16} />
          Add Goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-gray-500">
          <p>No goals yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {goals.map(g => (
            <GoalProgressCard
              key={g.id}
              goal={g}
              showContributeButton
              onContribute={(amount, note) => addContribution(g.id, amount, note)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
