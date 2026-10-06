// Reads a product import (one zip, or a chosen folder) entirely in the
// browser: the spreadsheet is parsed here and photos are uploaded one product
// at a time, so even a large import never travels as one huge request.

export type SourceFile = { path: string; blob: () => Promise<Blob> }

export type SheetRow = {
  row: number
  category?: string; parentCategory?: string; productName?: string; description?: string
  colour?: string; size?: string; price?: string; stock?: string; status?: string; memberDiscount?: string; sku?: string
}
export type PhotoRef = { path: string; product: string; colour: string | null; file: string }
export type ParsedImport = { sheetName: string; rows: SheetRow[]; photos: PhotoRef[]; files: Map<string, SourceFile>; notes: string[] }

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number }

function view(buffer: ArrayBuffer) { return new DataView(buffer) }

/** Lists a zip's entries by reading only its index at the end of the file. */
async function readZipIndex(file: Blob): Promise<ZipEntry[]> {
  const tailSize = Math.min(file.size, 66_000)
  const tail = view(await file.slice(file.size - tailSize).arrayBuffer())
  let end = -1
  for (let index = tail.byteLength - 22; index >= 0; index -= 1) {
    if (tail.getUint32(index, true) === 0x06054b50) { end = index; break }
  }
  if (end < 0) throw new Error('This file is not a zip, or it is damaged.')
  const count = tail.getUint16(end + 10, true)
  const size = tail.getUint32(end + 12, true)
  const start = tail.getUint32(end + 16, true)
  if (start === 0xffffffff || count === 0xffff) throw new Error('This zip is too large (over 4 GB). Split it into smaller zips, or choose the folder instead.')
  const directory = view(await file.slice(start, start + size).arrayBuffer())
  const decoder = new TextDecoder('utf-8')
  const entries: ZipEntry[] = []
  let cursor = 0
  for (let index = 0; index < count && cursor + 46 <= directory.byteLength; index += 1) {
    if (directory.getUint32(cursor, true) !== 0x02014b50) break
    const method = directory.getUint16(cursor + 10, true)
    const compressedSize = directory.getUint32(cursor + 20, true)
    const nameLength = directory.getUint16(cursor + 28, true)
    const extraLength = directory.getUint16(cursor + 30, true)
    const commentLength = directory.getUint16(cursor + 32, true)
    const offset = directory.getUint32(cursor + 42, true)
    const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + cursor + 46, nameLength))
    if (!name.endsWith('/')) entries.push({ name, method, compressedSize, offset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function readZipEntry(file: Blob, entry: ZipEntry): Promise<Blob> {
  const header = view(await file.slice(entry.offset, entry.offset + 30).arrayBuffer())
  if (header.getUint32(0, true) !== 0x04034b50) throw new Error(`Could not read "${entry.name}" from the zip.`)
  const dataStart = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true)
  const data = file.slice(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return data
  if (entry.method !== 8) throw new Error(`"${entry.name}" uses a zip format this browser cannot open. Re-create the zip with normal compression.`)
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open zip files. Use a current Chrome, Edge, Firefox or Safari, or choose the folder instead.')
  return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
}

const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/**
 * A file pulled out of a zip has no type, and some folder files lack one too.
 * The server refuses an upload whose declared type does not match its
 * contents, so photos are labelled from their extension before upload.
 */
export function withImageType(blob: Blob, fileName: string): Blob {
  const type = IMAGE_TYPES[fileName.split('.').pop()?.toLowerCase() ?? '']
  return !type || blob.type === type ? blob : new Blob([blob], { type })
}

export async function filesFromZip(zip: File): Promise<SourceFile[]> {
  return (await readZipIndex(zip)).map((entry) => ({ path: entry.name, blob: async () => withImageType(await readZipEntry(zip, entry), entry.name) }))
}

export function filesFromFolder(list: FileList | File[]): SourceFile[] {
  return Array.from(list).map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, blob: async () => withImageType(file, file.name) }))
}

function isJunk(path: string) {
  const name = path.split('/').pop() ?? ''
  return path.includes('__MACOSX/') || name.startsWith('.') || name.startsWith('~$') || name.toLowerCase() === 'thumbs.db' || name.toLowerCase() === 'desktop.ini'
}

const HEADERS: Record<string, keyof Omit<SheetRow, 'row'>> = {
  category: 'category', 'parent category': 'parentCategory', parent: 'parentCategory',
  'product name': 'productName', product: 'productName', name: 'productName',
  description: 'description', colour: 'colour', color: 'colour', size: 'size',
  price: 'price', 'price (npr)': 'price', stock: 'stock', quantity: 'stock', qty: 'stock', 'opening stock': 'stock',
  status: 'status', 'member discount': 'memberDiscount', 'membership discount': 'memberDiscount', sku: 'sku',
}

function columnIndex(reference: string) {
  let index = 0
  for (const character of reference.replace(/[^A-Z]/gi, '').toUpperCase()) index = index * 26 + (character.charCodeAt(0) - 64)
  return index - 1
}

function xml(text: string) { return new DOMParser().parseFromString(text, 'application/xml') }

/** Reads the first worksheet of an .xlsx file into rows keyed by column title. */
async function readSheet(workbook: Blob): Promise<{ rows: SheetRow[]; notes: string[] }> {
  const entries = await readZipIndex(workbook)
  const read = async (name: string) => {
    const entry = entries.find((item) => item.name === name)
    return entry ? (await readZipEntry(workbook, entry)).text() : null
  }
  const sheetName = entries.map((entry) => entry.name).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((left, right) => left.length - right.length || left.localeCompare(right))[0]
  const sheetText = sheetName ? await read(sheetName) : null
  if (!sheetText) throw new Error('The Excel file has no worksheet to read.')
  const sharedText = await read('xl/sharedStrings.xml')
  const shared = sharedText ? Array.from(xml(sharedText).getElementsByTagName('si')).map((item) => Array.from(item.getElementsByTagName('t')).map((node) => node.textContent ?? '').join('')) : []

  const grid: Array<{ number: number; cells: string[] }> = []
  for (const rowNode of Array.from(xml(sheetText).getElementsByTagName('row'))) {
    const cells: string[] = []
    Array.from(rowNode.getElementsByTagName('c')).forEach((cell, position) => {
      const reference = cell.getAttribute('r')
      const index = reference ? columnIndex(reference) : position
      const type = cell.getAttribute('t')
      let value = ''
      if (type === 'inlineStr') value = Array.from(cell.getElementsByTagName('t')).map((node) => node.textContent ?? '').join('')
      else {
        const raw = cell.getElementsByTagName('v')[0]?.textContent ?? ''
        value = type === 's' ? shared[Number(raw)] ?? '' : raw
      }
      cells[index] = value.trim()
    })
    if (cells.some((value) => value)) grid.push({ number: Number(rowNode.getAttribute('r')) || grid.length + 1, cells })
  }
  const header = grid[0]
  if (!header) throw new Error('The Excel file is empty.')
  const mapping = header.cells.map((title) => HEADERS[(title ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/\*$/, '').trim()])
  const required: Array<[keyof SheetRow, string]> = [['category', 'Category'], ['productName', 'Product name'], ['colour', 'Colour'], ['size', 'Size'], ['price', 'Price'], ['stock', 'Stock']]
  const missing = required.filter(([key]) => !mapping.includes(key as keyof Omit<SheetRow, 'row'>)).map(([, label]) => label)
  if (missing.length) throw new Error(`The Excel file is missing these columns in its first row: ${missing.join(', ')}. Use the template so the column titles match.`)
  const notes: string[] = []
  const unknown = header.cells.filter((title, index) => title && !mapping[index])
  if (unknown.length) notes.push(`Ignored columns: ${unknown.join(', ')}`)

  const rows: SheetRow[] = []
  for (const line of grid.slice(1)) {
    const row: SheetRow = { row: line.number }
    mapping.forEach((key, index) => { const value = line.cells[index]; if (key && value) row[key] = value })
    if (Object.keys(row).length > 1) rows.push(row)
  }
  return { rows, notes }
}

/** Turns the chosen files into spreadsheet rows and a list of photos. */
export async function parseImport(source: SourceFile[]): Promise<ParsedImport> {
  const usable = source.filter((file) => !isJunk(file.path))
  const sheets = usable.filter((file) => /\.xlsx$/i.test(file.path)).sort((left, right) => left.path.split('/').length - right.path.split('/').length)
  const sheet = sheets[0]
  if (!sheet) throw new Error('No Excel file (.xlsx) was found. Put the filled-in template next to the photos folder.')
  const { rows, notes } = await readSheet(await sheet.blob())
  if (sheets.length > 1) notes.push(`More than one Excel file was found; "${sheet.path.split('/').pop()}" was used.`)

  const photos: PhotoRef[] = []
  const files = new Map<string, SourceFile>()
  for (const file of usable) {
    const parts = file.path.split('/').filter(Boolean)
    const at = parts.findIndex((part) => part.toLowerCase() === 'photos')
    if (at < 0) continue
    const rest = parts.slice(at + 1)
    if (rest.length === 2) photos.push({ path: file.path, product: rest[0]!, colour: null, file: rest[1]! })
    else if (rest.length === 3) photos.push({ path: file.path, product: rest[0]!, colour: rest[1]!, file: rest[2]! })
    else { notes.push(`"${file.path}" is not inside a product folder and was ignored.`); continue }
    files.set(file.path, file)
  }
  if (photos.length === 0) notes.push('No "photos" folder was found, so products will be created without photos.')
  // Numbered files upload in order: 1.jpg, 2.jpg, 10.jpg.
  photos.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' }))
  return { sheetName: sheet.path.split('/').pop() ?? sheet.path, rows, photos, files, notes }
}
