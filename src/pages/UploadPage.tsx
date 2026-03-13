import { useCallback, useState, useRef } from 'react'
import { Upload, CheckCircle2, XCircle, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { importSimplifiCsv } from '@/lib/csv'

interface UploadState {
  status: 'idle' | 'uploading' | 'done' | 'error'
  imported?: number
  skipped?: number
  errors?: string[]
}

export default function UploadPage() {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setState({ status: 'error', errors: ['Please upload a .csv file exported from Quicken Simplifi'] })
      return
    }

    setState({ status: 'uploading' })

    // Create upload record
    const { data: uploadRecord, error: uploadErr } = await supabase
      .from('uploads')
      .insert({
        filename: file.name,
        source: 'simplifi_csv',
        status: 'processing',
      })
      .select()
      .single()

    if (uploadErr || !uploadRecord) {
      setState({ status: 'error', errors: ['Failed to create upload record'] })
      return
    }

    const result = await importSimplifiCsv(file, uploadRecord.id)

    // Update upload record
    await supabase
      .from('uploads')
      .update({
        status: result.errors.length ? 'complete' : 'complete',
        row_count: result.imported + result.skipped,
        imported_count: result.imported,
        skipped_count: result.skipped,
        error_log: result.errors,
        completed_at: new Date().toISOString(),
      })
      .eq('id', uploadRecord.id)

    setState({
      status: result.errors.length > 0 && result.imported === 0 ? 'error' : 'done',
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
    })
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-white">Import Transactions</h1>
        <p className="text-sm text-gray-400 mt-1">
          Upload a CSV exported from Quicken Simplifi
        </p>
      </div>

      {/* Instructions */}
      <div className="card-sm space-y-2 text-sm text-gray-400">
        <p className="font-medium text-gray-300">How to export from Simplifi:</p>
        <ol className="list-decimal list-inside space-y-1 text-gray-500">
          <li>Open Simplifi → Transactions</li>
          <li>Click the export icon (top right)</li>
          <li>Select date range → Export CSV</li>
          <li>Upload the file below</li>
        </ol>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors ${
          dragOver
            ? 'border-indigo-500 bg-indigo-500/5'
            : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/20'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={onFileChange}
          className="hidden"
        />
        <div className="w-12 h-12 bg-gray-800 rounded-xl flex items-center justify-center">
          <Upload className="text-gray-400" size={22} />
        </div>
        <div className="text-center">
          <p className="text-white font-medium">Drop your Simplifi CSV here</p>
          <p className="text-gray-500 text-sm mt-1">or click to browse</p>
        </div>
      </div>

      {/* Status */}
      {state.status === 'uploading' && (
        <div className="card-sm flex items-center gap-3 text-gray-300">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Processing CSV…
        </div>
      )}

      {state.status === 'done' && (
        <div className="card-sm space-y-3">
          <div className="flex items-center gap-2 text-green-400 font-medium">
            <CheckCircle2 size={18} />
            Import complete
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-400">Imported</div>
              <div className="text-white font-semibold">{state.imported?.toLocaleString()} transactions</div>
            </div>
            <div>
              <div className="text-gray-400">Skipped (duplicates)</div>
              <div className="text-white font-semibold">{state.skipped?.toLocaleString()}</div>
            </div>
          </div>
          {(state.errors?.length ?? 0) > 0 && (
            <details className="text-xs text-amber-400">
              <summary className="cursor-pointer">{state.errors!.length} warnings</summary>
              <ul className="mt-2 space-y-1 text-gray-500 list-disc list-inside">
                {state.errors!.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
          <button
            onClick={() => setState({ status: 'idle' })}
            className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
          >
            <FileText size={14} /> Import another file
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <div className="card-sm space-y-2">
          <div className="flex items-center gap-2 text-red-400 font-medium">
            <XCircle size={18} />
            Import failed
          </div>
          <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
            {state.errors?.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <button
            onClick={() => setState({ status: 'idle' })}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
