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

  // Auto-create accounts found in CSV but missing from DB
  const csvAccountNames = new Set<string>()
  for (const row of data) {
    const name = (row['Account Name'] ?? row['Account'] ?? '').trim()
    if (name && !accountMap.has(name.toLowerCase())) {
      csvAccountNames.add(name)
    }
  }
  if (csvAccountNames.size > 0) {
    const newAccounts = Array.from(csvAccountNames).map(name => ({
      id: crypto.randomUUID(),
      name,
      type: guessAccountType(name),
      institution: '',
      currency: 'CAD',
      is_active: true,
    }))
    const { data: inserted } = await supabase.from('accounts').upsert(newAccounts, { onConflict: 'id' }).select('id, name')
    for (const a of inserted ?? []) {
      accountMap.set(a.name.toLowerCase(), a.id)
    }
  }

  const { data: categories } = await supabase.from('categories').select('id, name')
  const categoryMap = new Map((categories ?? []).map(c => [c.name.toLowerCase(), c.id]))

  // Alias map: Simplifi category strings → our category IDs
  const { data: aliases } = await supabase.from('category_aliases').select('alias, category_id')
  const aliasMap = new Map((aliases ?? []).map(a => [a.alias.toLowerCase(), a.category_id]))

  // Load auto-categorization rules
  const { data: rulesData } = await supabase
    .from('categorization_rules')
    .select('pattern, match_type, category_id, merchant_name, is_recurring')
    .eq('is_active', true)
    .order('priority', { ascending: false })
  const rules = rulesData ?? []

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

      // Simplifi uses "Parent:Child" e.g. "Dining & Drinks:Coffee"
      // Try: full string → child only → parent only → direct name match
      const rawCategory = row['Category']?.trim() ?? ''
      let category_id = resolveCategory(rawCategory, aliasMap, categoryMap)

      // Apply auto-categorization rules if no category resolved
      let merchant_name_from_rule: string | null = null
      let is_recurring_from_rule = false
      const ruleMatch = applyRule(payee, rules)
      if (ruleMatch) {
        if (!category_id) category_id = ruleMatch.category_id
        merchant_name_from_rule = ruleMatch.merchant_name
        is_recurring_from_rule = ruleMatch.is_recurring
      }

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
        merchant_name: merchant_name_from_rule,
        tags: row['Tags'] ? row['Tags'].split(',').map((t: string) => t.trim()).filter(Boolean) : [],
        is_recurring: is_recurring_from_rule,
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
      .upsert(batch, { onConflict: 'import_hash', ignoreDuplicates: false })
      .select('id', { count: 'exact', head: true })

    if (error) {
      errors.push(`DB error: ${error.message}`)
    } else {
      imported += count ?? 0
      skipped += batch.length - (count ?? 0)
    }
  }

  // Backfill account_id on existing transactions that have null account
  // This handles re-imports where accounts were missing on the first import
  const hashToAccount = new Map<string, string>()
  for (const row of rows) {
    if (row.account_id && row.import_hash) {
      hashToAccount.set(row.import_hash as string, row.account_id as string)
    }
  }
  if (hashToAccount.size > 0) {
    const { data: nullAccountTxs } = await supabase
      .from('transactions')
      .select('id, import_hash')
      .is('account_id', null)
      .limit(10000)

    if (nullAccountTxs?.length) {
      // Group by account_id for batch updates
      const byAccount = new Map<string, string[]>()
      for (const tx of nullAccountTxs) {
        if (!tx.import_hash || !hashToAccount.has(tx.import_hash)) continue
        const accId = hashToAccount.get(tx.import_hash)!
        if (!byAccount.has(accId)) byAccount.set(accId, [])
        byAccount.get(accId)!.push(tx.id)
      }
      for (const [accId, ids] of byAccount) {
        // Supabase .in() supports up to ~300 items; chunk if needed
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200)
          await supabase.from('transactions').update({ account_id: accId }).in('id', chunk)
        }
      }
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

  // Mon DD, YYYY  — "Mar 14, 2026"
  const mdyLong = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (mdyLong) {
    const month = MONTH_MAP[mdyLong[1].toLowerCase()]
    if (month) return `${mdyLong[3]}-${month}-${mdyLong[2].padStart(2, '0')}`
  }

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

/**
 * Resolve a Simplifi category string to one of our category IDs.
 * Simplifi format: "Parent:Child" e.g. "Dining & Drinks:Coffee"
 * Resolution order:
 *   1. Full "parent:child" in alias map
 *   2. Full string in alias map
 *   3. Child part alone in alias map
 *   4. Parent part alone in alias map
 *   5. Direct name match in categories table
 */
function resolveCategory(
  raw: string,
  aliasMap: Map<string, string>,
  categoryMap: Map<string, string>,
): string | null {
  if (!raw) return null
  const lower = raw.toLowerCase()

  // 1 & 2 — try the full string as-is in alias map
  if (aliasMap.has(lower)) return aliasMap.get(lower)!

  const colonIdx = lower.indexOf(':')
  if (colonIdx !== -1) {
    const parent = lower.slice(0, colonIdx).trim()
    const child  = lower.slice(colonIdx + 1).trim()

    // 3 — child alone
    if (aliasMap.has(child)) return aliasMap.get(child)!
    if (categoryMap.has(child)) return categoryMap.get(child)!

    // 4 — parent alone
    if (aliasMap.has(parent)) return aliasMap.get(parent)!
    if (categoryMap.has(parent)) return categoryMap.get(parent)!
  }

  // 5 — direct name match
  if (categoryMap.has(lower)) return categoryMap.get(lower)!

  return null
}

function describeDateFormat(raw: string): string {
  const normalized = normalizeDate(raw)
  return normalized
    ? `"${raw}" → ${normalized} ✓`
    : `"${raw}" — format not recognised`
}

interface CsvRule {
  pattern: string
  match_type: string
  category_id: string
  merchant_name: string | null
  is_recurring: boolean
}

function guessAccountType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('visa') || lower.includes('mastercard') || lower.includes('credit') || lower.includes('amex')) return 'credit_card'
  if (lower.includes('savings') || lower.includes('tfsa') || lower.includes('hisa')) return 'savings'
  if (lower.includes('rrsp') || lower.includes('invest') || lower.includes('resp') || lower.includes('fhsa')) return 'investment'
  if (lower.includes('mortgage')) return 'mortgage'
  if (lower.includes('loan') || lower.includes('loc') || lower.includes('line of credit')) return 'loan'
  if (lower.includes('cheq') || lower.includes('check')) return 'chequing'
  return 'other'
}

function applyRule(payee: string, rules: CsvRule[]): CsvRule | null {
  const lower = payee.toLowerCase()
  for (const rule of rules) {
    const pattern = rule.pattern.toLowerCase()
    let matched = false
    switch (rule.match_type) {
      case 'exact':
        matched = lower === pattern
        break
      case 'starts_with':
        matched = lower.startsWith(pattern)
        break
      case 'contains':
      default:
        matched = lower.includes(pattern)
        break
    }
    if (matched) return rule
  }
  return null
}
