import Papa from 'papaparse'
import { sha256 } from './utils'
import { supabase } from './supabase'

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

// Simplifi TSV columns (as of 2025/2026 export):
// Date | Account | Payee | Category | Tags | Exclusion | Amount

interface SimplifiRow {
  Date: string
  Account: string
  Payee: string
  Category: string
  Tags: string
  Exclusion: string   // "yes" = excluded from budget
  Amount: string
  // older export variants
  'Account Name'?: string
  Note?: string
}

export async function importSimplifiCsv(
  file: File,
  uploadId: string,
): Promise<ImportResult> {
  const text = await file.text()

  const { data, errors: parseErrors } = Papa.parse<SimplifiRow>(text, {
    header: true,
    delimiter: '',            // auto-detect: comma or tab
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  if (parseErrors.length && data.length === 0) {
    return { imported: 0, skipped: 0, errors: parseErrors.map(e => e.message) }
  }

  // Fetch accounts and categories for matching
  const { data: accounts } = await supabase.from('accounts').select('id, name')
  const accountMap = new Map((accounts ?? []).map(a => [a.name.toLowerCase(), a.id]))

  const { data: categories } = await supabase.from('categories').select('id, name')
  const categoryMap = new Map((categories ?? []).map(c => [c.name.toLowerCase(), c.id]))

  const rows: Record<string, unknown>[] = []
  const skippedHashes = new Set<string>()
  const errors: string[] = []

  for (const row of data) {
    try {
      const date = normalizeDate(row.Date?.trim())
      const payee = row.Payee?.trim() ?? ''
      const rawAmount = row.Amount?.trim() ?? '0'
      const amount = parseFloat(rawAmount.replace(/[$,\s]/g, ''))

      if (!date || !payee) {
        errors.push(`Skipped — missing date or payee: ${JSON.stringify(row)}`)
        continue
      }

      const accountName = (row['Account Name'] ?? row.Account ?? '').trim()
      const account_id = accountMap.get(accountName.toLowerCase()) ?? null

      const categoryName = row.Category?.trim() ?? ''
      const category_id = categoryMap.get(categoryName.toLowerCase()) ?? null

      // Exclusion column: "yes" means the user excluded it in Simplifi
      const is_ignored = row.Exclusion?.trim().toLowerCase() === 'yes'

      const importKey = `${date}|${payee}|${amount}|${accountName}`
      const import_hash = await sha256(importKey)

      if (skippedHashes.has(import_hash)) continue
      skippedHashes.add(import_hash)

      rows.push({
        id: crypto.randomUUID(),
        account_id,
        category_id,
        date,
        payee,
        amount,
        memo: row.Note?.trim() || null,
        transaction_type: amount < 0 ? 'debit' : 'credit',
        merchant_name: null,
        tags: row.Tags ? row.Tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
        is_recurring: false,
        is_transfer: false,
        is_ignored,
        notes: null,
        upload_id: uploadId,
        simplifi_id: null,
        import_hash,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    } catch (e) {
      errors.push(`Row error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Upsert in batches of 500
  let imported = 0
  let skipped = 0
  const BATCH = 500

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error, count } = await supabase
      .from('transactions')
      .upsert(batch, { onConflict: 'import_hash', ignoreDuplicates: true })
      .select('id', { count: 'exact', head: true })

    if (error) {
      errors.push(`DB error: ${error.message}`)
    } else {
      imported += count ?? 0
      skipped += batch.length - (count ?? 0)
    }
  }

  return { imported, skipped, errors }
}

const MONTH_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
}

/**
 * Normalize Simplifi date formats to ISO 8601 (YYYY-MM-DD).
 *   13-Mar-26   → 2026-03-13  (Simplifi 2025+ export)
 *   13 Mar 2026 → 2026-03-13
 *   03/13/2026  → 2026-03-13
 *   2026-03-13  → 2026-03-13
 */
function normalizeDate(raw: string): string {
  if (!raw) return ''

  // DD-Mon-YY  e.g. "13-Mar-26"
  const dmyShort = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/)
  if (dmyShort) {
    const month = MONTH_MAP[dmyShort[2].toLowerCase()]
    const year = `20${dmyShort[3]}`   // 26 → 2026
    if (month) return `${year}-${month}-${dmyShort[1].padStart(2, '0')}`
  }

  // DD Mon YYYY  e.g. "13 Mar 2026"
  const dmyLong = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/)
  if (dmyLong) {
    const month = MONTH_MAP[dmyLong[2].toLowerCase()]
    if (month) return `${dmyLong[3]}-${month}-${dmyLong[1].padStart(2, '0')}`
  }

  // MM/DD/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  return ''
}
