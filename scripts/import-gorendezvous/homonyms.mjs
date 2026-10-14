// The homonyms of the clients export (security review 2026-10-14). The exports after the clients
// (« Revenus », appointments, consents) often name the client without her ClientId; the database
// then finds the file by its name (`private.clients_import_match`) among the imported files. A
// name several ClientIds hold, or held by a row the clients import refuses (no ClientId, a
// ClientId seen twice), could attach a record to the wrong person: such a row needs its ClientId
// (--clients-map for the invoices, the export's ClientId column otherwise). Pure, no I/O; nothing
// here returns or logs a name.
import { CLIENT_COLUMNS } from './clients.mjs'
import { readTable } from './table.mjs'

// unaccent's ligatures, which a canonical decomposition keeps whole.
const LIGATURES = { œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', đ: 'd', ł: 'l' }

/**
 * A name's matching key, as `private.clients_import_name_key`: accents and case dropped, every
 * other character a separator, the words sorted (« Tremblay, Marie-Ève » = « marie eve tremblay »).
 * Null when no word is left.
 */
export function nameKey(name) {
  const words = String(name ?? '')
    .toLowerCase()
    .replace(/[œæßøđł]/g, (ch) => LIGATURES[ch])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  return words.length > 0 ? words.sort().join(' ') : null
}

/**
 * The clients export → `{ isHomonym(name) }`: true when the name's key is held by more than one
 * ClientId, or by a row the clients import refuses (no ClientId, a ClientId seen twice). A name
 * the export does not hold is not a homonym (the database answers « not found »).
 */
export function readHomonyms(text) {
  const { rows } = readTable(text, { columns: CLIENT_COLUMNS, required: ['clientId', 'firstName', 'lastName'] })
  const holders = new Map()
  const unsure = new Set()
  const seenIds = new Set()
  for (const row of rows) {
    const key = nameKey(`${row.get('firstName')} ${row.get('lastName')}`)
    if (!key) continue
    const id = row.get('clientId')
    if (!holders.has(key)) holders.set(key, new Set())
    if (id === '' || seenIds.has(id)) {
      unsure.add(key)
      holders.get(key).add(`#${row.line}`)
    } else {
      seenIds.add(id)
      holders.get(key).add(id)
    }
  }
  return {
    isHomonym: (name) => {
      const key = nameKey(name)
      return key !== null && (unsure.has(key) || (holders.get(key)?.size ?? 0) > 1)
    },
  }
}

/**
 * The rows that would be matched by a homonym's name: `items` are `{ line, clients }` where
 * `clients` lists `{ client_ref, client_name }`. Returns their lines (each once).
 */
export function linesNeedingClientId(items, isHomonym) {
  return items.filter((item) => item.clients.some((c) => !c.client_ref && isHomonym(c.client_name))).map((item) => item.line)
}
