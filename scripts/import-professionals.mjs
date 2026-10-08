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
//   VITE_SUPABASE_ANON_KEY.
// - It prints one line per CSV line and writes a report (import-report-<UTC time>.csv) holding the
//   line number, the email, the status, the record id and the messages: no other personal data.
//
// CSV: UTF-8 (a BOM is fine), comma- or semicolon-separated (read from the header line), RFC 4180
// quotes. Columns (header names are matched without case or accents):
//   prenom, nom, courriel, telephone, ville, province, code_postal, annees_experience,
//   titre_1, permis_1, titre_2, permis_2, langues, clienteles, approches, motifs, ivac, activer
// Lists hold keys separated by « ; » (or « , »); in clienteles and approches, « * » after a key marks
// it specialized (adults*;couples). titre_1 is the primary title. activer: oui, non or empty (non).
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
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
  'titre_1', 'permis_1', 'titre_2', 'permis_2', 'langues', 'clienteles', 'approches', 'motifs', 'ivac', 'activer',
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

/** Header checked, blank lines dropped: [{ line, values: { prenom: '…', … } }]. */
export function readRows(text) {
  const { records } = parseCsv(text)
  const [header, ...body] = records
  if (!header) throw new InputError('Le fichier est vide.')
  const names = header.cells.map(normalizeHeader)
  const unknown = names.filter((n) => !COLUMNS.includes(n))
  if (unknown.length > 0) throw new InputError(`Colonnes inconnues : ${unknown.join(', ')}. Colonnes permises : ${COLUMNS.join(', ')}.`)
  const repeated = names.find((n, i) => names.indexOf(n) !== i)
  if (repeated) throw new InputError(`Colonne en double : ${repeated}.`)
  const missing = REQUIRED_COLUMNS.filter((n) => !names.includes(n))
  if (missing.length > 0) throw new InputError(`Colonnes obligatoires absentes : ${missing.join(', ')}.`)
  const rows = []
  for (const record of body) {
    if (record.cells.every((c) => c.trim() === '')) continue
    if (record.cells.length > names.length) throw new InputError(`Ligne ${record.line} : plus de cellules que de colonnes.`)
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
  approaches: 'approches',
  motifs: 'motifs',
  ivac: 'ivac',
  activate: 'activer',
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

const STAR_ONLY = 'Le « * » ne s’applique qu’aux clientèles et aux approches.'

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
  for (const [column, key] of [['clienteles', 'clienteles'], ['approches', 'approaches']]) {
    const items = starredList(values[column] ?? '')
    if (items.some((i) => i.key === '')) errors.push({ field: key, message: 'Une clé manque avant le « * ».' })
    else if (items.length > 0) payload[key] = items
  }
  const activate = (values.activer ?? '').toLowerCase()
  if (activate === 'oui') payload.activate = true
  else if (activate !== '' && activate !== 'non') errors.push({ field: 'activate', message: 'Indiquez oui ou non.' })
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
    professions.push({ title_key: title, ...(licence !== '' && { licence_number: licence }), is_primary: n === 1 })
  }
  return professions
}

/** Every row's payload and its CSV errors; an email repeated in the file is an error from its second line on. */
export function buildRows(text) {
  const seen = new Map()
  return readRows(text).map(({ line, values }) => {
    const { payload, errors } = rowToPayload(values)
    const email = (values.courriel ?? '').toLowerCase()
    if (email !== '' && seen.has(email)) errors.push({ field: 'email', message: `Courriel déjà présent à la ligne ${seen.get(email)} du fichier.` })
    else if (email !== '') seen.set(email, line)
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
  if (url.protocol !== 'https:') {
    throw new InputError(`Adresse refusée : ${url.origin}. Seule la base locale (${LOCAL_URL}) est permise en http.`)
  }
  const ref = SUPABASE_HOST.exec(url.hostname)?.[1]
  return { url: url.origin, local: false, confirmWith: ref ?? url.hostname }
}

// --- Terminal ------------------------------------------------------------------------------------

export class Aborted extends Error {}

/**
 * The controlling terminal (/dev/tty), so credentials are typed there even when stdin or stdout are
 * redirected. `ask` echoes, `askHidden` does not; Ctrl-C or Ctrl-D aborts.
 */
export function openTerminal() {
  let inFd
  let outFd
  try {
    inFd = openSync('/dev/tty', 'r')
    outFd = openSync('/dev/tty', 'w')
  } catch {
    if (inFd !== undefined) closeSync(inFd)
    throw new InputError('Aucun terminal : l’import demande vos identifiants au clavier.')
  }
  const input = new ReadStream(inFd)
  const output = new WriteStream(outFd)
  const read = (question, hidden) =>
    new Promise((resolve, reject) => {
      let value = ''
      const finish = (error) => {
        input.off('data', onData)
        input.setRawMode(false)
        input.pause()
        output.write('\n')
        if (error) reject(error)
        else resolve(value)
      }
      const onData = (chunk) => {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n') return finish()
          if (ch === '\u0003' || ch === '\u0004') return finish(new Aborted('Interrompu.'))
          if (ch === '\u007f' || ch === '\b') {
            if (value !== '') {
              value = [...value].slice(0, -1).join('')
              if (!hidden) output.write('\b \b')
            }
          } else if (ch >= ' ') {
            value += ch
            if (!hidden) output.write(ch)
          }
        }
      }
      // Raw mode (no echo by the terminal) before the question shows: an answer typed as soon as
      // it appears is never echoed, the password included.
      input.setEncoding('utf8')
      input.setRawMode(true)
      input.on('data', onData)
      input.resume()
      output.write(question)
    })
  return {
    ask: (question) => read(question, false),
    askHidden: (question) => read(question, true),
    say: (text) => output.write(`${text}\n`),
    close: () => {
      input.destroy()
      output.destroy()
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

/** Counts, never the lists themselves (motifs: a summary, never a wall). */
function contentText(payload) {
  const parts = [
    [payload.professions?.length, 'titre', 'titres'],
    [payload.languages?.length, 'langue', 'langues'],
    [payload.clienteles?.length, 'clientèle', 'clientèles'],
    [payload.approaches?.length, 'approche', 'approches'],
    [payload.motifs?.length, 'motif', 'motifs'],
  ]
  return parts
    .filter(([n]) => n)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(', ')
}

const errorsText = (errors) => errors.map((e) => `${columnOf(e.field)} : ${e.message}`)

/**
 * One entry per CSV row: { line, email, status: ok | skipped | error, id, details: string[] }, and
 * for an ok row whether it is (or would be) activated, and with an incomplete file.
 */
export function describe(row, result) {
  const base = { line: row.line, email: row.email, id: null, activated: false, incomplete: false }
  if (row.errors.length > 0) return { ...base, status: 'error', details: errorsText(row.errors) }
  if (result.status === 'skipped') return { ...base, status: 'skipped', id: result.id ?? null, details: [result.reason] }
  if (result.status === 'error') return { ...base, status: 'error', details: errorsText(result.errors) }
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
/** A cell as RFC 4180 writes it; a leading = + - @ is neutralised so a spreadsheet never runs it as a formula. */
function csvCell(value) {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** The report: line number, email, mode, status, record id and messages; no other personal data. */
export function reportCsv(entries, mode) {
  const lines = [['ligne', 'courriel', 'mode', 'statut', 'id', 'details']]
  for (const e of entries) lines.push([String(e.line), e.email, mode, STATUS_LABELS[e.status], e.id ?? '', e.details.join(' | ')])
  return `${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`
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
 * Every row through import_professional, printed as it goes, into `entries` (filled even when a
 * database error stops the pass, so the report says what was done). Rows the CSV refused are not sent.
 */
async function pass(client, rows, dryRun, entries, out) {
  for (const row of rows) {
    const entry = describe(row, row.errors.length > 0 ? null : await callImport(client, row.payload, dryRun))
    entries.push(entry)
    printEntry(entry, out)
  }
}

/** Signs in on the terminal; the password lives only in this call. */
async function signIn(client, terminal) {
  const email = (await terminal.ask('Courriel : ')).trim()
  const { error } = await client.auth.signInWithPassword({ email, password: await terminal.askHidden('Mot de passe : ') })
  if (error) throw new InputError('Connexion refusée : vérifiez le courriel et le mot de passe.')
}

/**
 * The whole run; returns the exit code: 0 done, 1 a row in error or the import cancelled, 2 the run
 * stopped (arguments, file, target, sign-in, a database error).
 * `deps` (terminal, client, files, clock, output) is injected so tests run it without a terminal
 * or a database; the command line below always wires the real ones.
 */
export async function run(argv, deps) {
  const { out } = deps
  let terminal
  let client
  try {
    const cli = parseCli(argv)
    if (cli.help || !cli.file) {
      out(USAGE)
      return cli.help ? 0 : 2
    }
    const target = resolveTarget(cli.url)
    const anonKey = cli.anonKey ?? deps.env.VITE_SUPABASE_ANON_KEY
    if (!anonKey) throw new InputError('Clé anon manquante : --anon-key <clé> ou VITE_SUPABASE_ANON_KEY.')
    const rows = buildRows(deps.readFile(cli.file))
    if (rows.length === 0) throw new InputError('Aucune ligne à importer.')

    terminal = deps.openTerminal()
    if (!target.local) {
      terminal.say(`Base distante : ${target.url}`)
      const typed = (await terminal.ask('Tapez la référence du projet pour confirmer : ')).trim()
      if (typed !== target.confirmWith) throw new InputError('Référence différente : rien n’a été fait.')
    }
    client = deps.createClient(target.url, anonKey)
    await signIn(client, terminal)

    out(`Essai sur ${target.url} (rien n’est écrit) : ${rows.length} ligne(s).`)
    const entries = []
    await pass(client, rows, true, entries, out)
    out(summaryText(entries, true))
    const errors = entries.some((e) => e.status === 'error')
    if (!cli.commit || errors || !entries.some((e) => e.status === 'ok')) {
      writeReport(deps, cli, entries, 'essai')
      if (cli.commit) out(errors ? 'Rien n’a été importé : corrigez les erreurs, puis relancez.' : 'Rien à importer.')
      return errors ? 1 : 0
    }
    return await commit(deps, cli, client, terminal, target, rows, entries)
  } catch (error) {
    if (!(error instanceof InputError) && !(error instanceof Aborted)) throw error
    out(error.message)
    return error instanceof Aborted ? 1 : 2
  } finally {
    if (client) await client.auth.signOut({ scope: 'local' })
    terminal?.close()
  }
}

/** Confirmed by typing « importer »; then row by row, for real. */
async function commit(deps, cli, client, terminal, target, rows, dryEntries) {
  const count = dryEntries.filter((e) => e.status === 'ok').length
  const typed = await terminal.ask(`Importer ${count} professionnel(s) dans ${target.url} ? Tapez « importer » pour confirmer : `)
  if (typed.trim() !== 'importer') {
    deps.out('Import annulé : rien n’a été écrit.')
    return 1
  }
  deps.out('Import :')
  const entries = []
  try {
    await pass(client, rows, false, entries, deps.out)
  } finally {
    deps.out(summaryText(entries, false))
    writeReport(deps, cli, entries, 'import')
  }
  return entries.some((e) => e.status === 'error') ? 1 : 0
}

function writeReport(deps, cli, entries, mode) {
  const path = cli.report ?? reportName(deps.now())
  try {
    deps.writeFile(path, reportCsv(entries, mode))
  } catch (error) {
    if (error?.code === 'EEXIST') throw new InputError(`Le rapport ${path} existe déjà : il n’est pas remplacé.`)
    throw error
  }
  deps.out(`Rapport : ${path}`)
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
    // 'wx': never overwrite an earlier report.
    writeFile: (path, text) => writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' }),
    now: () => new Date(),
    openTerminal,
    createClient: (url, key) => createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
  })
  process.exitCode = code
}
