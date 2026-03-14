import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { formatCAD } from '@/lib/utils'
import type { ProjectionMonth } from '@/lib/projections'

function formatMonth(month: string) {
  const [y, m] = month.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-CA', { month: 'short', year: '2-digit' })
}

export default function ProjectionLineChart({ data }: { data: ProjectionMonth[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonth}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={v => formatCAD(v, true)}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={72}
        />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, fontSize: 12 }}
          formatter={(val: number, name: string) => [formatCAD(val), name]}
          labelFormatter={formatMonth}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => <span style={{ color: '#9ca3af', fontSize: 11 }}>{value}</span>}
        />
        <Line type="monotone" dataKey="income" name="Income" stroke="#22c55e" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="totalExpenses" name="Expenses" stroke="#ef4444" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="cumulativeSavings" name="Cumulative Savings" stroke="#6366f1" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
