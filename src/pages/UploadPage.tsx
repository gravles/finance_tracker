import { useCallback, useState, useRef } from 'react'
import { Upload, CheckCircle2, XCircle, FileText, AlertTriangle, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { preflightCsv, importSimplifiCsv } from '@/lib/csv'
import type { CsvPreflight } from '@/lib/csv'

type Stage =
  | { status: 'idle' }
  | { status: 'analysing' }
  | { status: 'preview'; file: File; preflight: CsvPreflight }
  | { status: 'importing' }
  | { status: 'done'; imported: number; skipped: number; errors: string[] }
  | { status: 'error'; errors: string[] }

export default function UploadPage() {
  const [stage, setStage] = useState<Stage>({ status: 'idle' })
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const analyseFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(csv|tsv|txt)$/i)) {
      setStage({ status: 'error', errors: ['Please upload a .csv file exported from Quicken Simplifi'] })
      return
    }
    setStage({ status: 'analysing' })
    const preflight = await preflightCsv(file)
    setStage({ status: 'preview', file, preflight })
  }, [])

  const runImport = useCallback(async (file: File) => {
    setStage({ status: 'importing' })

    const { data: uploadRecord, error: uploadErr } = await supabase
      .from('uploads')
      .insert({ filename: file.name, source: 'simplifi_csv', status: 'processing' })
      .select()
      .single()

    if (uploadErr || !uploadRecord) {
      setStage({ status: 'error', errors: ['Failed to create upload record'] })
      return
    }

    const result = await importSimplifiCsv(file, uploadRecord.id)

    await supabase.from('uploads').update({
      status: 'complete',
      row_count: result.imported + result.skipped,
      imported_count: result.imported,
      skipped_count: result.skipped,
      error_log: result.errors,
      completed_at: new Date().toISOString(),
    }).eq('id', uploadRecord.id)

    if (result.errors.length > 0 && result.imported === 0) {
      setStage({ status: 'error', errors: result.errors })
    } else {
      setStage({ status: 'done', imported: result.imported, skipped: result.skipped, errors: result.errors })
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) analyseFile(file)
  }, [analyseFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) analyseFile(file)
    e.target.value = ''
  }

  const reset = () => setStage({ status: 'idle' })

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-white">Import Transactions</h1>
        <p className="text-sm text-gray-400 mt-1">Upload a CSV exported from Quicken Simplifi</p>
      </div>

      {/* Drop zone — only show when idle */}
      {(stage.status === 'idle' || stage.status === 'analysing') && (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-4 cursor-pointer transition-colors ${
            dragOver
              ? 'border-indigo-500 bg-indigo-500/5'
              : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/20'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,application/csv"
            onChange={onFileChange}
            className="hidden"
          />
          <div className="w-12 h-12 bg-gray-800 rounded-xl flex items-center justify-center">
            {stage.status === 'analysing'
              ? <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              : <Upload className="text-gray-400" size={22} />
            }
          </div>
          <div className="text-center">
            <p className="text-white font-medium">
              {stage.status === 'analysing' ? 'Analysing file…' : 'Drop your Simplifi CSV here'}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              {stage.status === 'analysing' ? 'Checking columns and date format' : 'or tap to browse'}
            </p>
          </div>
        </div>
      )}

      {/* Preflight preview */}
      {stage.status === 'preview' && (
        <PreflightPanel
          preflight={stage.preflight}
          filename={stage.file.name}
          onConfirm={() => runImport(stage.file)}
          onCancel={reset}
        />
      )}

      {/* Importing */}
      {stage.status === 'importing' && (
        <div className="card flex items-center gap-3 text-gray-300">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Importing transactions…
        </div>
      )}

      {/* Done */}
      {stage.status === 'done' && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-green-400 font-medium">
            <CheckCircle2 size={18} /> Import complete
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-400">Imported</div>
              <div className="text-white font-semibold text-xl">{stage.imported.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400">Skipped (duplicates)</div>
              <div className="text-white font-semibold text-xl">{stage.skipped.toLocaleString()}</div>
            </div>
          </div>
          {stage.errors.length > 0 && (
            <details className="text-xs">
              <summary className="text-amber-400 cursor-pointer">{stage.errors.length} rows had issues</summary>
              <ul className="mt-2 space-y-1 text-gray-500 list-disc list-inside max-h-40 overflow-y-auto">
                {stage.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
          <button onClick={reset} className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300">
            <FileText size={14} /> Import another file
          </button>
        </div>
      )}

      {/* Error */}
      {stage.status === 'error' && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2 text-red-400 font-medium">
            <XCircle size={18} /> Import failed
          </div>
          <ul className="text-sm text-gray-400 list-disc list-inside space-y-1 max-h-60 overflow-y-auto">
            {stage.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <button onClick={reset} className="text-sm text-indigo-400 hover:text-indigo-300">Try again</button>
        </div>
      )}
    </div>
  )
}

function PreflightPanel({
  preflight, filename, onConfirm, onCancel,
}: {
  preflight: CsvPreflight
  filename: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="card space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-white">{filename}</p>
          <p className="text-sm text-gray-400 mt-0.5">
            {preflight.rowCount.toLocaleString()} rows · {preflight.delimiter}-separated
          </p>
        </div>
        {preflight.ok
          ? <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded-full">Ready to import</span>
          : <span className="text-xs text-red-400 bg-red-400/10 px-2 py-1 rounded-full">Issues detected</span>
        }
      </div>

      {/* Columns detected */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Columns detected</p>
        <div className="flex flex-wrap gap-1.5">
          {preflight.columns.map(col => (
            <span
              key={col}
              className={`text-xs px-2 py-0.5 rounded-full ${
                ['Date','Payee','Amount'].includes(col)
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'bg-gray-800 text-gray-400'
              }`}
            >
              {col}
            </span>
          ))}
        </div>
      </div>

      {/* Missing required columns */}
      {preflight.missingColumns.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-400/10 rounded-lg p-3">
          <XCircle size={15} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Missing required columns</p>
            <p className="text-red-400/80 text-xs mt-0.5">{preflight.missingColumns.join(', ')}</p>
          </div>
        </div>
      )}

      {/* Date format */}
      {preflight.dateFormat && (
        <div>
          <p className="text-xs text-gray-500 mb-1">Date format</p>
          <p className="text-sm font-mono text-gray-300">{preflight.dateFormat}</p>
        </div>
      )}

      {/* Warnings */}
      {preflight.warnings.length > 0 && (
        <div className="space-y-2">
          {preflight.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-amber-400 bg-amber-400/10 rounded-lg p-3">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="text-xs">{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sample rows */}
      {preflight.sampleRows.length > 0 && (
        <details>
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
            Preview first {preflight.sampleRows.length} rows
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="text-gray-600">
                  {preflight.columns.map(c => <th key={c} className="text-left pr-3 py-1 font-normal">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {preflight.sampleRows.map((row, i) => (
                  <tr key={i} className="text-gray-400 border-t border-gray-800/50">
                    {preflight.columns.map(c => (
                      <td key={c} className="pr-3 py-1.5 max-w-[120px] truncate">{row[c] ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onConfirm}
          disabled={!preflight.ok}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Import {preflight.rowCount.toLocaleString()} rows <ChevronRight size={15} />
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
