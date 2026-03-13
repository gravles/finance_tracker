import Papa from 'papaparse'
import { sha256 } from './utils'
import { supabase } from './supabase'

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export interface CsvPreflight {
  ok: boolean
  delimiter: string
  rowCount: number
  columns: string[]
  missingColumns: string[]
  dateFormat: string | null       // detected date format example
  sampleRows: Record<string, string>[]
  warnings: string[]
}

// Simplifi columns — required vs optional
const REQUIRED_COLUMNS = ['Date', 'Payee', 'Amount']
const OPTIONAL_COLUMNS = ['Account', 'Account Name', 'Category', 'Tags', 'Exclusion', 'Note']

/**
 * Analyse a file before import — returns diagnostics so the UI
 * can show the user what was detected and catch problems early.
 */
export async function preflightCsv(file: File): Promise<CsvPreflight> {
  const text = await file.text()
  const warnings: string[] = []

  const { data, meta, errors } = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter: '',        // auto-detect
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
    preview: 5,           // only parse first 5 rows for preflight
  })

  const delimiter = meta.delimiter === '\t' ? 'tab' : `"${meta.delimiter}"`
  const columns = meta.fields ?? []

  const missingColumns = REQUIRED_COLUMNS.filter(
    c => !columns.includes(c)
  )

  if (errors.length) {
    warnings.push(...errors.slice(0, 3).map(e => `Parse warning: ${e.message}`))
  }

  // Try to detect date format from first non-empty date value
  const firstDate = data.find(r => r.Date?.trim())?.Date?.trim() ?? null
  const dateFormat = firstDate ? describeDateFormat(firstDate) : null

  if (firstDate && !normalizeDate(firstDate)) {
    warnings.push(`Unrecognised date format: "${firstDate}" — import may fail`)
  }

  // Check for Amount column with spaces (Simplifi adds a leading space)
  const firstAmount = data.find(r => r.Amount?.trim())?.Amount ?? ''
  if (firstAmount.startsWith(' ')) {
    warnings.push('Amount column has leading spaces — will be trimmed automatically')
  }

  // Full row count (re-parse without preview limit just for count)
  const { data: allData } = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter: meta.delimiter,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  return {
    ok: missingColumns.length === 0,
    delimiter,
    rowCount: allData.length,
    columns,
    missingColumns,
    dateFormat,
    sampleRows: data.slice(0, 3),
    warnings,
  }
}

export async function importSimplifiCsv(
  file: File,
  uploadId: string,
): Promise<ImportResult> {
  const text = await file.text()

  const { data, meta, errors: parseErrors } = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter: '',
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  if (parseErrors.length && data.length === 0) {
    return { imported: 0, skipped: 0, errors: parseErrors.map(e => e.message) }
  }

  const { data: accounts } = await supabase.from('accounts').select('id, name')
  const accountMap = new Map((accounts ?? []).map(a => [a.name.toLowerCase(), a.id]))

  const { data: categories } = await supabase.from('categories').select('id, name')
  const categoryMap = new Map((categories ?? []).map(c => [c.name.toLowerCase(), c.id]))

  const rows: Record<string, unknown>[] = []
  const skippedHashes = new Set<string>()
  const errors: string[] = []

  for (const row of data) {
    try {
      const rawDate = row.Date?.trim() ?? ''
      const date = normalizeDate(rawDate)
      const payee = row.Payee?.trim() ?? ''
      const rawAmount = row.Amount?.trim() ?? '0'
      const amount = parseFloat(rawAmount.replace(/[$,\s]/g, ''))

      if (!date) {
        errors.push(`Unrecognised date "${rawDate}" for payee "${payee || '—'}"`)
        continue
      }
      if (!payee) {
        errors.push(`Missing payee on ${rawDate}`)
        continue
      }
      if (isNaN(amount)) {
        errors.push(`Invalid amount "${row.Amount}" for ${payee} on ${rawDate}`)
        continue
      }

      const accountName = (row['Account Name'] ?? row['Account'] ?? '').trim()
      const account_id = accountMap.get(accountName.toLowerCase()) ?? null

      const categoryName = row['Category']?.trim() ?? ''
      const category_id = categoryMap.get(categoryName.toLowerCase()) ?? null

      const is_ignored = row['Exclusion']?.trim().toLowerCase() === 'yes'

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
        memo: row['Note']?.trim() || null,
        transaction_type: amount < 0 ? 'debit' : 'credit',
        merchant_name: null,
        tags: row['Tags'] ? row['Tags'].split(',').map((t: string) => t.trim()).filter(Boolean) : [],
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

  // Surface delimiter info for debugging
  if (meta.delimiter !== ',' && meta.delimiter !== '\t') {
    errors.push(`Unexpected delimiter detected: "${meta.delimiter}"`)
  }

  return { imported, skipped, errors }
}

// ─── Date normalisation ───────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', sept:'09', oct:'10', nov:'11', dec:'12',
  january:'01', february:'02', march:'03', april:'04', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
}

/**
 * Normalise any Simplifi date variant to ISO YYYY-MM-DD.
 *
 *   30 Sept 2025  →  2025-09-30   (full 4-digit year, "Sept" variant)
 *   13 Mar 2026   →  2026-03-13
 *   13-Mar-26     →  2026-03-13   (2-digit year)
 *   03/13/2026    →  2026-03-13
 *   2026-03-13    →  already ISO
 */
export function normalizeDate(raw: string): string {
  if (!raw) return ''
  const s = raw.trim()

  // DD Mon(th) YYYY  — "30 Sept 2025", "13 Mar 2026", "1 January 2026"
  const dmyLong = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (dmyLong) {
    const month = MONTH_MAP[dmyLong[2].toLowerCase()]
    if (month) return `${dmyLong[3]}-${month}-${dmyLong[1].padStart(2, '0')}`
  }

  // DD-Mon-YY  — "13-Mar-26"
  const dmyShort = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2})$/)
  if (dmyShort) {
    const month = MONTH_MAP[dmyShort[2].toLowerCase()]
    const year = parseInt(dmyShort[3]) < 50 ? `20${dmyShort[3]}` : `19${dmyShort[3]}`
    if (month) return `${year}-${month}-${dmyShort[1].padStart(2, '0')}`
  }

  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  return ''
}

function describeDateFormat(raw: string): string {
  const normalized = normalizeDate(raw)
  return normalized
    ? `"${raw}" → ${normalized} ✓`
    : `"${raw}" — format not recognised`
}
