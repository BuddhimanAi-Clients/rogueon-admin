import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileArchive, FolderOpen, Loader2, RefreshCw, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiRequest } from '../lib/api'
import { filesFromFolder, filesFromZip, parseImport, type ParsedImport, type SheetRow, type SourceFile } from '../lib/import-files'

type Issue = { row: number | null; field: string; message: string }
type Suggestion = { key: string; kind: 'category' | 'product' | 'colour'; value: string; suggestion: string; rows: number[] }
type PlannedPhoto = { path: string; colour: string | null; file: string; alreadyImported: boolean }
type Summary = {
  rows: number
  categories: { new: number; existing: number }
  products: { new: number; existing: number }
  variants: { new: number; existing: number }
  photos: { toUpload: number; alreadyImported: number; notAttached: number }
}
type Plan = { errors: Issue[]; warnings: Issue[]; suggestions: Suggestion[]; summary: Summary }
type Applied = { importId: string; summary: Summary; products: Array<{ id: string; name: string; created: boolean; photos: PlannedPhoto[] }> }
type ImportRun = { id: string; createdAt: string; completedAt: string | null; summary: Partial<Summary> & { photosResult?: { uploaded: number; skipped: number; failed: number } | null }; actor: { name: string } | null }
type Progress = { done: number; total: number; label: string }
type Result = { products: number; uploaded: number; skipped: number; failed: string[] }

const FIELD_BY_KIND: Record<Suggestion['kind'], Array<keyof SheetRow>> = { category: ['category', 'parentCategory'], product: ['productName'], colour: ['colour'] }
const KIND_LABEL: Record<Suggestion['kind'], string> = { category: 'Category', product: 'Product', colour: 'Colour' }
const PHOTO_BATCH = 4

function same(left: string | undefined, right: string) {
  return (left ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === right.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function ImportPage() {
  const client = useQueryClient()
  const zipInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [rows, setRows] = useState<SheetRow[]>([])
  const [confirmedNew, setConfirmedNew] = useState<string[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState<'reading' | 'checking' | 'importing' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const history = useQuery({ queryKey: ['admin-product-imports'], queryFn: async () => (await apiRequest<{ data: ImportRun[] }>('/api/v1/admin/imports/products')).data })

  function reset() {
    setParsed(null); setRows([]); setConfirmedNew([]); setPlan(null); setProblem(null); setProgress(null); setResult(null)
    if (zipInput.current) zipInput.current.value = ''
    if (folderInput.current) folderInput.current.value = ''
  }

  async function check(nextRows: SheetRow[], photos: ParsedImport['photos'], confirmed: string[]) {
    setBusy('checking'); setProblem(null)
    try {
      const response = await apiRequest<{ data: Plan }>('/api/v1/admin/imports/products/check', { method: 'POST', body: JSON.stringify({ rows: nextRows, photos, confirmedNew: confirmed }) })
      setPlan(response.data)
    } catch (error) {
      setPlan(null); setProblem(error instanceof Error ? error.message : 'The file could not be checked.')
    } finally { setBusy(null) }
  }

  async function load(source: Promise<SourceFile[]> | SourceFile[]) {
    reset(); setBusy('reading')
    try {
      const next = await parseImport(await source)
      if (next.rows.length === 0) throw new Error('The Excel file has column titles but no product rows.')
      setParsed(next); setRows(next.rows)
      await check(next.rows, next.photos, [])
    } catch (error) {
      setBusy(null); setProblem(error instanceof Error ? error.message : 'The files could not be read.')
    }
  }

  function acceptSuggestion(suggestion: Suggestion) {
    if (!parsed) return
    const fields = FIELD_BY_KIND[suggestion.kind]
    const nextRows = rows.map((row) => {
      let changed = row
      for (const field of fields) {
        if (field !== 'row' && same(row[field] as string | undefined, suggestion.value)) changed = { ...changed, [field]: suggestion.suggestion }
      }
      return changed
    })
    setRows(nextRows)
    void check(nextRows, parsed.photos, confirmedNew)
  }

  function keepAsNew(suggestion: Suggestion) {
    if (!parsed) return
    const next = [...confirmedNew, suggestion.key]
    setConfirmedNew(next)
    void check(rows, parsed.photos, next)
  }

  async function runImport() {
    if (!parsed || !plan) return
    setBusy('importing'); setProblem(null)
    try {
      setProgress({ done: 0, total: 1, label: 'Creating categories, products and variants…' })
      const applied = (await apiRequest<{ data: Applied }>('/api/v1/admin/imports/products/apply', { method: 'POST', body: JSON.stringify({ rows, photos: parsed.photos, confirmedNew }) })).data
      const pending = applied.products.flatMap((product) => product.photos.filter((photo) => !photo.alreadyImported).map((photo) => ({ product, photo })))
      let done = 0; let uploaded = 0
      let skipped = applied.products.reduce((count, product) => count + product.photos.filter((photo) => photo.alreadyImported).length, 0)
      const failed: string[] = []
      setProgress({ done, total: pending.length, label: pending.length ? 'Uploading photos…' : 'Finishing…' })
      for (const product of applied.products) {
        // One colour at a time, a few photos per request, in numbered order.
        const colours = [...new Set(product.photos.filter((photo) => !photo.alreadyImported).map((photo) => photo.colour))]
        for (const colour of colours) {
          const photos = product.photos.filter((photo) => !photo.alreadyImported && photo.colour === colour)
          for (let start = 0; start < photos.length; start += PHOTO_BATCH) {
            const batch = photos.slice(start, start + PHOTO_BATCH)
            setProgress({ done, total: pending.length, label: `${product.name}${colour ? ` · ${colour}` : ''}` })
            try {
              const body = new FormData()
              for (const photo of batch) {
                const file = parsed.files.get(photo.path)
                if (!file) throw new Error('file missing')
                body.append('images', await file.blob(), photo.file)
              }
              if (colour) body.append('color', colour)
              body.append('skipExisting', 'true')
              const response = await apiRequest<{ meta?: { added: number; skipped: number } }>(`/api/v1/admin/products/${product.id}/images`, { method: 'POST', body })
              uploaded += response.meta?.added ?? batch.length
              skipped += response.meta?.skipped ?? 0
            } catch (error) {
              const reason = error instanceof Error ? error.message : 'upload failed'
              batch.forEach((photo) => failed.push(`${photo.path} — ${reason}`))
            }
            done += batch.length
            setProgress({ done, total: pending.length, label: `${product.name}${colour ? ` · ${colour}` : ''}` })
          }
        }
      }
      await apiRequest(`/api/v1/admin/imports/products/${applied.importId}/complete`, { method: 'POST', body: JSON.stringify({ photos: { uploaded, skipped, failed: failed.length } }) }).catch(() => undefined)
      setResult({ products: applied.products.length, uploaded, skipped, failed })
      client.invalidateQueries({ queryKey: ['admin-product-imports'] })
      client.invalidateQueries({ queryKey: ['admin-products'] })
      client.invalidateQueries({ queryKey: ['admin-categories'] })
      toast.success(failed.length ? 'Import finished with some photos not uploaded' : 'Import finished')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The import could not be completed.')
    } finally { setBusy(null); setProgress(null) }
  }

  const ready = Boolean(plan && plan.errors.length === 0 && plan.suggestions.length === 0)
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <main className="admin-page import-page">
      <Link className="admin-back" to="/products"><ArrowLeft />Products</Link>
      <header className="admin-page-head">
        <div>
          <p>CATALOGUE CONTROL</p>
          <h1>IMPORT PRODUCTS</h1>
          <span>Load many products at once from one Excel file and a folder of photos. Nothing is saved until you press Import.</span>
        </div>
        <a className="admin-secondary" href="/templates/rogueon-products-template.xlsx" download><Download />Excel template</a>
      </header>

      {!parsed && !result && (
        <section className="admin-panel import-start">
          <header><h2>1 · Choose your files</h2></header>
          <div className="import-choose">
            <button type="button" className="import-drop" disabled={busy !== null} onClick={() => zipInput.current?.click()}>
              <FileArchive /><strong>Choose a zip file</strong><small>One zip holding the Excel file and the photos folder</small>
            </button>
            <button type="button" className="import-drop" disabled={busy !== null} onClick={() => folderInput.current?.click()}>
              <FolderOpen /><strong>Choose a folder</strong><small>The folder itself, without zipping it. Best for very large photo sets</small>
            </button>
            <input ref={zipInput} hidden type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void load(filesFromZip(file)) }} />
            <input ref={folderInput} hidden type="file" multiple {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(event) => { if (event.target.files?.length) void load(filesFromFolder(event.target.files)) }} />
          </div>
          {busy === 'reading' && <p className="import-status"><Loader2 className="spin" />Reading the files…</p>}
          <div className="import-howto">
            <div>
              <h3>What goes in</h3>
              <pre>{`rogueon-drop/
  products.xlsx
  photos/
    Project Requiem Zipup/
      1.jpg  2.jpg          general photos
      Grey/1.jpg  2.jpg     photos of the grey one
      Black/1.jpg  2.jpg`}</pre>
            </div>
            <ul>
              <li>One Excel row per size and colour. Rows with the same product name become one product.</li>
              <li>Categories are created if they do not exist yet. Web addresses and SKUs are created for you.</li>
              <li>Photo folders are named after the product; a sub-folder is named after the colour. Number the files in the order they should show.</li>
              <li>Running the same files again is safe: nothing is duplicated, and stock on existing variants is not changed.</li>
            </ul>
          </div>
        </section>
      )}

      {problem && <div className="import-problem" role="alert"><AlertTriangle /><div><strong>Something needs fixing</strong><p>{problem}</p></div><button type="button" className="admin-table-action" onClick={reset}>Start again</button></div>}

      {parsed && !result && (
        <section className="admin-panel">
          <header>
            <h2>2 · Check</h2>
            <span>{parsed.sheetName} · {rows.length} rows · {parsed.photos.length} photos found</span>
          </header>
          {busy === 'checking' && <p className="import-status"><Loader2 className="spin" />Checking…</p>}
          {plan && (
            <div className="import-report">
              <div className="import-tiles">
                <article><span>Categories</span><strong>{plan.summary.categories.new}</strong><small>new · {plan.summary.categories.existing} already exist</small></article>
                <article><span>Products</span><strong>{plan.summary.products.new}</strong><small>new · {plan.summary.products.existing} already exist</small></article>
                <article><span>Variants</span><strong>{plan.summary.variants.new}</strong><small>new · {plan.summary.variants.existing} price updates</small></article>
                <article><span>Photos</span><strong>{plan.summary.photos.toUpload}</strong><small>to upload · {plan.summary.photos.alreadyImported} already there{plan.summary.photos.notAttached ? ` · ${plan.summary.photos.notAttached} not attached` : ''}</small></article>
              </div>

              {plan.suggestions.length > 0 && (
                <div className="import-block">
                  <h3>Possible spelling mistakes ({plan.suggestions.length})</h3>
                  <p>Answer each one so a typo does not become a new {plan.suggestions.some((item) => item.kind === 'colour') ? 'colour' : 'name'}.</p>
                  {plan.suggestions.map((suggestion) => (
                    <article className="import-suggestion" key={suggestion.key}>
                      <p><em>{KIND_LABEL[suggestion.kind]}</em> “<strong>{suggestion.value}</strong>” looks like “<strong>{suggestion.suggestion}</strong>”<small>Row{suggestion.rows.length > 1 ? 's' : ''} {suggestion.rows.slice(0, 8).join(', ')}{suggestion.rows.length > 8 ? '…' : ''}</small></p>
                      <div>
                        <button type="button" className="admin-primary" disabled={busy !== null} onClick={() => acceptSuggestion(suggestion)}>Use “{suggestion.suggestion}”</button>
                        <button type="button" className="admin-table-action" disabled={busy !== null} onClick={() => keepAsNew(suggestion)}>Keep “{suggestion.value}” as new</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {plan.errors.length > 0 && (
                <div className="import-block errors">
                  <h3>Must be fixed in the Excel file ({plan.errors.length})</h3>
                  <p>Correct these rows, save the file, and choose it again.</p>
                  <ul className="import-issues">{plan.errors.slice(0, 200).map((issue, index) => <li key={index}><b>{issue.row ? `Row ${issue.row}` : 'File'}</b><span>{issue.field}</span><p>{issue.message}</p></li>)}</ul>
                </div>
              )}

              {(plan.warnings.length > 0 || parsed.notes.length > 0) && (
                <details className="import-block warnings" open={plan.errors.length === 0 && plan.suggestions.length === 0}>
                  <summary>Worth a look, but will not stop the import ({plan.warnings.length + parsed.notes.length})</summary>
                  <ul className="import-issues">
                    {parsed.notes.map((note, index) => <li key={`note-${index}`}><b>File</b><span>Note</span><p>{note}</p></li>)}
                    {plan.warnings.slice(0, 300).map((issue, index) => <li key={index}><b>{issue.row ? `Row ${issue.row}` : 'File'}</b><span>{issue.field}</span><p>{issue.message}</p></li>)}
                  </ul>
                </details>
              )}

              {ready && <p className="import-ready"><CheckCircle2 />Everything checks out. New products are saved as written in the Status column (draft if empty).</p>}
            </div>
          )}
          <footer className="import-actions">
            <button type="button" className="admin-table-action" disabled={busy !== null} onClick={reset}><RefreshCw />Choose different files</button>
            <button type="button" className="admin-primary" disabled={!ready || busy !== null} onClick={() => void runImport()}><Upload />{busy === 'importing' ? 'Importing…' : '3 · Import'}</button>
          </footer>
          {progress && (
            <div className="import-progress" role="status">
              <div><span style={{ width: `${progress.total ? percent : 100}%` }} /></div>
              <p>{progress.label}{progress.total > 0 ? ` — ${progress.done} of ${progress.total} photos` : ''}</p>
              <small>Keep this page open until it finishes.</small>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="admin-panel import-done">
          <header><h2>Import finished</h2><CheckCircle2 /></header>
          <div className="import-tiles">
            <article><span>Products</span><strong>{result.products}</strong><small>created or updated</small></article>
            <article><span>Photos uploaded</span><strong>{result.uploaded}</strong><small>{result.skipped} already there</small></article>
            <article className={result.failed.length ? 'bad' : ''}><span>Photos not uploaded</span><strong>{result.failed.length}</strong><small>{result.failed.length ? 'choose the same files again to retry' : 'none'}</small></article>
          </div>
          {result.failed.length > 0 && <ul className="import-issues">{result.failed.slice(0, 100).map((line) => <li key={line}><b>Photo</b><span>Failed</span><p>{line}</p></li>)}</ul>}
          <footer className="import-actions">
            <button type="button" className="admin-table-action" onClick={reset}>Import more</button>
            <Link className="admin-primary" to="/products">View products</Link>
          </footer>
        </section>
      )}

      <section className="admin-panel">
        <header><h2>Past imports</h2><span>Latest 20</span></header>
        {history.data?.length ? (
          <ul className="import-history">
            {history.data.map((run) => (
              <li key={run.id}>
                <strong>{new Date(run.createdAt).toLocaleString()}</strong>
                <span>{run.actor?.name ?? 'Unknown'}</span>
                <span>{run.summary.products?.new ?? 0} new products · {run.summary.variants?.new ?? 0} new variants · {run.summary.photosResult ? `${run.summary.photosResult.uploaded} photos${run.summary.photosResult.failed ? `, ${run.summary.photosResult.failed} failed` : ''}` : 'photos not finished'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="import-empty">{history.isPending ? 'Loading…' : 'No imports yet.'}</p>}
      </section>
    </main>
  )
}
