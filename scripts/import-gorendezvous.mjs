#!/usr/bin/env node
// The GOrendezvous import (plan §9; batch I1: the clients, their relations, the price gap report;
// batch I3: the invoices, their lines and payments, as history).
// Runbook: docs/runbooks/import-gorendezvous.md. Running it against the clinic's database is
// Jonathan's call: never against production without his go-ahead in chat.
//
//   node scripts/import-gorendezvous.mjs clients --clients <csv> [--employees <csv>] [--relations <csv>]
//        [--commit] [--url <api>] [--anon-key <key>] [--report <file>] [--today AAAA-MM-JJ]
//   node scripts/import-gorendezvous.mjs prix --lines <csv> --employees <csv> [--services <csv>]
//        [--on AAAA-MM-JJ] [--url <api>] [--anon-key <key>] [--report <file>]
//   node scripts/import-gorendezvous.mjs factures --invoices <csv> --lines <csv> --payments <csv>
//        [--employees <csv>] [--services <csv>] [--clients-map <csv>] [--commit] [--url <api>]
//        [--anon-key <key>] [--report <file>]
//
// The safety model of import-professionals.mjs (decision I-7):
// - A dry run by default: every client goes through import_client(row, true), which does everything
//   and rolls it back. --commit dry-runs every row first, imports nothing if one is in error, asks
//   for « importer », then imports row by row (each row all or nothing; a re-run skips the files
//   already imported, by their GOrendezvous id), then the relations, then the payer tags (IVAC,
//   PAE) as payers « à compléter » through import_client_payers (FP-9: once per client and kind, a
//   re-run adds none twice; the adjointe completes them from « Payeurs à compléter »). « prix »
//   only reads.
// - « factures » the same way through import_invoice(row, dry_run) (billing.manage): an invoice
//   whose client is not found, or has homonyms, is listed and left out (--clients-map, « Facture ;
//   ClientId », settles them on a re-run); a row the database refuses stops the import. Imported
//   invoices are history: nothing is sent, nothing goes to QuickBooks, nothing is reminded.
// - The local stack (http://127.0.0.1:55321) unless --url names another; a remote one must be
//   https and its project reference is typed back first.
// - The person running it signs in with her own account on the terminal (/dev/tty, the password
//   hidden); a secret key is refused. She needs clients.manage and clients.merge (and, for « prix »,
//   professionals.view and services.view).
// - The exports stay out of git, in ~/Clinique-MANA-import/ (mode 700): a file inside this
//   repository is refused. The report (a new file, mode 600) and the terminal hold counts, line
//   numbers, file numbers, codes and French reasons: never a name, an email, a phone, a birth date,
//   an address, a note or a GOrendezvous id (decision I-6).
// - Ctrl-C stops between two rows; the report keeps what was done; a re-run resumes.
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Aborted, InputError, LOCAL_URL, checkPublicKey, openTerminal, resolveTarget } from './import-professionals.mjs'
import { REASON_LABELS, readClients } from './import-gorendezvous/clients.mjs'
import { checkOutsideRepo, clinicToday } from './import-gorendezvous/dry-run.mjs'
import { findDuplicates } from './import-gorendezvous/duplicates.mjs'
import { MAPPING_REASON_LABELS, readEmployees, readServiceCodes } from './import-gorendezvous/mappings.mjs'
import { PAYLOAD_REASON_LABELS, RELATION_REASON_LABELS, clientPayload, readRelations } from './import-gorendezvous/payloads.mjs'
import { priceGapReport, priceGaps } from './import-gorendezvous/price-gaps.mjs'
import { clientsReport } from './import-gorendezvous/report.mjs'
import { INVOICE_REASON_LABELS, assembleInvoices, byMonth, lastNumbers, readClientsMap } from './import-gorendezvous/invoices.mjs'
import { fmtMoney } from './import-gorendezvous/report.mjs'
import { REVENUE_REASON_LABELS, readInvoiceLines, readInvoices, readPayments } from './import-gorendezvous/revenue.mjs'
import { decodeUtf8 } from './import-gorendezvous/table.mjs'

const USAGE = `Usage :
  node scripts/import-gorendezvous.mjs clients --clients <csv> [--employees <csv>] [--relations <csv>] [--commit] [--url <api>] [--anon-key <clé>] [--report <fichier>] [--today AAAA-MM-JJ]
  node scripts/import-gorendezvous.mjs prix --lines <csv> --employees <csv> [--services <csv>] [--on AAAA-MM-JJ] [--url <api>] [--anon-key <clé>] [--report <fichier>]
  node scripts/import-gorendezvous.mjs factures --invoices <csv> --lines <csv> --payments <csv> [--employees <csv>] [--services <csv>] [--clients-map <csv>] [--commit] [--url <api>] [--anon-key <clé>] [--report <fichier>]
  Sans --commit : essai, rien n'est écrit. Base par défaut : ${LOCAL_URL}.`

const LABELS = { ...REASON_LABELS, ...MAPPING_REASON_LABELS, ...PAYLOAD_REASON_LABELS, ...RELATION_REASON_LABELS, ...REVENUE_REASON_LABELS, ...INVOICE_REASON_LABELS }
const fmt = (n) => n.toLocaleString('fr-CA')
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

export function parseCli(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        clients: { type: 'string' },
        employees: { type: 'string' },
        relations: { type: 'string' },
        lines: { type: 'string' },
        services: { type: 'string' },
        invoices: { type: 'string' },
        payments: { type: 'string' },
        'clients-map': { type: 'string' },
        commit: { type: 'boolean', default: false },
        url: { type: 'string' },
        'anon-key': { type: 'string' },
        report: { type: 'string' },
        today: { type: 'string' },
        on: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    throw new InputError(`${error.message}\n${USAGE}`)
  }
  const { values, positionals } = parsed
  const command = positionals[0]
  if (values.help) return { help: true }
  if (positionals.length !== 1 || !['clients', 'prix', 'factures'].includes(command)) throw new InputError(USAGE)
  if (command === 'clients' && !values.clients) throw new InputError(`« clients » demande --clients <csv>.\n${USAGE}`)
  if (command === 'prix' && (!values.lines || !values.employees)) throw new InputError(`« prix » demande --lines <csv> et --employees <csv>.\n${USAGE}`)
  if (command === 'prix' && values.commit) throw new InputError('« prix » ne fait que lire : --commit ne s’applique pas.')
  if (command === 'factures' && (!values.invoices || !values.lines || !values.payments)) {
    throw new InputError(`« factures » demande --invoices <csv>, --lines <csv> et --payments <csv>.\n${USAGE}`)
  }
  for (const key of ['today', 'on']) if (values[key] && !DATE.test(values[key])) throw new InputError(`--${key} attend une date AAAA-MM-JJ.`)
  return { command, ...values, anonKey: values['anon-key'], clientsMap: values['clients-map'] }
}

/** Line numbers, at most 30 of them, then « … et N autres ». */
function lineList(lines) {
  const sorted = [...lines].sort((a, b) => a - b)
  return sorted.length > 30 ? `${sorted.slice(0, 30).join(', ')} … et ${sorted.length - 30} autres` : sorted.join(', ')
}

/** `{ line, reasons }` items grouped by reason: « label (N) : lignes … ». */
function byReason(items, labels = LABELS) {
  const groups = new Map()
  for (const { line, reasons } of items) {
    for (const reason of reasons) {
      if (!groups.has(reason)) groups.set(reason, [])
      groups.get(reason).push(line)
    }
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length).map(([reason, lines]) => `  - ${labels[reason] ?? reason} (${fmt(lines.length)}) : lignes ${lineList(lines)}`)
}

/**
 * The database pass's section: created (or to create), already imported, in error (grouped by the
 * database's French message, with their field), and the duplicates with a file already in the app
 * (by level, the lines and the file numbers).
 */
export function passReport(entries, dryRun) {
  const ok = entries.filter((e) => e.status === 'ok')
  const out = [`${dryRun ? 'À créer' : 'Créés'} : ${fmt(ok.length)} ; déjà importés : ${fmt(entries.filter((e) => e.status === 'skipped').length)} ; en erreur : ${fmt(entries.filter((e) => e.status === 'error').length)}`]
  const errors = entries.filter((e) => e.status === 'error').map((e) => ({ line: e.line, reasons: e.errors.map((x) => (x.field ? `${x.field} : ${x.message}` : x.message)) }))
  if (errors.length > 0) out.push('Refusées par la base :', ...byReason(errors, {}))
  for (const level of ['high', 'medium']) {
    const hits = ok.filter((e) => e.duplicates.some((d) => d.level === level))
    if (hits.length === 0) continue
    out.push(`Doublons ${level.toUpperCase()} avec un dossier déjà dans l’app : ${fmt(hits.length)}`)
    for (const e of hits.slice(0, 30)) {
      out.push(`  - ligne ${e.line} ↔ dossier n° ${e.duplicates.filter((d) => d.level === level).map((d) => d.client_number).join(', n° ')}`)
    }
    if (hits.length > 30) out.push(`  … et ${fmt(hits.length - 30)} autres`)
  }
  // Tag names are the clinic's labels, never personal data (decision I-4).
  const names = (key) => [...new Set(ok.flatMap((e) => e[key] ?? []))].sort((a, b) => a.localeCompare(b, 'fr'))
  const created = names('tagsCreated')
  const reactivated = names('tagsReactivated')
  if (created.length > 0) out.push(`Étiquettes ${dryRun ? 'à ajouter' : 'ajoutées'} à la liste de la clinique (${fmt(created.length)}) : ${created.join(', ')}`)
  if (reactivated.length > 0) out.push(`Étiquettes archivées de la clinique ${dryRun ? 'à remettre' : 'remises'} en service (${fmt(reactivated.length)}) : ${reactivated.join(', ')}`)
  const anonymised = entries.filter((e) => e.reason === 'Dossier anonymisé').length
  if (anonymised > 0) out.push(`Dossiers anonymisés depuis leur import (jamais recréés, Loi 25) : ${fmt(anonymised)}`)
  return out
}

async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new InputError(`Erreur de la base (${error.code || 'réseau'}) : ${error.message}`)
  return data
}

async function select(client, view, columns) {
  const { data, error } = await client.from(view).select(columns)
  if (error) throw new InputError(`Lecture de ${view} refusée (${error.code || 'réseau'}) : ${error.message}`)
  return data
}

/**
 * Every row through `fn`, in order, stopping between two rows once asked; a progress line every
 * 500. A database error stops the pass but keeps the rows done (`error`), so the caller can still
 * say what was imported.
 */
async function pass(ctx, items, fn, label) {
  const entries = []
  let error = null
  for (const item of items) {
    if (ctx.stop.requested) break
    try {
      entries.push(await fn(item))
    } catch (failure) {
      error = failure
      break
    }
    if (entries.length % 500 === 0) ctx.out(`  ${label} : ${fmt(entries.length)} / ${fmt(items.length)}`)
  }
  return Object.assign(entries, { error })
}

const clientEntry = (line, result) => ({
  line,
  status: result.status,
  errors: result.errors ?? [],
  duplicates: result.duplicates ?? [],
  tagsCreated: result.tags_created ?? [],
  tagsReactivated: result.tags_reactivated ?? [],
  reason: result.reason ?? null,
})

async function signIn(client, terminal) {
  const email = (await terminal.ask('Courriel : ')).trim()
  const { error } = await client.auth.signInWithPassword({ email, password: await terminal.askHidden('Mot de passe : ') })
  if (error) throw new InputError('Connexion refusée : vérifiez le courriel et le mot de passe.')
}

/**
 * The whole run; returns the exit code: 0 done, 1 a row in error, a refused relation line or the
 * import cancelled (a prompt answered with Ctrl-C included), 2 the run stopped (arguments, files,
 * target, report, sign-in, a database error, an interruption between rows).
 * `deps` is injected (terminal, client, files, signals, clock, output) so tests need none of them.
 */
export async function run(argv, deps) {
  const { out } = deps
  const ctx = { out, stop: { requested: false }, client: null, terminal: null }
  const lines = []
  const say = (...text) => {
    for (const line of text) {
      lines.push(line)
      out(line)
    }
  }
  let report = null
  let unsubscribe
  const requestStop = () => {
    if (ctx.stop.requested) return
    ctx.stop.requested = true
    if (!ctx.terminal?.interruptPrompt?.()) out('Arrêt demandé : la ligne en cours se termine, puis l’import s’arrête.')
  }
  try {
    const cli = parseCli(argv)
    if (cli.help) {
      out(USAGE)
      return 0
    }
    const target = resolveTarget(cli.url)
    const anonKey = cli.anonKey ?? deps.env.VITE_SUPABASE_ANON_KEY
    if (!anonKey) throw new InputError('Clé anon manquante : --anon-key <clé> ou VITE_SUPABASE_ANON_KEY.')
    checkPublicKey(anonKey)
    const read = (file) => (file ? deps.readFile(file) : undefined)
    const texts = {
      clients: read(cli.clients),
      employees: read(cli.employees),
      relations: read(cli.relations),
      lines: read(cli.lines),
      services: read(cli.services),
      invoices: read(cli.invoices),
      payments: read(cli.payments),
      clientsMap: read(cli.clientsMap),
    }

    // Everything the files say before any question: a file that cannot be read stops here.
    const today = cli.today ?? clinicToday(deps.now())
    const parsedClients = texts.clients === undefined ? null : readClients(texts.clients, { today })
    const parsedRelations = texts.relations === undefined ? null : readRelations(texts.relations)
    const parsedLines = texts.lines === undefined ? null : readInvoiceLines(texts.lines)
    const parsedInvoices = texts.invoices === undefined ? null : readInvoices(texts.invoices)
    const parsedPayments = texts.payments === undefined ? null : readPayments(texts.payments)
    const clientsMap = readClientsMap(texts.clientsMap)
    if (clientsMap.rejected.length > 0) {
      say('== Fichier --clients-map : lignes refusées', ...byReason(clientsMap.rejected))
      throw new InputError('Corrigez le fichier --clients-map, puis relancez : rien n’a été fait.')
    }

    if (cli.report) report = deps.openReport(cli.report)
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

    const directory = texts.employees === undefined ? [] : await select(ctx.client, 'professionals_directory', 'id, display_name, licence_number, primary_title_id, professions')
    const employees = texts.employees === undefined ? null : readEmployees(texts.employees, directory)
    if (employees && employees.rejected.length > 0) {
      say('== Fichier des employés : lignes refusées', ...byReason(employees.rejected))
      throw new InputError('Corrigez le fichier des employés, puis relancez : rien n’a été fait.')
    }

    if (cli.command === 'prix') return await prix(ctx, { on: cli.on ?? today, parsedLines, employees, texts, say })
    if (cli.command === 'factures') return await factures(ctx, { cli, target, parsedInvoices, parsedLines, parsedPayments, clientsMap, employees, texts, say })
    return await clients(ctx, { cli, target, parsedClients, parsedRelations, employees, say })
  } catch (error) {
    if (!(error instanceof InputError) && !(error instanceof Aborted)) throw error
    out(error.message)
    lines.push(error.message)
    return error instanceof Aborted ? 1 : 2
  } finally {
    unsubscribe?.()
    if (ctx.client) {
      try {
        ctx.client.auth.stopAutoRefresh?.()
        await ctx.client.auth.signOut({ scope: 'local' })
      } catch {
        out('Déconnexion : la session locale est abandonnée.')
      }
    }
    if (report) {
      report.write(`${lines.join('\n')}\n`)
      report.close()
      out(`Rapport : ${report.path}`)
    }
    ctx.terminal?.close()
  }
}

async function clients(ctx, { cli, target, parsedClients, parsedRelations, employees, say }) {
  ctx.targetUrl = target.url
  const professionalFor = employees ? employees.lookup : () => null
  const prepared = parsedClients.clients.map((record) => ({ record, ...clientPayload(record, professionalFor) }))
  const fileDuplicates = findDuplicates(parsedClients.clients)
  say(`Import GOrendezvous (clients) sur ${target.url} : ${cli.commit ? 'essai, puis import' : 'essai, rien n’est écrit'}.`, '')
  say(...clientsReport(parsedClients, fileDuplicates))
  const flagged = prepared.filter((p) => p.flags.length > 0).map((p) => ({ line: p.record.line, reasons: p.flags }))
  if (flagged.length > 0) say('Valeurs laissées de côté à l’envoi :', ...byReason(flagged))
  if (!employees) say('Sans fichier des employés (--employees) : aucun professionnel principal n’est rattaché.')
  if (parsedRelations) {
    const refs = new Set(parsedClients.clients.map((c) => c.externalRef))
    const missing = parsedRelations.relations.filter((r) => !refs.has(r.row.client_ref) || !refs.has(r.row.related_ref))
    say(
      '',
      `== Liens entre clients : ${fmt(parsedRelations.relations.length)} à créer ; refusés : ${fmt(parsedRelations.rejected.length)} ; fiches absentes de l’export : ${fmt(missing.length)}`,
      ...byReason(parsedRelations.rejected),
      ...(missing.length > 0 ? [`  - un des deux clients absent de l’export (${fmt(missing.length)}) : lignes ${lineList(missing.map((m) => m.line))}`] : []),
    )
  }

  say('', '== Essai dans la base (chaque ligne est vérifiée puis annulée)')
  const dry = await pass(ctx, prepared, async (p) => clientEntry(p.record.line, await rpc(ctx.client, 'import_client', { p_row: p.row, p_dry_run: true })), 'essai')
  say(...passReport(dry, true))
  if (dry.error) throw dry.error
  if (dry.length < prepared.length) {
    say(`Essai interrompu après ${fmt(dry.length)} ligne(s) sur ${fmt(prepared.length)} : rien n’a été écrit.`)
    return 2
  }
  const errors = dry.some((e) => e.status === 'error')
  const relationProblems = parsedRelations ? parsedRelations.rejected.length + relationsMissing(parsedClients, parsedRelations) : 0
  const toCreate = dry.filter((e) => e.status === 'ok').length
  const relations = parsedRelations?.relations ?? []
  // FP-9: the files whose tags name a payer (IVAC, PAE) get it « à compléter » once imported.
  const payerRows = prepared.filter((p) => (p.record.payers ?? []).length > 0)
  if (payerRows.length > 0) {
    say(`Payeurs tiers des étiquettes (IVAC, PAE) : ${fmt(payerRows.length)} client(s), ajoutés « à compléter » après l’import (Clients → « Payeurs à compléter »).`)
  }
  if (!cli.commit) return errors || relationProblems > 0 ? 1 : 0
  if (errors || relationProblems > 0) {
    say(errors ? 'Rien n’a été importé : corrigez les erreurs, puis relancez.' : 'Rien n’a été importé : corrigez le fichier des liens, puis relancez.')
    return 1
  }
  // A re-run after every client is in still imports the relations (a resumed run, or a relations file that came later).
  if (toCreate === 0 && relations.length === 0 && payerRows.length === 0) {
    say('Rien à importer.')
    return 0
  }
  if (ctx.stop.requested) throw new Aborted('Interrompu.')
  const left = parsedClients.rejected.length
  const typed = await ctx.terminal.ask(
    `Importer ${fmt(toCreate)} client(s)${relations.length > 0 ? ` et ${fmt(relations.length)} lien(s)` : ''}${payerRows.length > 0 ? ` (et les payeurs tiers de ${fmt(payerRows.length)} client(s))` : ''} dans ${ctx.targetUrl}${left > 0 ? ` (${fmt(left)} ligne(s) refusée(s) du fichier ne le seront pas)` : ''} ? Tapez « importer » pour confirmer : `,
  )
  if (typed.trim() !== 'importer') {
    say('Import annulé : rien n’a été écrit.')
    return 1
  }
  const RESUME = 'Relancez la même commande avec --commit : les fiches et les liens déjà importés reviendront « déjà importés ».'
  let failed = false
  /** The lines the import refused: their payers are not added (the file is not there). */
  const refused = new Set()
  if (toCreate > 0) {
    say('', '== Import')
    const real = await pass(ctx, prepared, async (p) => clientEntry(p.record.line, await rpc(ctx.client, 'import_client', { p_row: p.row, p_dry_run: false })), 'import')
    say(...passReport(real, false))
    if (real.error || real.length < prepared.length) {
      say(`Import arrêté après ${fmt(real.length)} ligne(s) sur ${fmt(prepared.length)}. ${RESUME}`)
      if (real.error) throw real.error
      return 2
    }
    failed = real.some((e) => e.status === 'error')
    for (const e of real) if (e.status === 'error') refused.add(e.line)
  }
  if (relations.length > 0) {
    say('', '== Liens entre clients')
    const links = await pass(ctx, relations, async (r) => ({ line: r.line, ...(await rpc(ctx.client, 'import_client_relation', { p_row: r.row, p_dry_run: false })) }), 'liens')
    const linkErrors = links.filter((l) => l.status === 'error').map((l) => ({ line: l.line, reasons: l.errors.map((x) => (x.field ? `${x.field} : ${x.message}` : x.message)) }))
    say(
      `Liens créés : ${fmt(links.filter((l) => l.status === 'ok').length)} ; déjà là : ${fmt(links.filter((l) => l.status === 'skipped').length)} ; en erreur : ${fmt(linkErrors.length)}`,
      ...byReason(linkErrors, {}),
    )
    if (links.error || links.length < relations.length) {
      say(`Liens arrêtés après ${fmt(links.length)} sur ${fmt(relations.length)}. ${RESUME}`)
      if (links.error) throw links.error
      return 2
    }
    failed ||= linkErrors.length > 0
  }
  const payersToAdd = payerRows.filter((p) => !refused.has(p.record.line))
  if (payersToAdd.length > 0) {
    say('', '== Payeurs tiers (étiquettes IVAC, PAE)')
    const made = await pass(
      ctx,
      payersToAdd,
      async (p) => ({
        line: p.record.line,
        ...(await rpc(ctx.client, 'import_client_payers', { p_row: { client_ref: p.row.external_ref, payers: p.record.payers }, p_dry_run: false })),
      }),
      'payeurs',
    )
    const payerErrors = made.filter((m) => m.status === 'error').map((m) => ({ line: m.line, reasons: (m.errors ?? []).map((x) => x.message) }))
    const created = made.reduce((sum, m) => sum + (m.status === 'ok' ? (m.created ?? 0) : 0), 0)
    say(
      `Payeurs « à compléter » ajoutés : ${fmt(created)} ; clients qui les avaient déjà : ${fmt(made.filter((m) => m.status === 'ok' && (m.created ?? 0) === 0).length)} ; en erreur : ${fmt(payerErrors.length)}`,
      ...byReason(payerErrors, {}),
      ...(created > 0 ? ['Complétez-les dans Clients → « Payeurs à compléter » (numéro de dossier, fournisseur, couverture) : d’ici là, leurs séances attendent dans la file du matin.'] : []),
    )
    if (made.error || made.length < payersToAdd.length) {
      say(`Payeurs arrêtés après ${fmt(made.length)} sur ${fmt(payersToAdd.length)}. ${RESUME}`)
      if (made.error) throw made.error
      return 2
    }
    failed ||= payerErrors.length > 0
  }
  return failed ? 1 : 0
}

/** The relations whose client or related person is not in the clients export. */
function relationsMissing(parsedClients, parsedRelations) {
  const refs = new Set(parsedClients.clients.map((c) => c.externalRef))
  return parsedRelations.relations.filter((r) => !refs.has(r.row.client_ref) || !refs.has(r.row.related_ref)).length
}

async function prix(ctx, { on, parsedLines, employees, texts, say }) {
  const [catalogue, titles, prices] = await Promise.all([
    select(ctx.client, 'services_catalog', 'id, code, name'),
    select(ctx.client, 'profession_titles_catalog', 'id, name'),
    rpc(ctx.client, 'list_service_prices', { p_on: on }),
  ])
  // services.code is an integer; the files and the lines hold text.
  const services = readServiceCodes(texts.services, catalogue.map((s) => String(s.code)))
  if (services.rejected.length > 0) {
    say('== Fichier des services : lignes refusées', ...byReason(services.rejected))
    throw new InputError('Corrigez le fichier des services, puis relancez.')
  }
  const byCode = new Map(catalogue.map((s) => [String(s.code), s]))
  const gridPrice = (code, titleId) => {
    const service = byCode.get(code)
    if (!service) return null
    const row = prices.find((p) => p.service_id === service.id && p.title_id === titleId) ?? prices.find((p) => p.service_id === service.id && p.title_id === null)
    return row?.price_cents ?? null
  }
  const titleName = (id) => titles.find((t) => t.id === id)?.name ?? 'Titre inconnu'
  const serviceName = (code) => byCode.get(code)?.name ?? ''
  say(`Lignes de facture lues : ${fmt(parsedLines.lines.length)} ; refusées : ${fmt(parsedLines.rejected.length)}`, '')
  const gaps = priceGaps(parsedLines.lines, { professionalFor: employees.lookup, codeFor: services.codeFor, gridPrice })
  say(...priceGapReport(gaps, { titleName, serviceName, on }))
  return 0
}

const FILE_LABELS = { invoices: '« par facture »', lines: '« par service-produit »', payments: '« par paiement »' }

/** The month table: invoices and money per month, the export's beside what goes in. */
function monthTable(exported, kept, keptLabel) {
  const keptBy = new Map(byMonth(kept).map((m) => [m.month, m]))
  return byMonth(exported).map((m) => {
    const k = keptBy.get(m.month) ?? { count: 0, total_cents: 0 }
    return `  ${m.month} : export ${fmt(m.count)} facture(s), ${fmtMoney(m.total_cents)} ; ${keptLabel} ${fmt(k.count)}, ${fmtMoney(k.total_cents)}`
  })
}

/** The database pass's section for invoices: by status, the unmatched by reason, the errors by message. */
export function invoicePassReport(entries, dryRun) {
  const count = (status) => entries.filter((e) => e.status === status).length
  const out = [
    `${dryRun ? 'À importer' : 'Importées'} : ${fmt(count('ok'))} ; déjà importées : ${fmt(count('skipped'))} ; sans dossier : ${fmt(count('unmatched'))} ; en erreur : ${fmt(count('error'))}`,
  ]
  const unmatched = entries.filter((e) => e.status === 'unmatched').map((e) => ({ line: e.line, reasons: [e.reason] }))
  if (unmatched.length > 0) out.push('Laissées de côté (lignes de « par facture ») :', ...byReason(unmatched))
  const errors = entries
    .filter((e) => e.status === 'error')
    .map((e) => ({ line: e.line, reasons: e.errors.map((x) => (x.field ? `${x.field} : ${x.message}` : x.message)) }))
  if (errors.length > 0) out.push('Refusées par la base (lignes de « par facture ») :', ...byReason(errors, {}))
  return out
}

const invoiceEntry = (item, result) => ({
  line: item.line,
  month: item.month,
  total_cents: item.total_cents,
  number: result.number ?? null,
  status: result.status,
  reason: result.reason ?? null,
  errors: result.errors ?? [],
})

const exportedMonths = (parsedInvoices) => parsedInvoices.invoices.map((i) => ({ month: i.date.slice(0, 7), total_cents: i.total_cents }))

async function factures(ctx, { cli, target, parsedInvoices, parsedLines, parsedPayments, clientsMap, employees, texts, say }) {
  ctx.targetUrl = target.url
  const catalogue = texts.services === undefined ? null : await select(ctx.client, 'services_catalog', 'code')
  const services = catalogue ? readServiceCodes(texts.services, catalogue.map((s) => String(s.code))) : null
  if (services && services.rejected.length > 0) {
    say('== Fichier des services : lignes refusées', ...byReason(services.rejected))
    throw new InputError('Corrigez le fichier des services, puis relancez : rien n’a été fait.')
  }
  const { rows, rejected, payerDiffers } = assembleInvoices(
    { invoices: parsedInvoices.invoices, lines: parsedLines.lines, payments: parsedPayments.payments },
    { professionalFor: employees ? employees.lookup : () => null, ...(services && { codeFor: services.codeFor }), refFor: clientsMap.refFor },
  )
  say(`Import GOrendezvous (factures) sur ${target.url} : ${cli.commit ? 'essai, puis import' : 'essai, rien n’est écrit'}.`, '')
  say(
    `Factures lues : ${fmt(parsedInvoices.invoices.length)} (refusées : ${fmt(parsedInvoices.rejected.length)}) ; lignes : ${fmt(parsedLines.lines.length)} (refusées : ${fmt(parsedLines.rejected.length)}) ; paiements : ${fmt(parsedPayments.payments.length)} (refusés : ${fmt(parsedPayments.rejected.length)})`,
  )
  for (const [file, parsed] of [
    ['invoices', parsedInvoices],
    ['lines', parsedLines],
    ['payments', parsedPayments],
  ]) {
    const own = [...parsed.rejected, ...rejected.filter((r) => r.file === file)]
    if (own.length > 0) say(`Lignes laissées de côté dans ${FILE_LABELS[file]} :`, ...byReason(own))
  }
  // A method label is GOrendezvous's (« Carte cadeau »), never a person's value.
  const unknownMethods = [...new Set(parsedPayments.rejected.filter((r) => r.methodLabel).map((r) => r.methodLabel))]
  if (unknownMethods.length > 0) say(`Modes de paiement inconnus (libellés de GOrendezvous) : ${unknownMethods.join(', ')}`)
  if (payerDiffers > 0) say(`Factures payées par un tiers (IVAC, PAE…) : ${fmt(payerDiffers)} ; importées au nom du client, le payeur reste à compléter.`)
  if (!employees) say('Sans fichier des employés (--employees) : les lignes n’ont pas de professionnel.')
  if (clientsMap.size > 0) say(`Dossiers donnés par --clients-map : ${fmt(clientsMap.size)}`)

  say('', '== Essai dans la base (chaque facture est vérifiée puis annulée)')
  const dry = await pass(ctx, rows, async (r) => invoiceEntry(r, await rpc(ctx.client, 'import_invoice', { p_row: r.row, p_dry_run: true })), 'essai')
  say(...invoicePassReport(dry, true))
  say('Par mois :', ...monthTable(exportedMonths(parsedInvoices), dry.filter((e) => e.status === 'ok'), 'à importer'))
  if (dry.error) throw dry.error
  if (dry.length < rows.length) {
    say(`Essai interrompu après ${fmt(dry.length)} facture(s) sur ${fmt(rows.length)} : rien n’a été écrit.`)
    return 2
  }
  const errors = dry.some((e) => e.status === 'error')
  const toImport = dry.filter((e) => e.status === 'ok')
  if (!cli.commit) return errors ? 1 : 0
  if (errors) {
    say('Rien n’a été importé : corrigez les factures refusées, puis relancez.')
    return 1
  }
  if (toImport.length === 0) {
    say('Rien à importer.')
    return 0
  }
  if (ctx.stop.requested) throw new Aborted('Interrompu.')
  const left = dry.filter((e) => e.status === 'unmatched').length
  const typed = await ctx.terminal.ask(
    `Importer ${fmt(toImport.length)} facture(s) (${fmtMoney(toImport.reduce((sum, e) => sum + e.total_cents, 0))}) dans ${ctx.targetUrl}${left > 0 ? ` (${fmt(left)} sans dossier ne le seront pas)` : ''} ? Tapez « importer » pour confirmer : `,
  )
  if (typed.trim() !== 'importer') {
    say('Import annulé : rien n’a été écrit.')
    return 1
  }
  say('', '== Import')
  const real = await pass(ctx, rows, async (r) => invoiceEntry(r, await rpc(ctx.client, 'import_invoice', { p_row: r.row, p_dry_run: false })), 'import')
  say(...invoicePassReport(real, false))
  const done = real.filter((e) => e.status === 'ok')
  say('Par mois :', ...monthTable(exportedMonths(parsedInvoices), done, 'importées'))
  const numbers = lastNumbers(done.map((e) => e.number).filter(Boolean))
  if (numbers.length > 0) say(`Numérotation : la prochaine facture de l’app suit ${numbers.map((n) => `${n.year}-${n.last}`).join(', ')}.`)
  if (real.error || real.length < rows.length) {
    say(`Import arrêté après ${fmt(real.length)} facture(s) sur ${fmt(rows.length)}. Relancez la même commande avec --commit : les factures déjà importées reviendront « déjà importées ».`)
    if (real.error) throw real.error
    return 2
  }
  return real.some((e) => e.status === 'error') ? 1 : 0
}

// --- Command line ----------------------------------------------------------------------------------

/** A report file: a new one only (wx), mode 600, flushed when written. */
export function openReportFile(path, fs = { openSync, writeSync, fsyncSync, closeSync, unlinkSync }) {
  let fd
  try {
    fd = fs.openSync(path, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') throw new InputError(`Le rapport ${path} existe déjà : il n’est pas remplacé. Choisissez un autre --report.`)
    throw new InputError(`Rapport impossible à créer : ${path} (${error?.code ?? 'erreur'}).`)
  }
  return {
    path,
    write: (text) => {
      fs.writeSync(fd, text)
      fs.fsyncSync(fd)
    },
    close: () => fs.closeSync(fd),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await run(process.argv.slice(2), {
      env: process.env,
      out: (line) => process.stdout.write(`${line}\n`),
      readFile: (file) => decodeUtf8(readFileSync(checkOutsideRepo(file))),
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
      createClient: (url, key) => createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } }),
    })
  } catch (error) {
    // InputError messages are ours (no value from a file); anything else by its name only.
    process.stderr.write(`${error instanceof InputError ? error.message : `Erreur inattendue (${error?.name ?? 'Error'}).`}\n`)
    process.exitCode = 2
  }
}
