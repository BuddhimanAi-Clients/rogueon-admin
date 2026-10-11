import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileArchive, FileSpreadsheet, Folder, FolderOpen, Image as ImageIcon, Loader2, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiRequest } from '../lib/api'
import { filesFromFolder, filesFromZip, parseImport, withImageType, type ParsedImport, type SheetRow, type SourceFile } from '../lib/import-files'

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

  async function check(nextRows: SheetRow[], photos: ParsedImport['photos'], confirmed: string[], fakeList: string[] = parsed?.fakePngs ?? []) {
    setBusy('checking'); setProblem(null)
    try {
      const response = await apiRequest<{ data: Plan }>('/api/v1/admin/imports/products/check', { method: 'POST', body: JSON.stringify({ rows: nextRows, photos, confirmedNew: confirmed }) })
      // Files named .png that are not really PNG are found in the browser.
      const renamed: Issue[] = (fakeList ?? []).map((path) => ({ row: null, field: 'Photos', message: `"${path}" is named .png but is not a real PNG (it was probably renamed). Open it and save or export it as PNG.` }))
      setPlan({ ...response.data, errors: [...renamed, ...response.data.errors] })
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
      await check(next.rows, next.photos, [], next.fakePngs)
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
                body.append('images', withImageType(await file.blob(), photo.file), photo.file)
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
          <span>Add many products at once: one Excel file plus a folder of photos, in three steps.</span>
        </div>
        {(parsed || result) && <a className="admin-secondary" href="/templates/rogueon-products-template.xlsx" download><Download />Excel template</a>}
      </header>

      {!parsed && !result && (
        <section className="import-guide">
          <ol className="guide-steps">
            <li className="guide-step">
              <span className="guide-num">1</span>
              <div className="guide-body">
                <div className="guide-text">
                  <h2>Fill in the Excel template</h2>
                  <p>Download the template and write <b>one row for every size of every colour</b>. Rows with the same product name become one product.</p>
                  <a className="admin-primary" href="/templates/rogueon-products-template.xlsx" download><Download />Download Excel template</a>
                  <small>Dark columns must be filled. Categories, web addresses and SKUs are created for you.</small>
                </div>
                <figure className="guide-visual">
                  <div className="sheet-mock" role="img" aria-label="Example: three rows in the Excel file make one product with two colours">
                    <div className="sheet-head"><span>Category</span><span>Product name</span><span>Colour</span><span>Size</span><span>Price</span><span>Stock</span></div>
                    {[['Grey', 'M', '28'], ['Grey', 'L', '12'], ['Black', 'M', '20']].map(([colour, size, stock]) => (
                      <div className="sheet-row" key={colour + size}><span>Hoodie</span><span className="hl">Project Requiem Zipup</span><span className="hl">{colour}</span><span>{size}</span><span>4500</span><span>{stock}</span></div>
                    ))}
                  </div>
                  <figcaption><b>3 rows</b> → 1 product · 2 colours · 3 sizes</figcaption>
                </figure>
              </div>
            </li>

            <li className="guide-step">
              <span className="guide-num">2</span>
              <div className="guide-body">
                <div className="guide-text">
                  <h2>Put the photos in folders</h2>
                  <ul className="guide-rules">
                    <li><Folder /><span>Make a folder called <b>photos</b> next to the Excel file.</span></li>
                    <li><Folder /><span>Inside it, one folder per product, named <b>exactly like the Product name</b> in Excel.</span></li>
                    <li><Folder /><span>Inside that, one folder per <b>colour</b>. Photos left outside a colour folder show for every colour.</span></li>
                    <li><ImageIcon /><span>Name the photos <b>1.png, 2.png, 3.png…</b> in the order they should appear. <b>PNG only.</b></span></li>
                  </ul>
                </div>
                <figure className="guide-visual">
                  <div className="tree-mock" role="img" aria-label="Example folder layout">
                    <div className="t0"><Folder className="dir" />My import</div>
                    <div className="t1"><FileSpreadsheet className="xls" />products.xlsx<em>the filled template</em></div>
                    <div className="t1"><Folder className="dir" />photos</div>
                    <div className="t2"><Folder className="dir" />Project Requiem Zipup<em>= Product name</em></div>
                    <div className="t3 files"><span><ImageIcon />1.png</span><span><ImageIcon />2.png</span><em>all colours</em></div>
                    <div className="t3"><Folder className="dir" />Grey<em>= Colour</em></div>
                    <div className="t4 files"><span><ImageIcon />1.png</span><span><ImageIcon />2.png</span></div>
                    <div className="t3"><Folder className="dir" />Black</div>
                    <div className="t4 files"><span><ImageIcon />1.png</span><span><ImageIcon />2.png</span></div>
                  </div>
                </figure>
              </div>
            </li>

            <li className="guide-step">
              <span className="guide-num">3</span>
              <div className="guide-body single">
                <div className="guide-text">
                  <h2>Upload it here</h2>
                  <p>Select the whole <b>My import</b> folder. Nothing is saved yet: you will see a check of everything first.</p>
                </div>
                <div className="guide-upload">
                  <button type="button" className="upload-card main" disabled={busy !== null} onClick={() => folderInput.current?.click()}>
                    <FolderOpen /><span><strong>Choose folder</strong><small>Select the folder with the Excel file and the photos folder</small></span><em>Recommended</em>
                  </button>
                  <button type="button" className="upload-card" disabled={busy !== null} onClick={() => zipInput.current?.click()}>
                    <FileArchive /><span><strong>Choose zip file</strong><small>Only if everything was sent to you as one .zip</small></span>
                  </button>
                  <input ref={zipInput} hidden type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void load(filesFromZip(file)) }} />
                  <input ref={folderInput} hidden type="file" multiple {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(event) => { if (event.target.files?.length) void load(filesFromFolder(event.target.files)) }} />
                </div>
                {busy === 'reading' && <p className="import-status"><Loader2 className="spin" />Reading the files…</p>}
                <p className="guide-safe"><ShieldCheck />Importing the same files again is safe. Products, sizes and photos already in the store are skipped, and stock is never changed.</p>
              </div>
            </li>
          </ol>
        </section>
      )}

      {problem && <div className="import-problem" role="alert"><AlertTriangle /><div><strong>Something needs fixing</strong><p>{problem}</p></div><button type="button" className="admin-table-action" onClick={reset}>Start again</button></div>}

      {parsed && !result && (
        <section className="admin-panel">
          <header>
            <h2>4 · Check before importing</h2>
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
                  <h3>Must be fixed before importing ({plan.errors.length})</h3>
                  <p>Correct these in the Excel file or the photos folder, then choose the files again.</p>
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
            <button type="button" className="admin-primary" disabled={!ready || busy !== null} onClick={() => void runImport()}><Upload />{busy === 'importing' ? 'Importing…' : 'Import now'}</button>
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
