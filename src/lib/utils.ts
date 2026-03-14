import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number as CAD currency */
export function formatCAD(amount: number, compact = false): string {
  if (compact && Math.abs(amount) >= 1000) {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  }
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
  }).format(amount)
}

/** Format a date string to "Jan 15, 2025" */
export function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Return "YYYY-MM" for a date string */
export function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** Percentage of target reached (capped at 100) */
export function goalProgress(current: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(100, (current / target) * 100)
}

/** Days remaining until a target date (null if no date) */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/** Convert an amount + frequency to a monthly equivalent */
export function toMonthlyAmount(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly':      return amount * 52 / 12
    case 'biweekly':    return amount * 26 / 12
    case 'semimonthly': return amount * 2
    case 'monthly':     return amount
    case 'quarterly':   return amount / 3
    case 'annual':      return amount / 12
    default:            return amount // irregular — use as-is
  }
}

/** SHA-256 hash for dedup (browser crypto) */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
