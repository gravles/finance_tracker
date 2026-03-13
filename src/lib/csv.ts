import Papa from 'papaparse'
import { sha256 } from './utils'
import { supabase } from './supabase'
import type { SimplifiCsvRow, Transaction } from '@/types'

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

/**
 * Parse a Quicken Simplifi CSV export and upsert transactions into Supabase.
 * Simplifi CSV columns (may vary slightly by export version):
 *   Date, Payee, Amount, "Account Name", Category, Tags, Note
 */
export async function importSimplifiCsv(
  file: File,
  uploadId: string,
): Promise<ImportResult> {
  const text = await file.text()

  const { data, errors: parseErrors } = Papa.parse<SimplifiCsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  if (parseErrors.length) {
    return {
      imported: 0,
      skipped: 0,
      errors: parseErrors.map(e => e.message),
    }
  }

  // Fetch existing accounts to match by name
  const { data: accounts } = await supabase.from('accounts').select('id, name')
  const accountMap = new Map((accounts ?? []).map(a => [a.name.toLowerCase(), a.id]))

  // Fetch categories to map by name
  const { data: categories } = await supabase.from('categories').select('id, name')
  const categoryMap = new Map((categories ?? []).map(c => [c.name.toLowerCase(), c.id]))

  const rows: Omit<Transaction, 'account' | 'category'>[] = []
  const skippedHashes = new Set<string>()
  const errors: string[] = []

  for (const row of data) {
    try {
      const date = normalizeDate(row.Date?.trim())
      const payee = row.Payee?.trim() ?? ''
      const rawAmount = row.Amount?.trim() ?? '0'
      // Simplifi exports expenses as negative, income as positive
      const amount = parseFloat(rawAmount.replace(/[$,]/g, ''))

      if (!date || !payee) {
        errors.push(`Skipped row — missing date or payee: ${JSON.stringify(row)}`)
        continue
      }

      const accountName = row['Account Name']?.trim() ?? ''
      const account_id = accountMap.get(accountName.toLowerCase()) ?? null

      const categoryName = row.Category?.trim() ?? ''
      const category_id = categoryMap.get(categoryName.toLowerCase()) ?? null

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
        tags: row.Tags ? row.Tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        is_recurring: false,
        is_transfer: false,
        is_ignored: false,
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

  // Upsert in batches of 500 to stay under Supabase payload limits
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
      errors.push(`DB upsert error: ${error.message}`)
    } else {
      imported += count ?? 0
      skipped += batch.length - (count ?? 0)
    }
  }

  return { imported, skipped, errors }
}

/**
 * Normalize common date formats to ISO 8601 (YYYY-MM-DD).
 * Simplifi typically exports MM/DD/YYYY.
 */
function normalizeDate(raw: string): string {
  if (!raw) return ''
  // MM/DD/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return ''
}
