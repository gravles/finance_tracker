import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { formatCAD } from '@/lib/utils'

interface Props {
  data: { month: string; amount: number }[]
  color?: string
}

function formatMonth(month: string) {
  const [y, m] = month.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-CA', { month: 'short' })
}

export default function CategoryTrendChart({ data, color = '#6366f1' }: Props) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="month" hide />
        <YAxis hide />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
          formatter={(val: number) => [formatCAD(val), 'Spent']}
          labelFormatter={formatMonth}
        />
        <Bar dataKey="amount" fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
