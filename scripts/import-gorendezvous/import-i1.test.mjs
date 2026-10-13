// Batch I1: the mapping files, the rows sent, the price gaps and the import's run, with a fake
// terminal and a fake database client. Fixtures are synthetic: never real client data.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { parseCli, passReport, run } from '../import-gorendezvous.mjs'
import { readClients } from './clients.mjs'
import { readEmployees, readServiceCodes } from './mappings.mjs'
import { clientPayload, countryCode, readRelations } from './payloads.mjs'
import { priceGapReport, priceGaps, unitPriceCents } from './price-gaps.mjs'
import { readInvoiceLines } from './revenue.mjs'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')
const TODAY = '2026-10-12'

const DIRECTORY = [
  { id: 'p1', display_name: 'Geneviève Tremblay', licence_number: '08417', primary_title_id: 't-psy', professions: [{ title_id: 't-psy', licence_number: '08417', is_primary: true }] },
  { id: 'p3', display_name: 'Camille Roy', licence_number: '12873', primary_title_id: 't-psy', professions: [{ title_id: 't-psy', licence_number: '12873', is_primary: true }] },
  { id: 'p9', display_name: 'Julie Morin', licence_number: '41270-15', primary_title_id: 't-pse', professions: [] },
  { id: 'p10', display_name: 'Julie Morin', licence_number: '99999', primary_title_id: 't-ts', professions: [] },
]

describe('employees file', () => {
  const { lookup, rejected } = readEmployees(fixture('employes.csv'), DIRECTORY)

  it('maps a name or a licence to one professional and her primary title; the clinic agendas are excluded', () => {
    expect(rejected).toEqual([])
    expect(lookup('Pro Alpha')).toEqual({ id: 'p1', titleId: 't-psy' })
    expect(lookup('PRO BETA')).toEqual({ id: 'p3', titleId: 't-psy' })
    expect(lookup('Conseillère')).toEqual({ excluded: true })
    expect(lookup('Z MATRICE')).toEqual({ excluded: true })
    expect(lookup('Pro Inconnu')).toBeNull()
  })

  it('never guesses: unknown, ambiguous, duplicated or incomplete lines are refused with their line', () => {
    const text = 'Employé;Professionnel;Exclure\nPro A;12873;non\nPro B;Personne Absente;non\nPro C;Julie Morin;non\nPro A;08417;non\nPro D;;non\nPro E;41270-15;peut-être\n'
    expect(readEmployees(text, DIRECTORY).rejected).toEqual([
      { line: 3, reasons: ['unknown_professional'] },
      { line: 4, reasons: ['ambiguous_professional'] },
      { line: 5, reasons: ['duplicate_employee'] },
      { line: 6, reasons: ['missing_professional'] },
      { line: 7, reasons: ['invalid_excluded'] },
    ])
  })
})

describe('services file', () => {
  it('a line keeps its own catalogue code, else the file gives one; unknown codes are refused', () => {
    const { codeFor, rejected } = readServiceCodes(fixture('services.csv'), ['10130', '10150', '20160'])
    expect(rejected).toEqual([])
    expect(codeFor({ service: 'Psychothérapie individuelle 50 min', service_code: '10150' })).toBe('10150')
    expect(codeFor({ service: 'psychotherapie individuelle (ANCIEN)', service_code: null })).toBe('10150')
    expect(codeFor({ service: 'Inconnu', service_code: '99999' })).toBeNull()
    expect(readServiceCodes('Service;Code\nA;12\nB;55555\n', ['10150']).rejected).toEqual([
      { line: 2, reasons: ['invalid_code'] },
      { line: 3, reasons: ['unknown_code'] },
    ])
  })
})

describe('the rows sent to import_client', () => {
  const { clients } = readClients(fixture('clients.csv'), { today: TODAY })
  const { lookup } = readEmployees(fixture('employes.csv'), DIRECTORY)
  const byRef = (id) => clients.find((c) => c.externalRef === `gorendezvous:${id}`)

  it('C2 fields, the reference, the primary professional, the free tags (a payer tag kept), the country as a code', () => {
    const { row, flags } = clientPayload(byRef(1001), lookup)
    expect(flags).toEqual([])
    expect(row).toMatchObject({
      external_ref: 'gorendezvous:1001',
      first_name: 'Camille',
      email: 'camille.fictive@exemple.test',
      mobile_e164: '+15145550101',
      address_line1: '12 rue des Essais',
      province: 'QC',
      postal_code: 'H2X 1A1',
      country: 'CA',
      primary_professional_id: 'p1',
      rate_variant: 'student',
      archived: false,
      tags: ['IVAC'],
      insurance: null,
    })
  })

  it('an unknown professional or country is left out and flagged', () => {
    const record = { ...byRef(1003), primary_professional_label: 'Pro Inconnu', address: { ...byRef(1003).address, country: 'Atlantide' } }
    const { row, flags } = clientPayload(record, lookup)
    expect(row.primary_professional_id).toBeNull()
    expect(row.country).toBe('CA')
    expect(flags).toEqual(['unknown_country', 'unknown_primary_professional'])
    expect(countryCode('États-Unis')).toBe('US')
    expect(countryCode('')).toBe('CA')
  })

  it('an agreement tag sets special_agreement with its note', () => {
    const record = { ...byRef(1005), tagFields: { special_agreement: true }, tagNotes: ['Entente de paiement'] }
    expect(clientPayload(record).row).toMatchObject({ special_agreement: true, special_agreement_note: 'Entente de paiement (étiquette GOrendezvous)' })
  })
})

describe('relations file', () => {
  it('C2 types and rights by GOrendezvous id; the same person, an unknown link are refused', () => {
    const { relations, rejected } = readRelations(fixture('liens.csv'))
    expect(relations).toEqual([
      {
        line: 2,
        row: {
          client_ref: 'gorendezvous:1011',
          related_ref: 'gorendezvous:1001',
          type: 'parent',
          related_rights: { main_contact: true, manages_appointments: true, receives_communications: true, receives_invoices: false },
          client_rights: {},
        },
      },
    ])
    expect(rejected).toEqual([
      { line: 3, reasons: ['same_person'] },
      { line: 4, reasons: ['unknown_type'] },
    ])
  })
})

describe('price gaps', () => {
  const { lines } = readInvoiceLines(fixture('revenus-services.csv'))
  const { lookup } = readEmployees(fixture('employes.csv'), DIRECTORY)
  const { codeFor } = readServiceCodes(fixture('services.csv'), ['10130', '10150'])
  const grid = { '10150|t-psy': 13500, '10130|t-psy': 7500 }
  const gaps = priceGaps(lines, { professionalFor: lookup, codeFor, gridPrice: (code, title) => grid[`${code}|${title}`] ?? null })

  it('the price of a unit: the exported one, else the total without taxes', () => {
    expect(unitPriceCents({ unit_price_cents: null, total_cents: 11498, tps_cents: 500, tvq_cents: 998, quantity: 1 })).toBe(10000)
  })

  it('per title and code: the most frequent price, the others, the grid and the gap; the lines left out are counted', () => {
    expect(gaps.groups).toEqual([
      { titleId: 't-psy', code: '10150', lines: 3, prices: [[13000, 2], [12000, 1]], observed: 13000, grid: 13500, gap: -500 },
      { titleId: 't-psy', code: '10130', lines: 1, prices: [[7500, 1]], observed: 7500, grid: 7500, gap: 0 },
    ])
    expect(gaps.skipped).toEqual({ excluded: 1, no_code: 1, free: 1 })
  })

  it('the report names titles and codes, never a client or a professional', () => {
    const text = priceGapReport(gaps, { titleName: () => 'Psychologue', serviceName: (c) => (c === '10150' ? 'Psychothérapie 50 min' : 'Consultation 30 min'), on: TODAY }).join('\n')
    expect(text).toContain('10150 Psychothérapie 50 min : GOrendezvous 130,00 $ (2 lignes ; aussi 120,00 $ ×1) · app 135,00 $ · écart (app − GOrendezvous) +5,00 $')
    expect(text).toContain('10130 Consultation 30 min : GOrendezvous 75,00 $ (1 ligne) · app 75,00 $ · aucun écart')
    expect(text).not.toMatch(/Fictif|Pro Alpha|Pro Beta|Tremblay|Roy/)
  })
})

// --- run(): the flow, with a fake terminal and a fake database ---------------------------------------

function setup({ answers = [], results = {}, files = {}, local = true } = {}) {
  const output = []
  const report = { path: 'rapport.txt', text: '', write: vi.fn((t) => (report.text += t)), close: vi.fn() }
  const terminal = { ask: vi.fn(async () => answers.shift() ?? ''), askHidden: vi.fn(async () => 'secret'), say: vi.fn(), close: vi.fn() }
  const client = {
    auth: { signInWithPassword: vi.fn(async () => ({ error: null })), signOut: vi.fn(async () => ({ error: null })) },
    from: vi.fn((view) => ({ select: async () => ({ data: view === 'professionals_directory' ? DIRECTORY : [], error: null }) })),
    rpc: vi.fn(async (fn, { p_row, p_dry_run }) => {
      if (fn === 'import_client_relation') return { data: { status: 'ok', dry_run: p_dry_run }, error: null }
      const given = results[p_row.external_ref]
      return { data: given ?? { status: 'ok', dry_run: p_dry_run, id: p_dry_run ? null : `id-${p_row.external_ref}`, duplicates: [], tags_created: [] }, error: null }
    }),
  }
  const texts = { 'clients.csv': fixture('clients.csv'), 'employes.csv': fixture('employes.csv'), 'liens.csv': fixture('liens.csv'), ...files }
  const deps = {
    env: { VITE_SUPABASE_ANON_KEY: 'anon' },
    out: (line) => output.push(line),
    readFile: (name) => texts[name],
    openReport: vi.fn(() => report),
    onSignals: vi.fn(() => () => {}),
    now: () => new Date('2026-10-12T16:00:00Z'),
    openTerminal: vi.fn(() => terminal),
    createClient: vi.fn(() => client),
  }
  void local
  return { deps, client, terminal, output, report }
}

const ARGS = ['clients', '--clients', 'clients.csv', '--employees', 'employes.csv', '--relations', 'liens.csv', '--report', 'rapport.txt']
const personal = /Camille|Tremblay|Fictif|exemple\.test|555|1990-04-12|gorendezvous:/i

describe('import-gorendezvous run', () => {
  it('the command line: a command, its files, no --commit for « prix »', () => {
    expect(() => parseCli(['--clients', 'x'])).toThrow(/Usage/)
    expect(() => parseCli(['prix', '--lines', 'x'])).toThrow(/--employees/)
    expect(() => parseCli(['prix', '--lines', 'x', '--employees', 'y', '--commit'])).toThrow(/ne fait que lire/)
    expect(parseCli(['clients', '--clients', 'x']).command).toBe('clients')
  })

  it('a dry run by default: every client through import_client(row, true), no relation written, a report with no personal value', async () => {
    const { deps, client, output, report } = setup({ answers: ['admin@mana.test'] })
    expect(await run(ARGS, deps)).toBe(0)
    const calls = client.rpc.mock.calls
    expect(calls).toHaveLength(10)
    expect(calls.every(([fn, args]) => fn === 'import_client' && args.p_dry_run === true)).toBe(true)
    expect(output).toContain('À créer : 10 ; déjà importés : 0 ; en erreur : 0')
    expect(output.some((l) => l.startsWith('== Liens entre clients : 1 à créer ; refusés : 2'))).toBe(true)
    expect(report.text).not.toMatch(personal)
    expect(output.join('\n')).not.toMatch(personal)
    expect(client.auth.signOut).toHaveBeenCalled()
  })

  it('--commit: the dry run, « importer », the clients for real, then the relations', async () => {
    const { deps, client, output } = setup({ answers: ['admin@mana.test', 'importer'] })
    expect(await run([...ARGS, '--commit'], deps)).toBe(0)
    const real = client.rpc.mock.calls.filter(([, args]) => args.p_dry_run === false)
    expect(real.filter(([fn]) => fn === 'import_client')).toHaveLength(10)
    expect(real.filter(([fn]) => fn === 'import_client_relation')).toHaveLength(1)
    expect(output).toContain('Créés : 10 ; déjà importés : 0 ; en erreur : 0')
    expect(output).toContain('Liens créés : 1 ; déjà là : 0 ; en erreur : 0')
  })

  it('a row refused by the database: nothing imported, its line and reason in the report; a duplicate named by file number', async () => {
    const results = {
      'gorendezvous:1003': { status: 'error', dry_run: true, errors: [{ field: 'email', message: 'Le courriel n’est pas une adresse valide.' }] },
      'gorendezvous:1004': { status: 'ok', dry_run: true, id: null, duplicates: [{ level: 'high', client_number: 42 }], tags_created: [] },
    }
    const { deps, client, output, report } = setup({ answers: ['admin@mana.test'], results })
    expect(await run([...ARGS, '--commit'], deps)).toBe(1)
    expect(client.rpc.mock.calls.some(([, args]) => args.p_dry_run === false)).toBe(false)
    expect(output).toContain('  - email : Le courriel n’est pas une adresse valide. (1) : lignes 6')
    expect(output).toContain('  - ligne 7 ↔ dossier n° 42')
    expect(output).toContain('Rien n’a été importé : corrigez les erreurs, puis relancez.')
    expect(report.text).not.toMatch(personal)
  })

  it('a remote database: its project reference typed back first, else nothing happens', async () => {
    const { deps, client } = setup({ answers: ['pas la bonne'] })
    expect(await run([...ARGS, '--url', 'https://abcdefghijklmnopqrst.supabase.co'], deps)).toBe(2)
    expect(deps.createClient).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('an employees file that cannot be resolved stops before any row', async () => {
    const { deps, client, output } = setup({ answers: ['admin@mana.test'], files: { 'employes.csv': 'Employé;Professionnel\nPro X;Personne Absente\n' } })
    expect(await run(ARGS, deps)).toBe(2)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(output).toContain('Corrigez le fichier des employés, puis relancez : rien n’a été fait.')
  })

  it('« prix »: reads the catalogue and the grid, writes nothing', async () => {
    const { deps, client, output } = setup({ answers: ['admin@mana.test'], files: { 'lines.csv': fixture('revenus-services.csv'), 'services.csv': fixture('services.csv') } })
    client.from = vi.fn((view) => ({
      select: async () => ({
        data:
          view === 'professionals_directory'
            ? DIRECTORY
            : view === 'services_catalog'
              ? [{ id: 's150', code: 10150, name: 'Psychothérapie 50 min' }, { id: 's130', code: 10130, name: 'Consultation 30 min' }]
              : [{ id: 't-psy', name: 'Psychologue' }],
        error: null,
      }),
    }))
    client.rpc = vi.fn(async () => ({ data: [{ service_id: 's150', title_id: 't-psy', price_cents: 13500 }, { service_id: 's130', title_id: null, price_cents: 7500 }], error: null }))
    expect(await run(['prix', '--lines', 'lines.csv', '--employees', 'employes.csv', '--services', 'services.csv', '--on', TODAY], deps)).toBe(0)
    expect(client.rpc).toHaveBeenCalledWith('list_service_prices', { p_on: TODAY })
    expect(output).toContain('Psychologue :')
    expect(output.some((l) => l.includes('10150 Psychothérapie 50 min : GOrendezvous 130,00 $'))).toBe(true)
  })
})

describe('passReport', () => {
  it('counts and groups, never a value', () => {
    const entries = [
      { line: 4, status: 'ok', errors: [], duplicates: [], tagsCreated: ['Couple', 'Atelier'] },
      { line: 5, status: 'ok', errors: [], duplicates: [], tagsCreated: ['Couple'] },
    ]
    expect(passReport(entries, true)).toEqual(['À créer : 2 ; déjà importés : 0 ; en erreur : 0', 'Étiquettes à ajouter à la liste de la clinique (2) : Atelier, Couple'])
  })
})
