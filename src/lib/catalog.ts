// Mirrors the server's catalogue text rules so forms can preview what will be
// saved. The server applies the same rules again and is the authority.

export const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'FREE SIZE', '28', '30', '32', '34', '36', '38']

const COLOUR_CODES: Record<string, string> = {
  black: 'BLK', white: 'WHT', grey: 'GRY', navy: 'NVY', blue: 'BLU', red: 'RED', green: 'GRN', brown: 'BRN', beige: 'BGE', cream: 'CRM',
  'off-white': 'OWH', olive: 'OLV', maroon: 'MRN', pink: 'PNK', purple: 'PRP', yellow: 'YLW', orange: 'ORG', charcoal: 'CHR', khaki: 'KHK',
  'light grey': 'LGY', 'dark grey': 'DGY',
}
const COLOUR_ALIASES: Record<string, string> = { gray: 'Grey', gry: 'Grey', blk: 'Black', wht: 'White', 'off white': 'Off-White', offwhite: 'Off-White', 'navy blue': 'Navy' }

export function slugify(value: string) {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120).replace(/-+$/g, '')
}

export function normalizeColour(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return COLOUR_ALIASES[clean.toLowerCase()] ?? clean.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase())
}

export function normalizeSize(value: string) {
  return value.replace(/\s+/g, ' ').trim().toUpperCase()
}

function colourCode(colour: string) {
  const known = COLOUR_CODES[colour.toLowerCase()]
  if (known) return known
  const letters = colour.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const consonants = (letters[0] ?? '') + letters.slice(1).replace(/[AEIOU]/g, '')
  return (consonants.length >= 3 ? consonants : letters).slice(0, 3) || 'CLR'
}

export function buildSku(productName: string, colour: string, size: string) {
  if (!colour.trim() || !size.trim()) return ''
  const product = slugify(productName).toUpperCase().slice(0, 48).replace(/-+$/g, '') || 'ITEM'
  const cleanSize = normalizeSize(size)
  const sizePart = (cleanSize === 'FREE SIZE' ? 'FREE' : cleanSize).replace(/[^A-Z0-9]+/g, '')
  return `${product}-${colourCode(normalizeColour(colour))}-${sizePart || 'OS'}`
}

/** While the slug still matches the old name, it keeps following the name. */
export function followSlug(previousName: string, currentSlug: string, nextName: string) {
  return currentSlug === slugify(previousName) ? slugify(nextName) : currentSlug
}
