#!/usr/bin/env node
// Imports the clinic's existing professionals from a CSV file (plan Phase 4 Task 4a.19, P4-20).
// Runbook: docs/runbooks/import-professionals.md. Running it against staging is Jonathan's call.
//
//   node scripts/import-professionals.mjs --file <csv> [--commit] [--url <api>] [--anon-key <key>] [--report <csv>]
//
// - A dry run by default: every row goes through import_professional(row, true), which runs the
//   app's own RPCs and rolls them back. Nothing is written. --commit dry-runs every row first, writes
//   nothing if any row has an error, then asks for confirmation and imports row by row (each row
//   is all or nothing; a re-run skips the emails already present).
// - The target is the local stack (http://127.0.0.1:55321) unless --url names another one; a
//   remote one must be https and the operator types its project reference back before anything
//   else happens.
// - The person running it signs in with their own account: email and password are asked on the
//   terminal (/dev/tty, the password hidden), never read from a file, an argument or the
//   environment, and never printed. The anon key (public by design) comes from --anon-key or
//   VITE_SUPABASE_ANON_KEY; a secret key (service_role, sb_secret_…) is refused.
// - It prints one line per CSV line and writes a report (import-report-<UTC time>.csv) holding the
//   line number, the email, the status, the record id and the messages: no other personal data.
//   The report is created first (never over an existing file, mode 600) and each line is written
//   and flushed as its row completes.
// - Ctrl-C (or SIGINT / SIGTERM) stops between two rows: the row under way finishes, the session
//   is signed out and the report closed. Running the same --commit again resumes: the rows already
//   created come back « ignoré ».
//
// CSV: UTF-8 (a BOM is fine), comma- or semicolon-separated (read from the header line), RFC 4180
// quotes. Columns (header names are matched without case or accents):
//   prenom, nom, courriel, telephone, ville, province, code_postal, annees_experience,
//   titre_1, permis_1, titre_2, permis_2, langues, clienteles, age_minimum, femmes_seulement,
//   motifs, ivac, activer, retenue, seances_cumulees
// Lists hold keys separated by « ; » (or « , »); in clienteles, « * » after a key marks it
// specialized (adults*;couples). titre_1 is the primary title. age_minimum: the youngest client age
// (0–120, empty for none). femmes_seulement and activer: oui, non or empty (non). A permis may be
// pasted as the website shows it: normalizeLicence keeps the bare number (P4-247).
// retenue (the clinic's retention %, « 27,5 % ») and seances_cumulees (the cumulative sessions
// through last month, « 237,5 ») are numbers typed the Québec way; both need
// professionals.compensation (P4-192).
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { ReadStream, WriteStream } from 'node:tty'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const LOCAL_URL = 'http://127.0.0.1:55321'
const LOCAL_ORIGINS = new Set([LOCAL_URL, 'http://localhost:55321'])
const SUPABASE_HOST = /^([a-z0-9]{20})\.supabase\.co$/

// --- CSV -----------------------------------------------------------------------------------------

export class InputError extends Error {}

/**
 * RFC 4180 records with the physical line each starts on (1 = the header): quoted fields may hold
 * the delimiter, doubled quotes and line breaks; CRLF, LF and CR all end a record; a leading UTF-8
 * BOM is dropped. The delimiter is the header line's: « ; » when it has more of them than commas.
 */
export function parseCsv(text) {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text
  const headerLine = source.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const delimiter = count(headerLine, ';') > count(headerLine, ',') ? ';' : ','
  const records = []
  let cells = []
  let cell = ''
  let quoted = false
  let afterQuote = false
  let line = 1
  let start = 1
  const endCell = () => {
    cells.push(cell)
    cell = ''
    afterQuote = false
  }
  const endRecord = () => {
    endCell()
    records.push({ line: start, cells })
    cells = []
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
        afterQuote = true
      } else {
        if (ch === '\n' || (ch === '\r' && source[i + 1] !== '\n')) line++
        cell += ch
      }
    } else if (ch === delimiter) {
      endCell()
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && source[i + 1] === '\n') i++
      endRecord()
      line++
      start = line
    } else if (afterQuote) {
      throw new InputError(`Ligne ${line} : texte après un guillemet fermant.`)
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else {
      cell += ch
    }
  }
  if (quoted) throw new InputError(`Ligne ${start} : guillemet ouvert jamais fermé.`)
  if (cell !== '' || cells.length > 0 || afterQuote) endRecord()
  return { delimiter, records }
}

const count = (text, ch) => text.split(ch).length - 1

/** The columns the import reads, by their normalised header name. */
export const COLUMNS = [
  'prenom', 'nom', 'courriel', 'telephone', 'ville', 'province', 'code_postal', 'annees_experience',
  'titre_1', 'permis_1', 'titre_2', 'permis_2', 'langues', 'clienteles', 'age_minimum', 'femmes_seulement',
  'motifs', 'ivac', 'activer', 'retenue', 'seances_cumulees',
]
const REQUIRED_COLUMNS = ['prenom', 'nom', 'courriel']

/** « Prénom » → prenom, « Code postal » → code_postal, « Clientèles » → clienteles. */
export function normalizeHeader(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Header checked, blank lines dropped: [{ line, values: { prenom: '…', … } }]. A row with a
 * non-empty cell beyond the header has `values: null`: its cells may sit under the wrong columns,
 * so none is read (buildRows reports it without sending it).
 */
export function readRows(text) {
  const { records } = parseCsv(text)
  const [header, ...body] = records
  if (!header) throw new InputError('Le fichier est vide.')
  const cells = [...header.cells]
  // Empty trailing header cells (a spreadsheet's empty columns) are not columns.
  while (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
  const names = cells.map(normalizeHeader)
  // A first line of data (no header): said without printing any of its cells.
  if (!names.some((n) => COLUMNS.includes(n)) || cells.some((c) => /@|[0-9]{4}/.test(c))) {
    throw new InputError(`La première ligne doit contenir les en-têtes (${COLUMNS.join(', ')}).`)
  }
  const blank = names.indexOf('')
  if (blank !== -1) throw new InputError(`En-tête vide à la colonne ${blank + 1}.`)
  const unknown = names.filter((n) => !COLUMNS.includes(n))
  if (unknown.length > 0) throw new InputError(`Colonnes inconnues : ${unknown.join(', ')}. Colonnes permises : ${COLUMNS.join(', ')}.`)
  const repeated = names.find((n, i) => names.indexOf(n) !== i)
  if (repeated) throw new InputError(`Colonne en double : ${repeated}.`)
  const missing = REQUIRED_COLUMNS.filter((n) => !names.includes(n))
  if (missing.length > 0) throw new InputError(`Colonnes obligatoires absentes : ${missing.join(', ')}.`)
  const rows = []
  for (const record of body) {
    if (record.cells.every((c) => c.trim() === '')) continue
    if (record.cells.slice(names.length).some((c) => c.trim() !== '')) {
      rows.push({ line: record.line, values: null })
      continue
    }
    rows.push({ line: record.line, values: Object.fromEntries(names.map((n, i) => [n, (record.cells[i] ?? '').trim()])) })
  }
  return rows
}

// --- Row → import_professional's payload ---------------------------------------------------------

/** Where an error's field (import_professional's names, the client schemas') sits in the CSV. */
const FIELD_COLUMNS = {
  firstName: 'prenom',
  lastName: 'nom',
  email: 'courriel',
  personalPhone: 'telephone',
  city: 'ville',
  province: 'province',
  postalCode: 'code_postal',
  yearsExperience: 'annees_experience',
  'professions.0.titleId': 'titre_1',
  'professions.0.licenceNumber': 'permis_1',
  'professions.1.titleId': 'titre_2',
  'professions.1.licenceNumber': 'permis_2',
  professions: 'titre_1, titre_2',
  languages: 'langues',
  clienteles: 'clienteles',
  minClientAge: 'age_minimum',
  womenOnly: 'femmes_seulement',
  motifs: 'motifs',
  ivac: 'ivac',
  activate: 'activer',
  retentionPct: 'retenue',
  cumulativeSessions: 'seances_cumulees',
}
export const columnOf = (field) => (field == null ? 'ligne' : (FIELD_COLUMNS[field] ?? field))

const splitList = (cell) =>
  cell
    .split(/[;,]/)
    .map((k) => k.trim())
    .filter((k) => k !== '')

/** Keys with an optional « * » (specialized): adults*;couples → [{key, specialized}]. */
const starredList = (cell) =>
  splitList(cell).map((item) => (item.endsWith('*') ? { key: item.slice(0, -1).trim(), specialized: true } : { key: item, specialized: false }))

const STAR_ONLY = 'Le « * » ne s’applique qu’aux clientèles.'

/** oui → true, non or empty → false, anything else → null (an error for the caller). */
const yesNo = (cell) => {
  const value = (cell ?? '').toLowerCase()
  return value === 'oui' ? true : value === '' || value === 'non' ? false : null
}

/**
 * The acronyms a permis cell may start with: the seeded orders', and « OTSFCQ », a typo of
 * OTSTCFQ on the clinic's website (P4-247). OTSTCFQ before OTSFCQ is irrelevant: whole words.
 */
const ORDER_ACRONYMS = { OPQ: 'OPQ', OTSTCFQ: 'OTSTCFQ', OTSFCQ: 'OTSTCFQ', OPPQ: 'OPPQ', OPSQ: 'OPSQ', OCCOQ: 'OCCOQ', ODNQ: 'ODNQ' }

/**
 * A permis cell → the bare licence number (P4-247), as the website's « Membre de l’OPQ 10000-20 »
 * lines read: the « Membre de l’ » prefix and an order acronym before the number are dropped (the
 * order comes from the title; « OTSFCQ » is read as OTSTCFQ), trailing punctuation is dropped
 * (« 1000020, »), and a 7-digit OPPQ number gets its dash (« 1000020 » → « 10000-20 », the order's
 * NNNNN-AA format, P4-248). A membership of an association that is not an order (« Membre de RITMA
 * 1234 ») is not a licence: { error }. Anything else is sent as is, for the database to check.
 */
export function normalizeLicence(cell, titleKey = '') {
  let value = cell.trim().replace(/[\s.,;:]+$/u, '')
  const member = /^membre\s+de\s+(?:l\s*['’]\s*)?/iu.exec(value)
  if (member) value = value.slice(member[0].length)
  let order = null
  const prefix = /^([A-Za-z]{2,10})\s+(?=\S)/u.exec(value)
  if (prefix) {
    const acronym = prefix[1].toUpperCase()
    if (acronym in ORDER_ACRONYMS) {
      order = ORDER_ACRONYMS[acronym]
      value = value.slice(prefix[0].length)
    } else if (member) {
      return { error: `${acronym} n’est pas un ordre professionnel : une adhésion n’est pas un permis (laissez permis vide, notez-la au profil public).` }
    }
  }
  if (/^[0-9]{7}$/.test(value) && (order === 'OPPQ' || titleKey.trim().toLowerCase() === 'psychoeducateur')) {
    value = `${value.slice(0, 5)}-${value.slice(5)}`
  }
  return { value }
}

/**
 * A number typed the Québec way → a JSON number, or null when the cell is not one: « 27,5 »,
 * « 27.5 », « 1 237,5 » (spaces, no-break ones included, between groups of three digits). Only the
 * shape is checked here; the bounds (0–100 %, half sessions…) are import_professional's.
 */
export function parseQuebecNumber(cell) {
  const text = cell.replace(/[\u00a0\u202f]/g, ' ').trim()
  if (!/^-?(?:[0-9]+|[0-9]{1,3}(?: [0-9]{3})+)(?:[.,][0-9]+)?$/.test(text)) return null
  const value = Number(text.replaceAll(' ', '').replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

/** The CSV's numeric columns: a percent sign is allowed after the retention (« 27,5 % »). */
const NUMBERS = [
  ['retenue', 'retention_pct', 'retentionPct', /\s*%$/, 'Indiquez un pourcentage, par exemple 27,5 ou 27,5 %.'],
  ['seances_cumulees', 'cumulative_sessions', 'cumulativeSessions', null, 'Indiquez un nombre de séances, par exemple 237 ou 237,5.'],
]

/**
 * One CSV row → { payload, errors }. Only what the CSV encodes is checked here (numbers, oui/non,
 * stars, the title columns); every value is checked by import_professional, with the app's rules.
 * Empty cells are left out.
 */
export function rowToPayload(values) {
  const errors = []
  const payload = {}
  const text = (column, key) => {
    if (values[column]) payload[key] = values[column]
  }
  text('prenom', 'first_name')
  text('nom', 'last_name')
  text('courriel', 'email')
  text('telephone', 'personal_phone')
  text('ville', 'city')
  text('province', 'province')
  text('code_postal', 'postal_code')
  text('ivac', 'ivac')
  const years = values.annees_experience ?? ''
  if (/^[0-9]{1,3}$/.test(years)) payload.years_experience = Number(years)
  else if (years !== '') errors.push({ field: 'yearsExperience', message: 'Entre 0 et 60 ans.' })

  const professions = professionsOf(values, errors)
  if (professions.length > 0) payload.professions = professions
  for (const [column, key] of [['langues', 'languages'], ['motifs', 'motifs']]) {
    const keys = splitList(values[column] ?? '')
    if (keys.some((k) => k.endsWith('*'))) errors.push({ field: key, message: STAR_ONLY })
    else if (keys.length > 0) payload[key] = keys
  }
  const clienteles = starredList(values.clienteles ?? '')
  if (clienteles.some((i) => i.key === '')) errors.push({ field: 'clienteles', message: 'Une clé manque avant le « * ».' })
  else if (clienteles.length > 0) payload.clienteles = clienteles
  const minAge = values.age_minimum ?? ''
  if (/^[0-9]{1,3}$/.test(minAge)) payload.min_client_age = Number(minAge)
  else if (minAge !== '') errors.push({ field: 'minClientAge', message: 'Entre 0 et 120 ans.' })
  const womenOnly = yesNo(values.femmes_seulement)
  if (womenOnly === null) errors.push({ field: 'womenOnly', message: 'Indiquez oui ou non.' })
  else if (womenOnly) payload.women_only = true
  const activate = yesNo(values.activer)
  if (activate === null) errors.push({ field: 'activate', message: 'Indiquez oui ou non.' })
  else if (activate) payload.activate = true
  // Never the cell in the message: the value is the clinic's, not something to print.
  for (const [column, key, field, suffix, message] of NUMBERS) {
    const cell = (values[column] ?? '').trim()
    if (cell === '') continue
    const value = parseQuebecNumber(suffix ? cell.replace(suffix, '') : cell)
    if (value === null) errors.push({ field, message })
    else payload[key] = value
  }
  return { payload, errors }
}

/** titre_1 / permis_1, titre_2 / permis_2 → [{title_key, licence_number?, is_primary}]; titre_1 is the primary. */
function professionsOf(values, errors) {
  const professions = []
  for (const n of [1, 2]) {
    const title = values[`titre_${n}`] ?? ''
    const licence = values[`permis_${n}`] ?? ''
    if (title === '') {
      if (licence !== '') errors.push({ field: `professions.${n - 1}.licenceNumber`, message: 'Un numéro de permis demande un titre.' })
      continue
    }
    if (n === 2 && professions.length === 0) {
      errors.push({ field: 'professions.0.titleId', message: 'Indiquez le titre principal dans titre_1.' })
      continue
    }
    const normalized = licence === '' ? null : normalizeLicence(licence, title)
    if (normalized?.error) {
      errors.push({ field: `professions.${n - 1}.licenceNumber`, message: normalized.error })
      continue
    }
    professions.push({ title_key: title, ...(normalized && { licence_number: normalized.value }), is_primary: n === 1 })
  }
  return professions
}

const TOO_WIDE = 'Plus de cellules que de colonnes (un séparateur de trop ?) : la ligne n’est ni lue ni envoyée à la base.'

/**
 * Every row's payload and its CSV errors. An email (case ignored) or an IVAC number (trimmed,
 * upper-cased, as stored) repeated in the file is an error from its second line on. A row too
 * broken to read has `payload: null` and no email (its cells may be shifted).
 */
export function buildRows(text) {
  const emails = new Map()
  const ivacs = new Map()
  const firstSeen = (seen, value, line) => {
    if (value === '') return null
    if (seen.has(value)) return seen.get(value)
    seen.set(value, line)
    return null
  }
  return readRows(text).map(({ line, values }) => {
    if (values === null) return { line, email: '', payload: null, errors: [{ field: null, message: TOO_WIDE }] }
    const { payload, errors } = rowToPayload(values)
    const emailLine = firstSeen(emails, (values.courriel ?? '').toLowerCase(), line)
    if (emailLine !== null) errors.push({ field: 'email', message: `Courriel déjà présent à la ligne ${emailLine} du fichier.` })
    const ivacLine = firstSeen(ivacs, (values.ivac ?? '').trim().toUpperCase(), line)
    if (ivacLine !== null) errors.push({ field: 'ivac', message: `Numéro IVAC déjà présent à la ligne ${ivacLine} du fichier.` })
    return { line, email: values.courriel ?? '', payload, errors }
  })
}

// --- Target --------------------------------------------------------------------------------------

/**
 * The API to call: the local stack by default. Another one must be https, without path, query or
 * credentials, and is confirmed by typing its project reference (the first label of
 * <ref>.supabase.co) or, for another host name, the host name itself.
 */
export function resolveTarget(urlArg) {
  if (urlArg === undefined) return { url: LOCAL_URL, local: true, confirmWith: null }
  let url
  try {
    url = new URL(urlArg)
  } catch {
    throw new InputError(`Adresse invalide : ${urlArg}`)
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new InputError('L’adresse doit être celle du projet seulement (https://<référence>.supabase.co).')
  }
  if (LOCAL_ORIGINS.has(url.origin)) return { url: url.origin, local: true, confirmWith: null }
  if (isLoopback(url.hostname)) {
    throw new InputError(`Adresse refusée : ${url.origin}. Sur cet ordinateur, seules ${[...LOCAL_ORIGINS].join(' et ')} sont permises.`)
  }
  if (url.protocol !== 'https:') {
    throw new InputError(`Adresse refusée : ${url.origin}. Seule la base locale (${LOCAL_URL}) est permise en http.`)
  }
  const ref = SUPABASE_HOST.exec(url.hostname)?.[1]
  return { url: url.origin, local: false, confirmWith: ref ?? url.hostname }
}

/** This computer under any name (another port, https, 127.x, ::1, *.localhost): never a remote project. */
function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '[::]' ||
    /^\[::ffff:(7f|0:)/.test(host)
  )
}

const SECRET_KEY =
  'Cette clé est une clé secrète (service_role) : elle passe outre les permissions et ne sert jamais à l’import. ' +
  'Utilisez la clé publique du projet (anon, ou sb_publishable_…).'

/** The anon key is public; a secret key (a JWT whose role is service_role, or sb_secret_…) is refused, never echoed. */
export function checkPublicKey(key) {
  if (key.startsWith('sb_secret_')) throw new InputError(SECRET_KEY)
  const parts = key.split('.')
  if (parts.length !== 3) return
  let role
  try {
    role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role
  } catch {
    role = undefined
  }
  if (role === 'service_role') throw new InputError(SECRET_KEY)
}

// --- Terminal ------------------------------------------------------------------------------------

export class Aborted extends Error {}

/**
 * The controlling terminal (/dev/tty), so credentials are typed there even when stdin or stdout are
 * redirected; tests pass `input` and `output` streams instead. `ask` shows what is typed,
 * `askHidden` shows nothing; Ctrl-C or Ctrl-D at a prompt aborts it (Aborted).
 *
 * Raw mode is set once, before anything is written, and kept until `close`: an answer typed as
 * soon as a prompt shows is never echoed by the terminal, the password included, and keys typed
 * between prompts are dropped unseen. In raw mode Ctrl-C is a key, not a signal: between prompts
 * it calls `onInterrupt` (the run then stops after the row under way). Escape sequences (arrow
 * keys and the like) are ignored.
 */
export function openTerminal({ input: givenInput, output: givenOutput, onInterrupt = () => {} } = {}) {
  let input = givenInput
  let output = givenOutput
  if (!input || !output) {
    let inFd
    let outFd
    try {
      inFd = openSync('/dev/tty', 'r')
      outFd = openSync('/dev/tty', 'w')
    } catch {
      if (inFd !== undefined) closeSync(inFd)
      throw new InputError('Aucun terminal : l’import demande vos identifiants au clavier.')
    }
    input = new ReadStream(inFd)
    output = new WriteStream(outFd)
  }
  input.setRawMode(true)
  input.setEncoding('utf8')

  let pending = null // the prompt being answered: { value, hidden, resolve, reject }
  let escape = 0 // 1 after ESC, 2 inside a CSI / SS3 sequence
  const settle = (error) => {
    const prompt = pending
    pending = null
    output.write('\n')
    if (error) prompt.reject(error)
    else prompt.resolve(prompt.value)
  }
  const onData = (chunk) => {
    for (const ch of chunk) {
      if (escape === 1) {
        escape = ch === '[' || ch === 'O' ? 2 : 0
        continue
      }
      if (escape === 2) {
        if (ch >= '@' && ch <= '~') escape = 0
        continue
      }
      if (ch === '\u001b') {
        escape = 1
        continue
      }
      if (ch === '\u0003') {
        if (pending) settle(new Aborted('Interrompu.'))
        else onInterrupt()
        continue
      }
      if (!pending) continue // typed between prompts: dropped, never shown
      if (ch === '\u0004') settle(new Aborted('Interrompu.'))
      else if (ch === '\r' || ch === '\n') settle()
      else if (ch === '\u007f' || ch === '\b') {
        if (pending.value !== '') {
          pending.value = [...pending.value].slice(0, -1).join('')
          if (!pending.hidden) output.write('\b \b')
        }
      } else if (ch >= ' ' && !(ch >= '\u0080' && ch <= '\u009f')) {
        pending.value += ch
        if (!pending.hidden) output.write(ch)
      }
    }
    if (escape === 1) escape = 0 // a lone ESC at the end of a chunk is the Escape key
  }
  input.on('data', onData)
  input.resume()

  const read = (question, hidden) =>
    new Promise((resolve, reject) => {
      if (pending) return reject(new Error('Une question attend déjà sa réponse.'))
      pending = { value: '', hidden, resolve, reject }
      output.write(question)
    })
  return {
    ask: (question) => read(question, false),
    askHidden: (question) => read(question, true),
    say: (text) => output.write(`${text}\n`),
    /** Aborts the prompt under way, if any (a signal while a question waits); true when there was one. */
    interruptPrompt: () => {
      if (!pending) return false
      settle(new Aborted('Interrompu.'))
      return true
    },
    close: () => {
      if (pending) settle(new Aborted('Interrompu.'))
      input.off('data', onData)
      try {
        input.setRawMode(false)
      } finally {
        input.destroy()
        output.destroy()
      }
    },
  }
}

// --- Report and summary --------------------------------------------------------------------------

const MISSING_LABELS = {
  profession: 'titre',
  licence: 'permis',
  regulated_title: 'titre d’un ordre (motif réservé)',
  language: 'langue',
  clientele: 'clientèle',
  motif: 'motif',
}

/** What an ok row does (or did): « activé », « activé (dossier incomplet : clientèle, motif) », « non activé ». */
function outcomeText(result) {
  if (!result.activated) return 'non activé (« À inviter »)'
  if (result.complete) return 'activé'
  const missing = (result.missing ?? []).map((k) => MISSING_LABELS[k] ?? k).join(', ')
  return `activé, dossier incomplet (${missing})`
}

/**
 * Counts, never the lists themselves (motifs: a summary, never a wall); the retention and the
 * cumulative sessions are named when given, never their values.
 */
function contentText(payload) {
  const parts = [
    [payload.professions?.length, 'titre', 'titres'],
    [payload.languages?.length, 'langue', 'langues'],
    [payload.clienteles?.length, 'clientèle', 'clientèles'],
    [payload.motifs?.length, 'motif', 'motifs'],
  ]
  const flags = [
    ['retention_pct', 'retenue'],
    ['cumulative_sessions', 'séances cumulées'],
  ]
  return [
    ...parts.filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`),
    ...flags.filter(([key]) => key in payload).map(([, label]) => label),
  ].join(', ')
}

/** CSV order: the row as a whole first, then column by column (a stable sort keeps each side's order). */
const columnRank = (field) => (field == null ? -1 : COLUMNS.indexOf(columnOf(field).split(',')[0]))
const errorsText = (errors) =>
  [...errors].sort((a, b) => columnRank(a.field) - columnRank(b.field)).map((e) => `${columnOf(e.field)} : ${e.message}`)

/**
 * One entry per CSV row: { line, email, status: ok | skipped | error, id, details: string[] }, and
 * for an ok row whether it is (or would be) activated, and with an incomplete file. `result` is
 * import_professional's (null when the row was not sent); the CSV's errors and the database's are
 * listed together, so one dry run names everything to fix (P4-122).
 */
export function describe(row, result) {
  const base = { line: row.line, email: row.email, id: null, activated: false, incomplete: false }
  const dbErrors = result?.status === 'error' ? result.errors : []
  if (row.errors.length > 0 || dbErrors.length > 0) return { ...base, status: 'error', details: errorsText([...row.errors, ...dbErrors]) }
  if (result.status === 'skipped') return { ...base, status: 'skipped', id: result.id ?? null, details: [result.reason] }
  const details = [contentText(row.payload), outcomeText(result)].filter(Boolean).join(' · ')
  return { ...base, status: 'ok', id: result.id ?? null, activated: result.activated, incomplete: result.activated && !result.complete, details: [details] }
}

/** « 3 à créer (2 activés, dont 1 avec un dossier incomplet) · 1 déjà présent · 0 en erreur ». */
export function summaryText(entries, dryRun) {
  const ok = entries.filter((e) => e.status === 'ok')
  const activated = ok.filter((e) => e.activated).length
  const incomplete = ok.filter((e) => e.incomplete).length
  const detail = activated === 0 ? '' : ` (${activated} activé(s)${incomplete > 0 ? `, dont ${incomplete} avec un dossier incomplet` : ''})`
  const skipped = entries.filter((e) => e.status === 'skipped').length
  const errors = entries.filter((e) => e.status === 'error').length
  return `Résumé : ${ok.length} ${dryRun ? 'à créer' : 'créé(s)'}${detail} · ${skipped} déjà présent(s) · ${errors} en erreur.`
}

const STATUS_LABELS = { ok: 'ok', skipped: 'ignoré', error: 'erreur' }

export function printEntry(e, out) {
  out(`Ligne ${e.line} · ${e.email || '(sans courriel)'} · ${STATUS_LABELS[e.status]}`)
  for (const d of e.details) out(`    ${d}`)
}
/**
 * A cell as RFC 4180 writes it; a leading = + - @, tab or carriage return is neutralised so a
 * spreadsheet never runs it as a formula.
 */
function csvCell(value) {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const csvLine = (cells) => `${cells.map(csvCell).join(',')}\r\n`
export const REPORT_HEADER = csvLine(['ligne', 'courriel', 'mode', 'statut', 'id', 'details'])
/** One report line: line number, email, mode, status, record id and messages; no other personal data. */
export const reportLine = (e, mode) => csvLine([String(e.line), e.email, mode, STATUS_LABELS[e.status], e.id ?? '', e.details.join(' | ')])
export const reportCsv = (entries, mode) => REPORT_HEADER + entries.map((e) => reportLine(e, mode)).join('')

/**
 * The report file, claimed before anything is asked or imported: created with 'wx' (an existing
 * file is never replaced) and mode 600 (it holds emails). Each `write` is flushed to disk, so an
 * interrupted run keeps every line written so far. `close(discard)` removes a report that holds no
 * row (the run stopped before the first one), so the same --report can be used again.
 */
export function openReportFile(path, fs = { openSync, writeSync, fsyncSync, closeSync, unlinkSync }) {
  let fd
  try {
    fd = fs.openSync(path, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') throw new InputError(`Le rapport ${path} existe déjà : il n’est pas remplacé. Choisissez un autre --report.`)
    throw new InputError(`Rapport impossible à créer : ${path} (${error?.code ?? 'erreur'}).`)
  }
  return {
    write: (text) => {
      fs.writeSync(fd, text)
      fs.fsyncSync(fd)
    },
    close: (discard) => {
      fs.closeSync(fd)
      if (discard) fs.unlinkSync(path)
    },
  }
}

export const reportName = (now) => `import-report-${now.toISOString().replace(/[-:]/g, '').replace(/\.[0-9]+Z$/, 'Z')}.csv`

// --- Run -----------------------------------------------------------------------------------------

const USAGE = `Usage : node scripts/import-professionals.mjs --file <csv> [--commit] [--url <api>] [--anon-key <clé>] [--report <csv>]
  Sans --commit : essai, rien n'est écrit. Base par défaut : ${LOCAL_URL}.`

export function parseCli(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        file: { type: 'string' },
        commit: { type: 'boolean', default: false },
        url: { type: 'string' },
        'anon-key': { type: 'string' },
        report: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    throw new InputError(`${error.message}\n${USAGE}`)
  }
  const { values } = parsed
  return { file: values.file, commit: values.commit, url: values.url, anonKey: values['anon-key'], report: values.report, help: values.help }
}

/** import_professional for one row; a database error (permission, contract, network) stops the run. */
async function callImport(client, payload, dryRun) {
  const { data, error } = await client.rpc('import_professional', { p_row: payload, p_dry_run: dryRun })
  if (error) throw new InputError(`Erreur de la base (${error.code || 'réseau'}) : ${error.message}`)
  return data
}

/**
 * Every row through import_professional, each printed and written to the report as it completes
 * (a database error that stops the pass leaves the lines done so far in the report). Stops between
 * two rows once a stop is requested. A dry run also sends the rows with CSV errors (when they could
 * be read) so the database's errors join them; a real pass never sends a row in error. `entries`
 * holds the rows done, even when an error stops the pass.
 */
async function pass(ctx, rows, dryRun, entries = []) {
  for (const row of rows) {
    if (ctx.stop.requested) break
    const send = row.payload !== null && (dryRun || row.errors.length === 0)
    const entry = describe(row, send ? await callImport(ctx.client, row.payload, dryRun) : null)
    entries.push(entry)
    ctx.report.write(reportLine(entry, dryRun ? 'essai' : 'import'))
    ctx.report.lines++
    printEntry(entry, ctx.out)
  }
  return entries
}

/** Signs in on the terminal; the password lives only in this call. */
async function signIn(client, terminal) {
  const email = (await terminal.ask('Courriel : ')).trim()
  const { error } = await client.auth.signInWithPassword({ email, password: await terminal.askHidden('Mot de passe : ') })
  if (error) throw new InputError('Connexion refusée : vérifiez le courriel et le mot de passe.')
}

const RESUME = 'Pour reprendre, relancez la même commande avec --commit (et un nouveau --report) : les lignes déjà créées reviendront « ignoré ».'

/**
 * The whole run; returns the exit code: 0 done, 1 a row in error or the import cancelled (a prompt
 * answered with Ctrl-C included), 2 the run stopped (arguments, file, target, report, sign-in, a
 * database error, an interruption between rows).
 * `deps` (terminal, client, report file, signals, clock, output) is injected so tests run it
 * without a terminal, a database or a file; the command line below always wires the real ones.
 */
export async function run(argv, deps) {
  const { out } = deps
  const ctx = { out, stop: { requested: false }, client: null, report: null, terminal: null }
  let unsubscribe
  const requestStop = () => {
    if (ctx.stop.requested) return
    ctx.stop.requested = true
    // A question under way is aborted; otherwise the row under way finishes first.
    if (!ctx.terminal?.interruptPrompt?.()) out('Arrêt demandé : la ligne en cours se termine, puis l’import s’arrête.')
  }
  try {
    const cli = parseCli(argv)
    if (cli.help || !cli.file) {
      out(USAGE)
      return cli.help ? 0 : 2
    }
    const target = resolveTarget(cli.url)
    const anonKey = cli.anonKey ?? deps.env.VITE_SUPABASE_ANON_KEY
    if (!anonKey) throw new InputError('Clé anon manquante : --anon-key <clé> ou VITE_SUPABASE_ANON_KEY.')
    checkPublicKey(anonKey)
    const rows = buildRows(deps.readFile(cli.file))
    if (rows.length === 0) throw new InputError('Aucune ligne à importer.')

    // The report first: an existing path stops the run before any question or call.
    const reportPath = cli.report ?? reportName(deps.now())
    ctx.report = { path: reportPath, lines: 0, ...deps.openReport(reportPath) }
    ctx.report.write(REPORT_HEADER)
    unsubscribe = deps.onSignals(requestStop)

    ctx.terminal = deps.openTerminal({ onInterrupt: requestStop })
    if (!target.local) {
      ctx.terminal.say(`Base distante : ${target.url}`)
      const typed = (await ctx.terminal.ask('Tapez la référence du projet pour confirmer : ')).trim()
      if (typed !== target.confirmWith) throw new InputError('Référence différente : rien n’a été fait.')
    }
    if (ctx.stop.requested) throw new Aborted('Interrompu.')
    ctx.client = deps.createClient(target.url, anonKey)
    await signIn(ctx.client, ctx.terminal)
    if (ctx.stop.requested) throw new Aborted('Interrompu.')

    out(`Essai sur ${target.url} (rien n’est écrit) : ${rows.length} ligne(s).`)
    const entries = await pass(ctx, rows, true)
    out(summaryText(entries, true))
    if (entries.length < rows.length) {
      out(`Essai interrompu après ${entries.length} ligne(s) sur ${rows.length} : rien n’a été écrit.`)
      return 2
    }
    const errors = entries.some((e) => e.status === 'error')
    if (!cli.commit || errors || !entries.some((e) => e.status === 'ok')) {
      if (cli.commit) out(errors ? 'Rien n’a été importé : corrigez les erreurs, puis relancez.' : 'Rien à importer.')
      return errors ? 1 : 0
    }
    return await commit(ctx, target, rows, entries)
  } catch (error) {
    if (!(error instanceof InputError) && !(error instanceof Aborted)) throw error
    out(error.message)
    return error instanceof Aborted ? 1 : 2
  } finally {
    unsubscribe?.()
    // Always: sign out, close the report (with every line written so far), give the terminal back.
    if (ctx.client) {
      try {
        await ctx.client.auth.signOut({ scope: 'local' })
      } catch {
        out('Déconnexion : la session locale est abandonnée.')
      }
    }
    if (ctx.report) {
      ctx.report.close(ctx.report.lines === 0)
      if (ctx.report.lines > 0) out(`Rapport : ${ctx.report.path}`)
    }
    ctx.terminal?.close()
  }
}

/** Confirmed by typing « importer »; then row by row, for real. */
async function commit(ctx, target, rows, dryEntries) {
  if (ctx.stop.requested) throw new Aborted('Interrompu.')
  const count = dryEntries.filter((e) => e.status === 'ok').length
  const typed = await ctx.terminal.ask(`Importer ${count} professionnel(s) dans ${target.url} ? Tapez « importer » pour confirmer : `)
  if (typed.trim() !== 'importer') {
    ctx.out('Import annulé : rien n’a été écrit.')
    return 1
  }
  ctx.out('Import :')
  const entries = []
  let done = false
  try {
    await pass(ctx, rows, false, entries)
    done = entries.length === rows.length
  } finally {
    // Also when a database error stops the pass: what was imported is counted and in the report.
    ctx.out(summaryText(entries, false))
    if (!done) ctx.out(`Import arrêté après ${entries.length} ligne(s) sur ${rows.length}. ${RESUME}`)
  }
  if (!done) return 2
  return entries.some((e) => e.status === 'error') ? 1 : 0
}

function decodeUtf8(path) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))
  } catch (error) {
    if (error instanceof TypeError) throw new InputError('Le fichier n’est pas en UTF-8 : enregistrez-le en « CSV UTF-8 ».')
    throw new InputError(`Fichier illisible : ${path}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await run(process.argv.slice(2), {
    env: process.env,
    out: (line) => process.stdout.write(`${line}\n`),
    readFile: decodeUtf8,
    openReport: (path) => openReportFile(path),
    onSignals: (handler) => {
      process.on('SIGINT', handler)
      process.on('SIGTERM', handler)
      return () => {
        process.off('SIGINT', handler)
        process.off('SIGTERM', handler)
      }
    },
    now: () => new Date(),
    openTerminal,
    createClient: (url, key) => createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
  })
  process.exitCode = code
}
