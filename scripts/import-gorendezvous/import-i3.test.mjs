// Batch I3: the invoices, their lines and payments put together for import_invoice, the clients
// map, and the « factures » run with a fake terminal and a fake database. Synthetic data only.
import { describe, expect, it, vi } from 'vitest'
import { parseCli, run } from '../import-gorendezvous.mjs'
import { nameKey } from './homonyms.mjs'
import { assembleInvoices, byMonth, lastNumbers, readClientsMap } from './invoices.mjs'
import { readInvoiceLines, readInvoices, readPayments } from './revenue.mjs'

const INVOICES = `Date;Facture;Client;Professionnel;Sous-total;TPS;TVQ;Total;Payé;Solde;Payé par
2026-09-02;2026-0000101;Client Fictif Un;Pro Alpha;100,00 $;5,00 $;9,98 $;114,98 $;114,98 $;0,00 $;
2026-09-03;2026-0000102;Client Fictif Deux;Pro Beta;130,00 $;0,00 $;0,00 $;130,00 $;0,00 $;130,00 $;IVAC
2026-10-01;2026-0000103;Client Fictif Un;Pro Alpha;75,00 $;0,00 $;0,00 $;75,00 $;75,00 $;0,00 $;
2026-10-02;2026-0000104;Client Fictif Trois;Pro Beta;50,00 $;0,00 $;0,00 $;50,00 $;;;
`
const LINES = `Date;Facture;Client;Professionnel;Service;Code;Quantité;Prix;TPS;TVQ;Total
2026-09-02;2026-0000101;Client Fictif Un;Pro Alpha;Psychothérapie individuelle 50 min;10150;1;100,00 $;5,00 $;9,98 $;114,98 $
2026-09-03;2026-0000102;Client Fictif Deux;Pro Beta;Psychothérapie individuelle (ancien);;1;130,00 $;0,00 $;0,00 $;130,00 $
2026-10-01;2026-0000103;Client Fictif Un;Pro Alpha;Consultation téléphonique 30 min;10130;1;75,00 $;0,00 $;0,00 $;75,00 $
2026-10-05;2026-0000999;Client Fictif Un;Pro Alpha;Consultation téléphonique 30 min;10130;1;75,00 $;0,00 $;0,00 $;75,00 $
`
const PAYMENTS = `Date;Facture;Client;Mode de paiement;Montant
2026-09-02;2026-0000101;Client Fictif Un;Argent comptant;114,98 $
2026-10-01;2026-0000103;Client Fictif Un;Accès D;75,00 $
2026-10-09;2026-0000103;Client Fictif Un;Interac;(25,00 $)
2026-10-10;;Client Fictif Un;Interac;10,00 $
2026-10-11;2026-0000555;Client Fictif Un;Interac;10,00 $
`
const read = () => ({ invoices: readInvoices(INVOICES).invoices, lines: readInvoiceLines(LINES).lines, payments: readPayments(PAYMENTS).payments })
const personal = /Fictif|Pro Alpha|Pro Beta|gorendezvous:/i

describe('assembleInvoices', () => {
  const lookup = (label) => (label === 'Pro Alpha' ? { id: 'p1', titleId: 't' } : label === 'Pro Beta' ? { excluded: true } : null)
  const { rows, rejected, payerDiffers } = assembleInvoices(read(), { professionalFor: lookup, refFor: (n) => (n === '2026-0000102' ? 'gorendezvous:77' : null) })

  it('one row per invoice with its lines and payments; a negative payment is a refund; modes as Facturation codes them', () => {
    expect(rows.map((r) => r.number)).toEqual(['2026-0000101', '2026-0000102', '2026-0000103'])
    expect(rows[0].row).toMatchObject({
      gorendezvous_number: '2026-0000101',
      issued_on: '2026-09-02',
      client_name: 'Client Fictif Un',
      client_ref: null,
      subtotal_cents: 10000,
      gst_cents: 500,
      qst_cents: 998,
      total_cents: 11498,
      lines: [{ service_code: '10150', quantity: 1, unit_price_cents: 10000, gst_cents: 500, qst_cents: 998, total_cents: 11498, professional_id: 'p1' }],
      payments: [{ paid_on: '2026-09-02', mode_code: 'qbo_payments_card', amount_cents: 11498 }],
      refunds: [],
    })
    expect(rows[2].row.payments).toEqual([{ paid_on: '2026-10-01', mode_code: 'bank_transfer', amount_cents: 7500 }])
    expect(rows[2].row.refunds).toEqual([{ paid_on: '2026-10-09', amount_cents: 2500 }])
  })

  it('the clients map names a dossier; an excluded agenda gives no professional', () => {
    expect(rows[1].row.client_ref).toBe('gorendezvous:77')
    expect(rows[1].row.lines[0].professional_id).toBeNull()
    expect(payerDiffers).toBe(1)
  })

  it('an invoice without lines, a line or a payment without its invoice: set aside with their file and line', () => {
    expect(rejected).toEqual([
      { file: 'lines', line: 5, reasons: ['line_without_invoice'] },
      { file: 'payments', line: 5, reasons: ['payment_without_invoice'] },
      { file: 'payments', line: 6, reasons: ['payment_unknown_invoice'] },
      { file: 'invoices', line: 5, reasons: ['invoice_without_lines'] },
    ])
  })

  it('months and the numbers the sequence follows', () => {
    expect(byMonth(rows)).toEqual([
      { month: '2026-09', count: 2, total_cents: 24498 },
      { month: '2026-10', count: 1, total_cents: 7500 },
    ])
    expect(lastNumbers(['2026-101', '2026-1234', '2025-9'])).toEqual([
      { year: 2025, last: 9 },
      { year: 2026, last: 1234 },
    ])
  })
})

describe('the clients map', () => {
  it('an invoice number → its ClientId; unreadable or repeated lines refused', () => {
    const { refFor, rejected } = readClientsMap('Facture;ClientId\n2026-0000102;77\n2026-0000102;78\nFACT;12\n')
    expect(refFor('2026-0000102')).toBe('gorendezvous:77')
    expect(rejected).toEqual([
      { line: 3, reasons: ['duplicate_map_row'] },
      { line: 4, reasons: ['invalid_map_row'] },
    ])
  })
})

// --- run(): « factures » ----------------------------------------------------------------------------

const CLIENTS = 'ClientId;FirstName;LastName\n77;Client;Fictif Un\n78;Client;Fictif Deux\n79;Client;Fictif Trois\n'

function setup({ answers = [], results = {}, extra = {} } = {}) {
  const output = []
  const report = { path: 'rapport.txt', text: '', write: vi.fn((t) => (report.text += t)), close: vi.fn() }
  const terminal = { ask: vi.fn(async () => answers.shift() ?? ''), askHidden: vi.fn(async () => 'secret'), say: vi.fn(), close: vi.fn() }
  const client = {
    auth: { signInWithPassword: vi.fn(async () => ({ error: null })), signOut: vi.fn(async () => ({ error: null })) },
    from: vi.fn(() => ({ select: async () => ({ data: [], error: null }) })),
    rpc: vi.fn(async (fn, { p_row, p_dry_run }) => {
      const n = p_row.gorendezvous_number
      const number = `${n.slice(0, 4)}-${Number(n.slice(5))}`
      return { data: results[n] ?? { status: 'ok', dry_run: p_dry_run, id: p_dry_run ? null : `id-${n}`, number }, error: null }
    }),
  }
  const texts = { 'f.csv': INVOICES, 'l.csv': LINES, 'p.csv': PAYMENTS, 'cl.csv': CLIENTS, ...extra }
  const deps = {
    env: { VITE_SUPABASE_ANON_KEY: 'anon' },
    out: (line) => output.push(line),
    readFile: (name) => texts[name],
    openReport: vi.fn(() => report),
    onSignals: vi.fn(() => () => {}),
    now: () => new Date('2026-10-13T16:00:00Z'),
    openTerminal: vi.fn(() => terminal),
    createClient: vi.fn(() => client),
  }
  return { deps, client, output, report }
}
const ARGS = ['factures', '--invoices', 'f.csv', '--lines', 'l.csv', '--payments', 'p.csv', '--clients', 'cl.csv', '--report', 'rapport.txt']

describe('import-gorendezvous factures', () => {
  it('the command line: its three files', () => {
    expect(() => parseCli(['factures', '--invoices', 'f.csv'])).toThrow(/--lines <csv> et --payments/)
    expect(() => parseCli(['factures', '--invoices', 'f.csv', '--lines', 'l.csv', '--payments', 'p.csv'])).toThrow(/--clients <csv>/)
    expect(parseCli([...ARGS, '--clients-map', 'm.csv']).clientsMap).toBe('m.csv')
  })

  it('a dry run: every invoice through import_invoice(row, true); counts, months and set-aside lines, no personal value', async () => {
    const { deps, client, output, report } = setup({ answers: ['adjointe@mana.test'] })
    expect(await run(ARGS, deps)).toBe(0)
    expect(client.rpc.mock.calls).toHaveLength(3)
    expect(client.rpc.mock.calls.every(([fn, args]) => fn === 'import_invoice' && args.p_dry_run === true)).toBe(true)
    expect(output).toContain('À importer : 3 ; déjà importées : 0 ; sans dossier : 0 ; en erreur : 0')
    expect(output).toContain('  2026-09 : export 2 facture(s), 244,98 $ ; dans l’app après l’import 2, 244,98 $')
    expect(output).toContain('  - facture sans ligne dans « par service-produit » (1) : lignes 5')
    expect(output).toContain('Factures payées par un tiers (IVAC, PAE…) : 1 ; importées au nom du client, le payeur reste à compléter.')
    expect(output.join('\n')).not.toMatch(personal)
    expect(report.text).not.toMatch(personal)
  })

  it('--commit: an invoice without its dossier is left out and said; the others imported after « importer »', async () => {
    const results = { '2026-0000102': { status: 'unmatched', dry_run: true, reason: 'client_ambiguous', number: '2026-102' } }
    const { deps, client, output } = setup({ answers: ['adjointe@mana.test', 'importer'], results })
    expect(await run([...ARGS, '--commit'], deps)).toBe(0)
    expect(client.rpc.mock.calls.filter(([, a]) => a.p_dry_run === false)).toHaveLength(3)
    expect(output).toContain('  - plusieurs dossiers importés à ce nom (départagez avec --clients-map) (1) : lignes 3')
    expect(output).toContain('Importées : 2 ; déjà importées : 0 ; sans dossier : 1 ; en erreur : 0')
    expect(output).toContain('Numérotation : la prochaine facture de l’app suit 2026-103.')
  })

  it('a re-run once everything is in: the months still count what the app holds', async () => {
    const results = Object.fromEntries(['2026-0000101', '2026-0000102', '2026-0000103'].map((n) => [n, { status: 'skipped', reason: 'Déjà importée' }]))
    const { deps, output } = setup({ answers: ['adjointe@mana.test'], results })
    expect(await run([...ARGS, '--commit'], deps)).toBe(0)
    expect(output).toContain('À importer : 0 ; déjà importées : 3 ; sans dossier : 0 ; en erreur : 0')
    expect(output).toContain('  2026-09 : export 2 facture(s), 244,98 $ ; dans l’app après l’import 2, 244,98 $')
    expect(output).toContain('Rien à importer.')
  })

  it('homonyms in the clients export: the invoices naming one without --clients-map stop the run before the database', async () => {
    const homonyms = `${CLIENTS}80;Client;Fictif Un\n`
    const { deps, client, output } = setup({ answers: ['adjointe@mana.test'], extra: { 'cl.csv': homonyms } })
    expect(await run(ARGS, deps)).toBe(2)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(output).toContain('== Clients homonymes dans l’export des clients : 2 ligne(s) de « par facture » sans ClientId')
    expect(output).toContain('  - lignes 2, 4')
    expect(output.join('\n')).not.toMatch(personal)

    const mapped = setup({ answers: ['adjointe@mana.test'], extra: { 'cl.csv': homonyms, 'm.csv': 'Facture;ClientId\n2026-0000101;77\n2026-0000103;80\n' } })
    expect(await run([...ARGS, '--clients-map', 'm.csv'], mapped.deps)).toBe(0)
    expect(mapped.client.rpc.mock.calls.map(([, a]) => a.p_row.client_ref)).toEqual(['gorendezvous:77', null, 'gorendezvous:80'])
  })

  it('an invoice the database refuses: nothing imported, its line and French reason', async () => {
    const results = { '2026-0000101': { status: 'error', dry_run: true, errors: [{ field: 'lines', message: 'Les lignes ne font pas le total de la facture.' }] } }
    const { deps, client, output } = setup({ answers: ['adjointe@mana.test', 'importer'], results })
    expect(await run([...ARGS, '--commit'], deps)).toBe(1)
    expect(client.rpc.mock.calls.some(([, a]) => a.p_dry_run === false)).toBe(false)
    expect(output).toContain('  - lines : Les lignes ne font pas le total de la facture. (1) : lignes 2')
    expect(output).toContain('Rien n’a été importé : corrigez les factures refusées, puis relancez.')
  })
})

describe('the homonyms key', () => {
  it('as the database: accents, case, punctuation and order dropped; ligatures spelled out', () => {
    expect(nameKey('TREMBLAY, Marie-Ève')).toBe('eve marie tremblay')
    expect(nameKey('marie eve tremblay')).toBe('eve marie tremblay')
    expect(nameKey('Cœur Lætitia')).toBe('coeur laetitia')
    expect(nameKey(' - ')).toBeNull()
  })
})
