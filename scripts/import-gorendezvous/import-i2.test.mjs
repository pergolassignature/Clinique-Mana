// Batch I2 prep: the appointments export and its waiting list, the consents export, « Payé par »,
// and the « rendez-vous », « consentements » and « payeurs » runs with a fake terminal and a fake
// database. Synthetic data only.
import { describe, expect, it, vi } from 'vitest'
import { parseCli, run } from '../import-gorendezvous.mjs'
import { buildAppointmentRows, clinicInstant, isWaitlistService, parseTime, readAppointments } from './appointments.mjs'
import { consentKeyFor, readConsents } from './consents.mjs'
import { defaultPayers } from './payers.mjs'
import { readInvoices } from './revenue.mjs'

const APPOINTMENTS = `Rendez-vous (données fictives)

Id;Date;Heure;Fin;Client;ClientId;Client 2;Professionnel;Service;Code;Statut;Raison de l'annulation;Lien vidéo;Notes
501;2026-09-02;9:00;9:50;Client Fictif Un;77;;Pro Alpha;Psychothérapie individuelle 50 min;10150;Présent;;;note clinique fictive
502;2026-09-03;13h00;;Client Fictif Deux;;Client Fictif Trois;Pro Alpha;Thérapie de couple;20170;Absent;;;
503;2026-09-04;10:00;10:50;Client Fictif Un;77;;Pro Alpha;Psychothérapie individuelle 50 min;10150;Annulé;Maladie;;
504;2026-11-20;9:00 AM;;Client Fictif Un;77;;Pro Alpha;Psychothérapie individuelle 50 min;10150;Confirmé;;https://visio.exemple.test/s-504;
505;2026-11-21;10:00;;Client Fictif Deux;;;Pro Beta;Psychothérapie individuelle 50 min;10150;;;;
506;2026-08-01;8:00;;Client Fictif Quatre;;;conseillère;Inscription – Liste attente;;Réservé;;;
507;2026-08-02;8:00;;Client Fictif Cinq;;;Pro Alpha;Inscription - Liste d'attente;;;;;
508;2026-08-03;8:00;;Client Fictif Six;;;conseillère;Appel administratif;;;;;
509;2026-09-05;25:00;;Client Fictif Un;77;;Pro Alpha;Psychothérapie individuelle 50 min;10150;;;;
510;2026-09-06;9:00;;Client Fictif Un;77;;Agenda Inconnu;Psychothérapie individuelle 50 min;10150;;;;
511;2026-09-07;9:00;;Client Fictif Un;77;;Pro Alpha;Service ancien sans code;;;;;
501;2026-09-02;9:00;9:50;Client Fictif Un;77;;Pro Alpha;Psychothérapie individuelle 50 min;10150;Présent;;;
`
const NOW = new Date('2026-10-13T16:00:00Z')
const lookup = (label) => (label === 'Pro Alpha' ? { id: 'p1', titleId: 't1' } : label === 'Pro Beta' ? { id: 'p2', titleId: 't1' } : label === 'conseillère' ? { excluded: true } : null)
const codeFor = (r) => (['10150', '20170'].includes(r.service_code) ? r.service_code : null)
const personal = /Fictif|Pro Alpha|Pro Beta|gorendezvous:|note clinique|visio\.exemple/i

describe('times in the clinic’s zone', () => {
  it('reads GOrendezvous’s time forms', () => {
    expect(['9:00', '09h00', '9 h 30', '9:00 AM', '1:15 pm', '13:05:00', '25:00', '9'].map(parseTime)).toEqual([540, 540, 570, 540, 795, 785, null, null])
  })
  it('a wall clock with its offset, both sides of the November change', () => {
    expect(clinicInstant('2026-10-31', 540)).toBe('2026-10-31T09:00:00-04:00')
    expect(clinicInstant('2026-11-02', 540)).toBe('2026-11-02T09:00:00-05:00')
  })
  it('the waiting list’s fake appointments, however written', () => {
    expect(['Inscription – Liste attente', "Inscription - Liste d'attente", 'Liste d’attente', 'Psychothérapie'].map(isWaitlistService)).toEqual([true, true, true, false])
  })
})

describe('readAppointments and buildAppointmentRows', () => {
  const read = readAppointments(APPOINTMENTS)
  const built = buildAppointmentRows(read.appointments, { professionalFor: lookup, codeFor, now: NOW, feePaid: (c) => c.client_name === 'Client Fictif Cinq' })

  it('an unreadable time and a repeated id refused by the reader', () => {
    expect(read.rejected).toEqual([
      { line: 12, reasons: ['invalid_time'] },
      { line: 15, reasons: ['duplicate_appointment'] },
    ])
  })

  it('history: completed (a couple, absent), cancelled with its reason; its reference from GOrendezvous’s id', () => {
    const [a, b, c] = built.appointments
    expect(a).toMatchObject({ line: 4, past: true, month: '2026-09' })
    expect(a.row).toEqual({
      external_ref: 'gorendezvous:rdv:501', professional_id: 'p1', service_code: '10150',
      clients: [{ client_ref: 'gorendezvous:77', client_name: 'Client Fictif Un' }],
      starts_at: '2026-09-02T09:00:00-04:00', ends_at: '2026-09-02T09:50:00-04:00', mode: 'video', state: 'completed',
      cancel_reason: null, cancelled_at: null, video_url: null,
    })
    expect(b.row.clients).toEqual([
      { client_ref: null, client_name: 'Client Fictif Deux', absent: 'true' },
      { client_ref: null, client_name: 'Client Fictif Trois', absent: 'true' },
    ])
    expect(c.row).toMatchObject({ state: 'cancelled', cancel_reason: 'Maladie' })
  })

  it('coming: confirmed with its link, booked; never a note', () => {
    const [, , , d, e] = built.appointments
    expect(d.row).toMatchObject({ state: 'confirmed', starts_at: '2026-11-20T09:00:00-05:00', ends_at: null, video_url: 'https://visio.exemple.test/s-504' })
    expect(e.row).toMatchObject({ state: 'booked', professional_id: 'p2' })
    expect(JSON.stringify(built)).not.toMatch(/note clinique/)
  })

  it('the waiting list: the conseillère’s → the profession, a professional’s → hers; the fee paid from « par service-produit »', () => {
    expect(built.waitlist.map((w) => w.row)).toEqual([
      { external_ref: 'gorendezvous:attente:506', client_ref: null, client_name: 'Client Fictif Quatre', profession_key: 'psychologue', registered_at: '2026-08-01T08:00:00-04:00', fee_paid: 'false' },
      { external_ref: 'gorendezvous:attente:507', client_ref: null, client_name: 'Client Fictif Cinq', professional_id: 'p1', registered_at: '2026-08-02T08:00:00-04:00', fee_paid: 'true' },
    ])
  })

  it('an administrative agenda set aside; an unknown agenda or service refused', () => {
    expect(built.setAside).toEqual([{ line: 11, reasons: ['admin_agenda'] }])
    expect(built.rejected).toEqual([
      { line: 13, reasons: ['unknown_employee'] },
      { line: 14, reasons: ['unknown_service'] },
    ])
  })

  it('without an id, a stable reference from the agenda, the start and the client', () => {
    const text = 'Date;Heure;Client;Professionnel;Service;Code\n2026-11-20;9:00;Client Fictif Un;Pro Alpha;Psy;10150\n'
    const [one] = readAppointments(text).appointments
    const [two] = readAppointments(text).appointments
    expect(one.key).toMatch(/^[0-9a-f]{20}$/)
    expect(one.key).toBe(two.key)
  })
})

describe('the consents export', () => {
  it('the 7 consents by their GOrendezvous names; the latest signature kept', () => {
    expect(['Consentement général', "Liste d'attente en psychologie", 'Transfert de dossier', 'Stagiaire en psychothérapie', 'Coaching', 'Naturopathie', 'PAE externe', 'Sondage'].map(consentKeyFor))
      .toEqual(['general', 'waitlist', 'file_transfer', 'intern', 'coaching', 'naturopathy', 'eap', null])
    const { consents, rejected } = readConsents(`ClientId;Client;Formulaire;Signé le;Version;Signé par
77;Client Fictif Un;Consentement général;2024-05-06;v2;Client Fictif Un
77;Client Fictif Un;Consentement général;2025-01-10;v3;Client Fictif Un
;Client Fictif Deux;Sondage;2025-01-10;;
;Client Fictif Deux;Liste d'attente;10/01/2025;;
`)
    expect(consents.map((c) => c.row)).toEqual([
      { client_ref: 'gorendezvous:77', client_name: 'Client Fictif Un', consent_key: 'general', signed_at: '2025-01-10T12:00:00-05:00', version_label: 'v3', signer_name: 'Client Fictif Un' },
    ])
    expect(rejected).toEqual([
      { line: 2, reasons: ['duplicate_consent'] },
      { line: 4, reasons: ['unknown_form'] },
      { line: 5, reasons: ['invalid_signed_on'] },
    ])
  })
})

describe('« Payé par »', () => {
  it('per client her latest invoice: another person → her default payer; herself or an organisation → nothing', () => {
    const { invoices } = readInvoices(`Date;Facture;Client;Total;Payé par
2026-08-01;2026-0000001;Client Fictif Un;100,00 $;Parent Fictif
2026-09-01;2026-0000002;Client Fictif Un;100,00 $;Parent Fictif
2026-09-01;2026-0000003;Client Fictif Deux;100,00 $;IVAC
2026-09-02;2026-0000004;Client Fictif Trois;100,00 $;Client Fictif Trois
2026-08-02;2026-0000005;Client Fictif Quatre;100,00 $;Parent Fictif
2026-09-02;2026-0000006;Client Fictif Quatre;100,00 $;
`)
    const { rows, counts } = defaultPayers(invoices, { refFor: (n) => (n === '2026-0000002' ? 'gorendezvous:77' : null) })
    expect(rows).toEqual([{ line: 3, row: { client_ref: 'gorendezvous:77', client_name: 'Client Fictif Un', payer_name: 'Parent Fictif', effective_from: '2026-09-01' } }])
    expect(counts).toEqual({ self: 1, organisation: 1, no_payer: 1 })
  })
})

// --- run() ---------------------------------------------------------------------------------------

const EMPLOYEES = 'Employé;Professionnel;Exclure\nPro Alpha;Pro Alpha;non\nPro Beta;Pro Beta;non\nconseillère;;oui\n'
const LINES = `Date;Facture;Client;Professionnel;Service;Code;Quantité;Prix;TPS;TVQ;Total
2026-08-02;2026-0000009;Client Fictif Cinq;Pro Alpha;Inscription – Liste attente;50100;1;18,91 $;0,95 $;1,89 $;21,75 $
`
// The clients export: each name held by one ClientId (no homonym).
const CLIENTS = `ClientId;FirstName;LastName
77;Client;Fictif Un
78;Client;Fictif Deux
79;Client;Fictif Trois
80;Client;Fictif Quatre
81;Client;Fictif Cinq
82;Parent;Fictif
`
// … and with a homonym: two ClientIds named « Client Fictif Deux ».
const HOMONYMS = `${CLIENTS}83;CLIENT;fictif deux
`
function setup({ answers = [], results = {}, texts = {} } = {}) {
  const output = []
  const report = { path: 'rapport.txt', text: '', write: vi.fn((t) => (report.text += t)), close: vi.fn() }
  const terminal = { ask: vi.fn(async () => answers.shift() ?? ''), askHidden: vi.fn(async () => 'secret'), say: vi.fn(), close: vi.fn() }
  const directory = [
    { id: 'p1', display_name: 'Pro Alpha', licence_number: null, primary_title_id: 't1', professions: [] },
    { id: 'p2', display_name: 'Pro Beta', licence_number: null, primary_title_id: 't1', professions: [] },
  ]
  const client = {
    auth: { signInWithPassword: vi.fn(async () => ({ error: null })), signOut: vi.fn(async () => ({ error: null })) },
    from: vi.fn((view) => ({ select: async () => ({ data: view === 'professionals_directory' ? directory : view === 'services_catalog' ? [{ code: 10150 }, { code: 20170 }] : [], error: null }) })),
    rpc: vi.fn(async (fn, { p_row, p_dry_run }) => ({ data: results[p_row.external_ref ?? p_row.consent_key ?? p_row.client_name] ?? { status: 'ok', dry_run: p_dry_run }, error: null })),
  }
  const files = { 'rdv.csv': APPOINTMENTS, 'emp.csv': EMPLOYEES, 'l.csv': LINES, 'cl.csv': CLIENTS, ...texts }
  const deps = {
    env: { VITE_SUPABASE_ANON_KEY: 'anon' },
    out: (line) => output.push(line),
    readFile: (name) => files[name],
    openReport: vi.fn(() => report),
    onSignals: vi.fn(() => () => {}),
    now: () => NOW,
    openTerminal: vi.fn(() => terminal),
    createClient: vi.fn(() => client),
  }
  return { deps, client, output, report }
}
const CLEAN = `Id;Date;Heure;Client;ClientId;Professionnel;Service;Code;Statut
601;2026-09-02;9:00;Client Fictif Un;77;Pro Alpha;Psychothérapie individuelle 50 min;10150;Présent
602;2026-11-20;9:00;Client Fictif Un;77;Pro Alpha;Psychothérapie individuelle 50 min;10150;Confirmé
603;2026-11-20;9:30;Client Fictif Deux;;Pro Alpha;Psychothérapie individuelle 50 min;10150;
604;2026-08-01;8:00;Client Fictif Quatre;;conseillère;Inscription – Liste attente;;
`
const RDV = ['rendez-vous', '--appointments', 'rdv.csv', '--employees', 'emp.csv', '--lines', 'l.csv', '--clients', 'cl.csv', '--report', 'rapport.txt']

describe('import-gorendezvous rendez-vous, consentements, payeurs', () => {
  it('the command line', () => {
    expect(() => parseCli(['rendez-vous', '--appointments', 'a.csv'])).toThrow(/--employees/)
    expect(() => parseCli(['consentements'])).toThrow(/--consents/)
    expect(() => parseCli(['payeurs'])).toThrow(/--invoices/)
    expect(() => parseCli(['consentements', '--consents', 'c.csv'])).toThrow(/--clients <csv> \(l’export des clients\)/)
    expect(() => parseCli(['payeurs', '--invoices', 'f.csv'])).toThrow(/--clients/)
    expect(() => parseCli(['rendez-vous', '--appointments', 'a.csv', '--employees', 'e.csv'])).toThrow(/--clients/)
    expect(() => parseCli([...RDV, '--waitlist-profession', 'Psy chologue'])).toThrow(/clé d’une profession/)
    expect(parseCli(RDV).waitlistProfession).toBe('psychologue')
  })

  it('a dry run with lines to fix: both RPCs dry-run, the refused and set-aside lines said, exit 1, no personal value', async () => {
    const { deps, client, output, report } = setup({ answers: ['adjointe@mana.test'] })
    expect(await run(RDV, deps)).toBe(1)
    const calls = client.rpc.mock.calls
    expect(calls.filter(([fn]) => fn === 'import_appointment')).toHaveLength(5)
    expect(calls.filter(([fn]) => fn === 'import_waitlist_entry')).toHaveLength(2)
    expect(calls.every(([, a]) => a.p_dry_run === true)).toBe(true)
    expect(output).toContain('  - agenda absent du fichier des employés (--employees) (1) : lignes 13')
    expect(output).toContain('  - agenda administratif (conseillère, Bureau administratif) : pas une séance, laissé de côté (1) : lignes 11')
    expect(output.join('\n')).not.toMatch(personal)
    expect(report.text).not.toMatch(personal)
  })

  it('--commit on a clean export: the appointments, then the waiting list; a coming overlap said; an unmatched client left out', async () => {
    const results = {
      'gorendezvous:rdv:603': { status: 'conflict', future: true },
      'gorendezvous:rdv:601': { status: 'unmatched', reason: 'client_ambiguous' },
    }
    const { deps, client, output } = setup({ answers: ['adjointe@mana.test', 'importer', 'importer'], results, texts: { 'rdv.csv': CLEAN } })
    expect(await run([...RDV, '--commit'], deps)).toBe(0)
    const real = client.rpc.mock.calls.filter(([, a]) => a.p_dry_run === false)
    expect(real.map(([fn]) => fn)).toEqual(['import_appointment', 'import_appointment', 'import_appointment', 'import_waitlist_entry'])
    expect(output).toContain('Importés : 1 ; déjà importés : 0 ; sans dossier : 1 ; en conflit : 1 ; en erreur : 0')
    expect(output.some((l) => l.startsWith('    dont à venir (1) : lignes 4.'))).toBe(true)
    expect(output).toContain('  - plusieurs dossiers importés à ce nom (départagez avec son ClientId) (1) : lignes 2')
  })

  it('a row the database refuses: nothing imported', async () => {
    const results = { 'gorendezvous:rdv:602': { status: 'error', errors: [{ field: 'service_code', message: 'Le code de service est inconnu du catalogue.' }] } }
    const { deps, client, output } = setup({ answers: ['adjointe@mana.test', 'importer'], results, texts: { 'rdv.csv': CLEAN } })
    expect(await run([...RDV, '--commit'], deps)).toBe(1)
    expect(client.rpc.mock.calls.some(([, a]) => a.p_dry_run === false)).toBe(false)
    expect(output).toContain('  - service_code : Le code de service est inconnu du catalogue. (1) : lignes 3')
  })

  it('consentements: dry run then import after « importer »; already in force counted', async () => {
    const consents = 'ClientId;Client;Formulaire;Signé le\n77;Client Fictif Un;Consentement général;2024-05-06\n78;Client Fictif Deux;Coaching;2024-06-01\n'
    const { deps, client, output } = setup({ answers: ['adjointe@mana.test', 'importer'], results: { coaching: { status: 'skipped', reason: 'Déjà en vigueur' } }, texts: { 'c.csv': consents } })
    expect(await run(['consentements', '--consents', 'c.csv', '--clients', 'cl.csv', '--commit'], deps)).toBe(0)
    expect(client.rpc.mock.calls.filter(([fn, a]) => fn === 'import_client_consent' && a.p_dry_run === false)).toHaveLength(2)
    expect(output).toContain('Importés : 1 ; déjà importés : 1 ; en erreur : 0')
    expect(output.join('\n')).not.toMatch(personal)
  })

  it('payeurs: a payer without the right is listed', async () => {
    const invoices = 'Date;Facture;Client;Total;Payé par\n2026-09-01;2026-0000002;Client Fictif Un;100,00 $;Parent Fictif\n2026-09-01;2026-0000003;Client Fictif Deux;100,00 $;IVAC\n'
    const { deps, output } = setup({ answers: ['adjointe@mana.test'], results: { 'Client Fictif Un': { status: 'unmatched', reason: 'payer_not_allowed' } }, texts: { 'f.csv': invoices } })
    expect(await run(['payeurs', '--invoices', 'f.csv', '--clients', 'cl.csv'], deps)).toBe(0)
    expect(output.some((l) => l.includes('« recevoir reçus et factures »') && l.includes('lignes 2'))).toBe(true)
    expect(output.join('\n')).not.toMatch(personal)
  })

  it('homonyms: a row naming one without its ClientId stops the run before the database (rendez-vous, consentements)', async () => {
    const rdv = setup({ answers: ['adjointe@mana.test'], texts: { 'cl.csv': HOMONYMS, 'rdv.csv': CLEAN } })
    expect(await run(RDV, rdv.deps)).toBe(2)
    expect(rdv.client.rpc).not.toHaveBeenCalled()
    expect(rdv.output).toContain('== Clients homonymes dans l’export des clients : 1 ligne(s) de l’export des rendez-vous sans ClientId')
    expect(rdv.output).toContain('  - lignes 4')
    expect(rdv.output.at(-2)).toMatch(/l’export doit donner son ClientId \(colonne ClientId\), puis relancez : rien n’a été fait\.$/)
    expect(rdv.output.join('\n')).not.toMatch(personal)

    const consents = 'ClientId;Client;Formulaire;Signé le\n;Client Fictif Deux;Coaching;2024-06-01\n78;Client Fictif Deux;Consentement général;2024-06-01\n'
    const c = setup({ answers: ['adjointe@mana.test'], texts: { 'cl.csv': HOMONYMS, 'c.csv': consents } })
    expect(await run(['consentements', '--consents', 'c.csv', '--clients', 'cl.csv'], c.deps)).toBe(2)
    expect(c.client.rpc).not.toHaveBeenCalled()
    expect(c.output).toContain('  - lignes 2')
  })

  it('homonyms: a ClientId the clients import refuses (none, or seen twice) makes its name unsure', async () => {
    const unsure = `${CLIENTS};Client;Fictif Un\n`
    const consents = 'ClientId;Client;Formulaire;Signé le\n;Client Fictif Un;Coaching;2024-06-01\n'
    const c = setup({ answers: ['adjointe@mana.test'], texts: { 'cl.csv': unsure, 'c.csv': consents } })
    expect(await run(['consentements', '--consents', 'c.csv', '--clients', 'cl.csv'], c.deps)).toBe(2)
    expect(c.client.rpc).not.toHaveBeenCalled()
  })

  it('payeurs: a client homonym needs --clients-map; a payer homonym is left out', async () => {
    const invoices = 'Date;Facture;Client;Total;Payé par\n2026-09-01;2026-0000002;Client Fictif Un;100,00 $;Client Fictif Deux\n2026-09-01;2026-0000003;Client Fictif Deux;100,00 $;Parent Fictif\n'
    const blocked = setup({ answers: ['adjointe@mana.test'], texts: { 'f.csv': invoices, 'cl.csv': HOMONYMS } })
    expect(await run(['payeurs', '--invoices', 'f.csv', '--clients', 'cl.csv'], blocked.deps)).toBe(2)
    expect(blocked.client.rpc).not.toHaveBeenCalled()
    expect(blocked.output.some((l) => l.includes('payeur nommé comme plusieurs dossiers') && l.includes('lignes 2'))).toBe(true)
    expect(blocked.output.at(-1)).toMatch(/--clients-map \(« Facture ; ClientId »\)/)

    const mapped = setup({ answers: ['adjointe@mana.test'], texts: { 'f.csv': invoices, 'cl.csv': HOMONYMS, 'm.csv': 'Facture;ClientId\n2026-0000003;78\n' } })
    expect(await run(['payeurs', '--invoices', 'f.csv', '--clients', 'cl.csv', '--clients-map', 'm.csv'], mapped.deps)).toBe(0)
    expect(mapped.client.rpc.mock.calls.map(([, a]) => a.p_row.client_ref)).toEqual(['gorendezvous:78'])
  })

  it('a database error: its code only; a refusal (P0001) as written', async () => {
    const consents = 'ClientId;Client;Formulaire;Signé le\n77;Client Fictif Un;Coaching;2024-06-01\n'
    const failing = setup({ answers: ['adjointe@mana.test'], texts: { 'c.csv': consents } })
    failing.client.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'valeur « Client Fictif Un » refusée', details: 'x' } })
    expect(await run(['consentements', '--consents', 'c.csv', '--clients', 'cl.csv'], failing.deps)).toBe(2)
    expect(failing.output.at(-1)).toBe('Erreur de la base (23514) : l’import s’arrête. Relancez la même commande ; si l’erreur revient, transmettez ce code.')
    expect(failing.output.join('\n')).not.toMatch(personal)

    const closed = setup({ answers: ['adjointe@mana.test'], texts: { 'c.csv': consents } })
    closed.client.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Les imports sont fermés pour cette clinique.' } })
    expect(await run(['consentements', '--consents', 'c.csv', '--clients', 'cl.csv'], closed.deps)).toBe(2)
    expect(closed.output.at(-1)).toBe('Refusé par la base : Les imports sont fermés pour cette clinique.')
  })
})
