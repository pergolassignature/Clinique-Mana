#!/usr/bin/env node
// The GOrendezvous exports, read and checked on this computer only (plan §9, batch I1 prep): no
// network, no database, nothing written but the optional report. The I1 batch wires these readers
// to `scripts/import-gorendezvous.mjs` (the import itself: local by default, a typed project
// reference for a remote, credentials from /dev/tty, dry run by default, as import-professionals.mjs).
//
//   node scripts/import-gorendezvous/dry-run.mjs --clients ~/Clinique-MANA-import/clients.csv \
//     [--invoices <csv>] [--lines <csv>] [--payments <csv>] [--waitlist <csv>] \
//     [--cancellations <csv>] [--today YYYY-MM-DD] [--report <file>]
//
// - Each export is saved from Excel as « CSV UTF-8 » (decision I-1) and kept OUT of git, in
//   ~/Clinique-MANA-import/ (mode 700): a file inside this repository is refused.
// - The report holds counts, line numbers and reasons: never a name, an email, a phone, a birth
//   date, an address or a note. --report writes it to a new file (mode 600, never over one).
import { closeSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { readClients } from './clients.mjs'
import { findDuplicates } from './duplicates.mjs'
import { readCancellations, readWaitlist } from './lists.mjs'
import { PAYMENT_METHOD_LABELS, clientsReport, fmtMoney, listReport, moneyReport } from './report.mjs'
import { readInvoiceLines, readInvoices, readPayments } from './revenue.mjs'
import { InputError, decodeUtf8 } from './table.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const OPTIONS = {
  clients: { type: 'string' },
  invoices: { type: 'string' },
  lines: { type: 'string' },
  payments: { type: 'string' },
  waitlist: { type: 'string' },
  cancellations: { type: 'string' },
  today: { type: 'string' },
  report: { type: 'string' },
  help: { type: 'boolean' },
}

export const USAGE =
  'Usage : node scripts/import-gorendezvous/dry-run.mjs --clients <csv> [--invoices <csv>] [--lines <csv>] [--payments <csv>] [--waitlist <csv>] [--cancellations <csv>] [--today AAAA-MM-JJ] [--report <fichier>]'

/** Refuses a data file inside the repository (it could be committed). */
export function checkOutsideRepo(file, root = REPO_ROOT) {
  let real
  try {
    real = realpathSync(file)
  } catch {
    throw new InputError(`Fichier introuvable : ${file}`)
  }
  const rel = path.relative(realpathSync(root), real)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new InputError('Les exports restent hors du dépôt git (dans ~/Clinique-MANA-import/) : déplacez le fichier, puis relancez.')
  }
  return real
}

/**
 * Refuses a report inside the repository (it could be committed): the report does not exist yet,
 * so its directory is the one checked. Returns the report's path in that real directory.
 */
export function checkReportOutsideRepo(file, root = REPO_ROOT) {
  let dir
  try {
    dir = realpathSync(path.dirname(path.resolve(file)))
  } catch {
    throw new InputError(`Dossier du rapport introuvable : ${path.dirname(file)}`)
  }
  const rel = path.relative(realpathSync(root), dir)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new InputError('Le rapport reste hors du dépôt git (dans ~/Clinique-MANA-import/) : choisissez un autre --report, puis relancez.')
  }
  return path.join(dir, path.basename(file))
}

/** Today in the clinic's time zone (« YYYY-MM-DD »), for the birthday bound. */
export const clinicToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now)

/**
 * Builds the report's lines from the files' texts (`texts`: one per option given). Exported for the
 * tests: no file system here.
 */
export function buildReport(texts, { today }) {
  const out = ['Essai à blanc des exports GOrendezvous : rien n’est écrit, aucune valeur personnelle n’est affichée.', '']
  if (texts.clients !== undefined) {
    const result = readClients(texts.clients, { today })
    out.push(...clientsReport(result, findDuplicates(result.clients)), '')
  }
  if (texts.invoices !== undefined) {
    const { invoices, rejected } = readInvoices(texts.invoices)
    const balance = invoices.reduce((sum, i) => sum + (i.balance_cents ?? 0), 0)
    out.push(...moneyReport('Factures (par facture)', { items: invoices, rejected, amount: (i) => i.total_cents, extra: [`Soldes dus : ${fmtMoney(balance)}`] }), '')
  }
  if (texts.lines !== undefined) {
    const { lines, rejected } = readInvoiceLines(texts.lines)
    const services = new Set(lines.map((l) => l.service_code ?? `sans code : ${l.service}`))
    const uncoded = new Set(lines.filter((l) => !l.service_code).map((l) => l.service))
    const extra = [`Services distincts : ${services.size} ; sans code : ${uncoded.size} (à rattacher à un code du catalogue)`]
    out.push(...moneyReport('Lignes de facture (par service)', { items: lines, rejected, amount: (l) => l.total_cents, extra }), '')
  }
  if (texts.payments !== undefined) {
    const { payments, rejected } = readPayments(texts.payments)
    const byMethod = new Map()
    for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount_cents)
    const unknown = new Set(rejected.filter((r) => r.methodLabel).map((r) => r.methodLabel))
    const extra = [
      `Par mode : ${[...byMethod].map(([m, c]) => `${PAYMENT_METHOD_LABELS[m] ?? m} ${fmtMoney(c)}`).join(' ; ')}`,
      `Remboursements : ${payments.filter((p) => p.refund).length}`,
      ...(unknown.size > 0 ? [`Modes inconnus : ${[...unknown].join(', ')}`] : []),
    ]
    out.push(...moneyReport('Paiements (par paiement)', { items: payments, rejected, amount: (p) => p.amount_cents, extra }), '')
  }
  if (texts.waitlist !== undefined) {
    const { entries, rejected } = readWaitlist(texts.waitlist)
    out.push(...listReport("Liste d'attente", { items: entries, rejected }), '')
  }
  if (texts.cancellations !== undefined) {
    const { cancellations, rejected, reasons } = readCancellations(texts.cancellations)
    const extra = [`Raisons distinctes : ${Object.keys(reasons).length}`]
    out.push(...listReport('Annulations et clients à relancer', { items: cancellations, rejected, extra }), '')
  }
  return out
}

export function run(argv, { stdout = process.stdout, readFile = readFileSync, now = new Date() } = {}) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: true })
  if (values.help) {
    stdout.write(`${USAGE}\n`)
    return 0
  }
  const files = ['clients', 'invoices', 'lines', 'payments', 'waitlist', 'cancellations'].filter((k) => values[k])
  if (files.length === 0) throw new InputError(USAGE)
  if (values.today && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(values.today)) throw new InputError('--today attend une date AAAA-MM-JJ.')
  const texts = {}
  for (const key of files) texts[key] = decodeUtf8(readFile(checkOutsideRepo(values[key])))
  const text = `${buildReport(texts, { today: values.today ?? clinicToday(now) }).join('\n')}\n`
  stdout.write(text)
  if (values.report) {
    // A new file only (wx), readable by its owner only.
    const fd = openSync(checkReportOutsideRepo(values.report), 'wx', 0o600)
    try {
      writeSync(fd, text)
    } finally {
      closeSync(fd)
    }
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (error) {
    // InputError messages are ours (no value from a file); anything else by its name only.
    process.stderr.write(`${error instanceof InputError ? error.message : `Erreur inattendue (${error?.name ?? 'Error'}).`}\n`)
    process.exitCode = 1
  }
}
