import { useEffect, useRef, useState } from "react"
import { Navigate, useParams } from "react-router-dom"

import { ApiError, getClient, postUploadHoldings, type ClientRecord } from "@/lib/api"
import { LoadingLine } from "@/components/ui/loading-line"

// Per the App Flow doc's empty-state spec: a client with no holdings yet
// shows an upload prompt here rather than a Dashboard that has nothing real
// to compute from every card would otherwise need to fabricate "no data"
// placeholders for. Once holdings exist, this route just redirects straight
// to the Dashboard — there's nothing else for it to show.
export function ClientEntryPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getClient(clientId)
      .then((c) => {
        if (!cancelled) setClient(c)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load client.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  async function handleFileSelected(file: File) {
    if (!clientId) return
    setUploading(true)
    setUploadError(null)
    try {
      const updated = await postUploadHoldings(clientId, file)
      setClient(updated)
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Could not parse that file.")
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <LoadingLine label="Loading client…" />
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!client || !clientId) return null

  if (client.holdings.length > 0) {
    return <Navigate to={`/clients/${clientId}/dashboard`} replace />
  }

  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 rounded-[12px] border border-dashed border-border bg-card p-10 text-center shadow-[var(--shadow-card)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M12 18v-6" />
          <path d="m9 15 3 3 3-3" />
        </svg>
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[18px] font-semibold text-foreground">No holdings uploaded yet</h1>
        <p className="m-0 text-sm text-muted-foreground">
          Upload {client.name}&rsquo;s holdings as a .csv or .xlsx export to get started. Expected columns: ticker,
          quantity, cost basis, account type.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFileSelected(file)
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="flex h-[38px] cursor-pointer items-center gap-2 rounded-md border border-primary bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
      >
        {uploading ? "Parsing…" : "Upload holdings file"}
      </button>
      {uploadError && <p className="m-0 text-[12px] text-destructive">{uploadError}</p>}
    </div>
  )
}
