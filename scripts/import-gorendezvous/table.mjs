// A GOrendezvous export as a table (plan §9, batch I1 prep). GOrendezvous exports Excel; the
// clinic saves each sheet as « CSV UTF-8 » (decision I-1: no spreadsheet dependency in the repo).
// The CSV grammar is import-professionals.mjs's (RFC 4180, « , » or « ; », BOM dropped).
import { InputError, parseCsv } from '../import-professionals.mjs'
import { headerKey } from './normalize.mjs'

export { InputError }

/**
 * The text of a file read as bytes: UTF-8 only. Excel's plain « CSV » save on Windows writes
 * Windows-1252, which would turn every accent into garbage silently: refused with what to do.
 */
export function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new InputError('Le fichier n’est pas en UTF-8 : dans Excel, enregistrez-le en « CSV UTF-8 (délimité par des virgules) ».')
  }
}

/** The first record naming every required field: its index and the field → column map, or null. */
function findHeader(records, lookup, required) {
  for (let i = 0; i < Math.min(records.length, HEADER_SEARCH); i++) {
    const found = new Map()
    records[i].cells.forEach((cell, col) => {
      const field = lookup.get(headerKey(cell))
      if (field && !found.has(field)) found.set(field, col)
    })
    if (required.every((field) => found.has(field))) return [i, found]
  }
  return null
}

/** How many leading records may precede the header (an Excel report's title, its filters, a blank line). */
const HEADER_SEARCH = 15

/**
 * Reads an export: `spec.columns` maps each field to the header names it may carry (any case,
 * accents, spaces or punctuation: « Prénom » = « prenom » = « FirstName » when listed), and
 * `spec.required` lists the fields without which the file is refused. The header is the first of the
 * first records that names every required field. Returns the rows (the physical line each starts on,
 * `get(field)` → the trimmed cell or ''), the fields found, and the headers not used (for the
 * report: never a value).
 */
export function readTable(text, spec) {
  const lookup = new Map()
  for (const [field, names] of Object.entries(spec.columns)) {
    for (const name of [field, ...names]) lookup.set(headerKey(name), field)
  }
  // The delimiter is the one under which the header is found: « , » or « ; » (Excel in French
  // writes « ; », and its money cells hold commas; a title line above the header holds neither).
  let records = []
  let headerIndex = -1
  let indexes = null
  for (const delimiter of [';', ',']) {
    let parsed
    try {
      parsed = parseCsv(text, { delimiter }).records
    } catch (error) {
      if (delimiter === ',') throw error
      continue
    }
    const header = findHeader(parsed, lookup, spec.required)
    if (header) {
      records = parsed
      ;[headerIndex, indexes] = header
      break
    }
  }
  if (!indexes) {
    const labels = spec.required.map((field) => `« ${spec.columns[field][0] ?? field} »`).join(', ')
    throw new InputError(`En-tête introuvable : le fichier doit avoir les colonnes ${labels} (dans les ${HEADER_SEARCH} premières lignes).`)
  }
  const header = records[headerIndex].cells
  const unused = header.filter((cell, col) => cell.trim() !== '' && ![...indexes.values()].includes(col)).map((cell) => cell.trim())
  const rows = []
  for (const record of records.slice(headerIndex + 1)) {
    if (record.cells.every((cell) => cell.trim() === '')) continue
    const cells = record.cells
    rows.push({
      line: record.line,
      get: (field) => {
        const col = indexes.get(field)
        return col === undefined ? '' : String(cells[col] ?? '').trim()
      },
    })
  }
  return { rows, fields: [...indexes.keys()], unused }
}
