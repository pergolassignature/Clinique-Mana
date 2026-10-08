// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  InputError,
  LOCAL_URL,
  buildRows,
  normalizeHeader,
  parseCsv,
  readRows,
  reportCsv,
  reportName,
  resolveTarget,
  rowToPayload,
  run,
} from './import-professionals.mjs'

const BOM = String.fromCharCode(0xfeff)
const HEADER = 'prenom,nom,courriel,telephone,ville,province,code_postal,annees_experience,titre_1,permis_1,titre_2,permis_2,langues,clienteles,approches,motifs,ivac,activer'
const ROW = 'Élodie,Gagnon,elodie.gagnon@example.test,514 555-0142,Montréal,QC,H2J 3K5,14,psychologue,54321,,,fr;en,adults*;couples,cbt*;act,anxiete;deuil,IVAC-1,oui'

describe('parseCsv', () => {
  it('reads quoted cells holding commas, doubled quotes and line breaks, and keeps each record’s first line', () => {
    const { records } = parseCsv('a,b,c\r\n"x, y","il dit ""oui""","deux\nlignes"\r\n1,,3\n')
    expect(records).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['x, y', 'il dit "oui"', 'deux\nlignes'] },
      { line: 4, cells: ['1', '', '3'] },
    ])
  })

  it('drops a UTF-8 BOM and reads a last line without a line break', () => {
    expect(parseCsv(`${BOM}a,b\n1,2`).records).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
    ])
  })

  it('takes the semicolon as delimiter when the header uses it (French Excel)', () => {
    const { delimiter, records } = parseCsv('prenom;nom;langues\nLéa;Roy;"fr;en"\n')
    expect(delimiter).toBe(';')
    expect(records[1]?.cells).toEqual(['Léa', 'Roy', 'fr;en'])
  })

  it('keeps empty cells, CR-only line ends and a trailing empty cell', () => {
    expect(parseCsv('a,b,c\r1,,\r').records).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['1', '', ''] },
    ])
  })

  it('refuses an unclosed quote and text after a closing quote, naming the line', () => {
    expect(() => parseCsv('a,b\n1,"oups\n')).toThrow('Ligne 2 : guillemet ouvert jamais fermé.')
    expect(() => parseCsv('a,b\n"x"y,2\n')).toThrow('Ligne 2 : texte après un guillemet fermant.')
  })
})

describe('readRows', () => {
  it('matches header names without case or accents and skips blank lines', () => {
    expect(normalizeHeader(' Prénom ')).toBe('prenom')
    expect(normalizeHeader('Code postal')).toBe('code_postal')
    expect(normalizeHeader('Années-expérience')).toBe('annees_experience')
    const rows = readRows('Prénom,Nom,Courriel,Clientèles\nLéa, Roy ,lea@example.test,adults\n,,,\n\nMax,Roy,max@example.test,\n')
    expect(rows).toEqual([
      { line: 2, values: { prenom: 'Léa', nom: 'Roy', courriel: 'lea@example.test', clienteles: 'adults' } },
      { line: 5, values: { prenom: 'Max', nom: 'Roy', courriel: 'max@example.test', clienteles: '' } },
    ])
  })

  it('refuses unknown, repeated or missing columns and rows wider than the header', () => {
    expect(() => readRows('prenom,nom,courriel,motif\n')).toThrow('Colonnes inconnues : motif.')
    expect(() => readRows('prenom,nom,courriel,Nom\n')).toThrow('Colonne en double : nom.')
    expect(() => readRows('prenom,courriel\n')).toThrow('Colonnes obligatoires absentes : nom.')
    expect(() => readRows('prenom,nom,courriel\na,b,c,d\n')).toThrow('Ligne 2 : plus de cellules que de colonnes.')
    expect(() => readRows('')).toThrow(InputError)
  })
})

describe('rowToPayload', () => {
  const values = (overrides = {}) => ({ ...readRows(`${HEADER}\n${ROW}\n`)[0].values, ...overrides })

  it('maps a full row to import_professional’s payload (« * » → specialized, titre_1 primary)', () => {
    expect(rowToPayload(values())).toEqual({
      errors: [],
      payload: {
        first_name: 'Élodie',
        last_name: 'Gagnon',
        email: 'elodie.gagnon@example.test',
        personal_phone: '514 555-0142',
        city: 'Montréal',
        province: 'QC',
        postal_code: 'H2J 3K5',
        years_experience: 14,
        professions: [{ title_key: 'psychologue', licence_number: '54321', is_primary: true }],
        languages: ['fr', 'en'],
        clienteles: [
          { key: 'adults', specialized: true },
          { key: 'couples', specialized: false },
        ],
        approaches: [
          { key: 'cbt', specialized: true },
          { key: 'act', specialized: false },
        ],
        motifs: ['anxiete', 'deuil'],
        ivac: 'IVAC-1',
        activate: true,
      },
    })
  })

  it('leaves empty cells out, splits lists on ; or , and drops empty items', () => {
    const { payload, errors } = rowToPayload({ prenom: 'Léa', nom: 'Roy', courriel: 'lea@example.test', motifs: ' anxiete ;; deuil, ', activer: 'Non', titre_1: 'coach_professionnel' })
    expect(errors).toEqual([])
    expect(payload).toEqual({
      first_name: 'Léa',
      last_name: 'Roy',
      email: 'lea@example.test',
      professions: [{ title_key: 'coach_professionnel', is_primary: true }],
      motifs: ['anxiete', 'deuil'],
    })
  })

  it('reports what the CSV encodes wrongly, under the client schemas’ field names', () => {
    const { errors } = rowToPayload(
      values({ annees_experience: 'douze', activer: 'peut-être', langues: 'fr*', clienteles: '*', titre_1: '', permis_1: '123', titre_2: 'psychologue' }),
    )
    expect(errors).toEqual([
      { field: 'yearsExperience', message: 'Entre 0 et 60 ans.' },
      { field: 'professions.0.licenceNumber', message: 'Un numéro de permis demande un titre.' },
      { field: 'professions.0.titleId', message: 'Indiquez le titre principal dans titre_1.' },
      { field: 'languages', message: 'Le « * » ne s’applique qu’aux clientèles et aux approches.' },
      { field: 'clienteles', message: 'Une clé manque avant le « * ».' },
      { field: 'activate', message: 'Indiquez oui ou non.' },
    ])
  })

  it('flags an email repeated in the file from its second line on', () => {
    const rows = buildRows(`${HEADER}\n${ROW}\n${ROW.replace('Élodie', 'Élo').replace('elodie.gagnon', 'ELODIE.GAGNON')}\n`)
    expect(rows[0].errors).toEqual([])
    expect(rows[1].errors).toEqual([{ field: 'email', message: 'Courriel déjà présent à la ligne 2 du fichier.' }])
  })

  it('reads the sample file without an error', () => {
    const rows = buildRows(readFileSync(new URL('./fixtures/professionals-sample.csv', import.meta.url), 'utf8'))
    expect(rows).toHaveLength(6)
    expect(rows.flatMap((r) => r.errors)).toEqual([])
    expect(rows.every((r) => r.email.endsWith('@example.test'))).toBe(true)
  })
})

describe('resolveTarget', () => {
  it('uses the local stack by default and accepts its two local origins', () => {
    expect(resolveTarget(undefined)).toEqual({ url: LOCAL_URL, local: true, confirmWith: null })
    expect(resolveTarget('http://localhost:55321/')).toEqual({ url: 'http://localhost:55321', local: true, confirmWith: null })
  })

  it('asks for the project reference of a remote Supabase project, or the host name of another host', () => {
    expect(resolveTarget('https://abcdefghijklmnopqrst.supabase.co')).toEqual({
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      local: false,
      confirmWith: 'abcdefghijklmnopqrst',
    })
    expect(resolveTarget('https://api.exemple.test').confirmWith).toBe('api.exemple.test')
  })

  it('refuses plain http outside the local stack (PS Hub’s 54321 included), paths and credentials', () => {
    expect(() => resolveTarget('http://127.0.0.1:54321')).toThrow('Adresse refusée')
    expect(() => resolveTarget('http://abcdefghijklmnopqrst.supabase.co')).toThrow('Adresse refusée')
    expect(() => resolveTarget('https://abcdefghijklmnopqrst.supabase.co/rest/v1')).toThrow('L’adresse doit être celle du projet seulement')
    expect(() => resolveTarget('https://user:pw@abcdefghijklmnopqrst.supabase.co')).toThrow(InputError)
    expect(() => resolveTarget('pas une adresse')).toThrow('Adresse invalide')
  })
})

describe('reportCsv', () => {
  it('holds the line, the email, the mode, the status, the id and the messages, quoted when needed', () => {
    const csv = reportCsv(
      [
        { line: 2, email: 'a@example.test', status: 'ok', id: 'id-1', details: ['1 titre · activé'] },
        { line: 3, email: 'b@example.test', status: 'error', id: null, details: ['motifs : Motif inconnu : anxite', 'telephone : Numéro à 10 chiffres.'] },
        { line: 4, email: '=cmd', status: 'skipped', id: 'id-2', details: ['Courriel déjà présent, "x"'] },
      ],
      'essai',
    )
    expect(csv).toBe(
      'ligne,courriel,mode,statut,id,details\r\n' +
        '2,a@example.test,essai,ok,id-1,1 titre · activé\r\n' +
        '3,b@example.test,essai,erreur,,motifs : Motif inconnu : anxite | telephone : Numéro à 10 chiffres.\r\n' +
        `4,'=cmd,essai,ignoré,id-2,"Courriel déjà présent, ""x"""\r\n`,
    )
  })

  it('names the report after the UTC time', () => {
    expect(reportName(new Date('2026-10-08T16:31:57.123Z'))).toBe('import-report-20261008T163157Z.csv')
  })
})

// --- run(): the flow, with a fake terminal and a fake client ------------------------------------

function setup({ answers = [], results = {} } = {}) {
  const output = []
  const files = {}
  const terminal = {
    ask: vi.fn(async () => answers.shift() ?? ''),
    askHidden: vi.fn(async () => 'mot-de-passe-secret'),
    say: vi.fn(),
    close: vi.fn(),
  }
  const client = {
    auth: {
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(async (_name, { p_row, p_dry_run }) => ({
      data: results[p_row.email] ?? { status: 'ok', dry_run: p_dry_run, id: p_dry_run ? null : `id-${p_row.email}`, activated: true, complete: true, missing: [] },
      error: null,
    })),
  }
  const deps = {
    env: { VITE_SUPABASE_ANON_KEY: 'anon' },
    out: (line) => output.push(line),
    readFile: () => `${HEADER}\n${ROW}\n${ROW.replace('elodie.gagnon', 'eve.roy').replace('Gagnon', 'Roy')}\n`,
    writeFile: vi.fn((path, text) => {
      files[path] = text
    }),
    now: () => new Date('2026-10-08T16:31:57Z'),
    openTerminal: vi.fn(() => terminal),
    createClient: vi.fn(() => client),
  }
  return { deps, client, terminal, output, files }
}

describe('run', () => {
  it('is a dry run by default: every row with p_dry_run true, nothing for real, a report', async () => {
    const { deps, client, terminal, output, files } = setup({ answers: ['admin@mana.test'] })
    expect(await run(['--file', 'x.csv'], deps)).toBe(0)
    expect(deps.createClient).toHaveBeenCalledWith(LOCAL_URL, 'anon')
    expect(client.rpc).toHaveBeenCalledTimes(2)
    expect(client.rpc.mock.calls.every(([name, args]) => name === 'import_professional' && args.p_dry_run === true)).toBe(true)
    expect(Object.keys(files)).toEqual(['import-report-20261008T163157Z.csv'])
    expect(output).toContain('Résumé : 2 à créer (2 activé(s)) · 0 déjà présent(s) · 0 en erreur.')
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(terminal.close).toHaveBeenCalled()
  })

  it('asks for the credentials on the terminal, the password hidden, and never prints it', async () => {
    const { deps, client, terminal, output, files } = setup({ answers: [' admin@mana.test '] })
    await run(['--file', 'x.csv'], deps)
    expect(terminal.ask).toHaveBeenCalledWith('Courriel : ')
    expect(terminal.askHidden).toHaveBeenCalledWith('Mot de passe : ')
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@mana.test', password: 'mot-de-passe-secret' })
    expect([...output, ...Object.values(files)].join('\n')).not.toContain('mot-de-passe-secret')
  })

  it('refuses a remote URL unless its project reference is typed back, before any sign-in', async () => {
    const { deps, client } = setup({ answers: ['nope'] })
    expect(await run(['--file', 'x.csv', '--url', 'https://abcdefghijklmnopqrst.supabase.co'], deps)).toBe(2)
    expect(deps.createClient).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()

    const confirmed = setup({ answers: ['abcdefghijklmnopqrst', 'admin@example.test'] })
    expect(await run(['--file', 'x.csv', '--url', 'https://abcdefghijklmnopqrst.supabase.co'], confirmed.deps)).toBe(0)
    expect(confirmed.deps.createClient).toHaveBeenCalledWith('https://abcdefghijklmnopqrst.supabase.co', 'anon')
    expect(confirmed.client.rpc.mock.calls.every(([, args]) => args.p_dry_run === true)).toBe(true)
  })

  it('refuses a plain-http remote URL without asking anything', async () => {
    const { deps, terminal } = setup()
    expect(await run(['--file', 'x.csv', '--url', 'http://127.0.0.1:54321'], deps)).toBe(2)
    expect(deps.openTerminal).not.toHaveBeenCalled()
    expect(terminal.ask).not.toHaveBeenCalled()
  })

  it('--commit: dry run first, then « importer » typed, then row by row for real', async () => {
    const { deps, client, output, files } = setup({ answers: ['admin@mana.test', 'importer'] })
    expect(await run(['--file', 'x.csv', '--commit', '--report', 'r.csv'], deps)).toBe(0)
    expect(client.rpc.mock.calls.map(([, args]) => args.p_dry_run)).toEqual([true, true, false, false])
    expect(output).toContain('Résumé : 2 créé(s) (2 activé(s)) · 0 déjà présent(s) · 0 en erreur.')
    expect(files['r.csv']).toContain('2,elodie.gagnon@example.test,import,ok,id-elodie.gagnon@example.test,')
  })

  it('--commit writes nothing when a row has an error, and nothing when the confirmation is not typed', async () => {
    const failing = setup({
      answers: ['admin@mana.test'],
      results: { 'eve.roy@example.test': { status: 'error', dry_run: true, id: null, errors: [{ field: 'motifs', message: 'Motif inconnu : anxite' }] } },
    })
    expect(await run(['--file', 'x.csv', '--commit'], failing.deps)).toBe(1)
    expect(failing.client.rpc.mock.calls.every(([, args]) => args.p_dry_run === true)).toBe(true)
    expect(failing.output).toContain('    motifs : Motif inconnu : anxite')
    expect(failing.output).toContain('Rien n’a été importé : corrigez les erreurs, puis relancez.')

    const cancelled = setup({ answers: ['admin@mana.test', 'oui'] })
    expect(await run(['--file', 'x.csv', '--commit'], cancelled.deps)).toBe(1)
    expect(cancelled.client.rpc.mock.calls.every(([, args]) => args.p_dry_run === true)).toBe(true)
    expect(cancelled.output).toContain('Import annulé : rien n’a été écrit.')
  })

  it('sends no row the CSV refused, and the report keeps no personal data beyond the line and the email', async () => {
    const { deps, client, files } = setup({ answers: ['admin@mana.test'] })
    deps.readFile = () => `${HEADER}\n${ROW.replace(',14,', ',quatorze,')}\n`
    expect(await run(['--file', 'x.csv'], deps)).toBe(1)
    expect(client.rpc).not.toHaveBeenCalled()
    const report = Object.values(files)[0]
    expect(report).toContain('2,elodie.gagnon@example.test,essai,erreur,,annees_experience : Entre 0 et 60 ans.')
    for (const value of ['Élodie', 'Gagnon', '555-0142', 'Montréal', 'H2J', '54321', 'IVAC-1']) expect(report).not.toContain(value)
  })

  it('stops on a database error (permission) and says so', async () => {
    const { deps, client, output } = setup({ answers: ['admin@mana.test'] })
    client.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Permission refusée : professionals.manage' } })
    expect(await run(['--file', 'x.csv'], deps)).toBe(2)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(output).toContain('Erreur de la base (42501) : Permission refusée : professionals.manage')
    expect(client.auth.signOut).toHaveBeenCalled()
  })

  it('stops when the sign-in is refused', async () => {
    const { deps, client, output } = setup({ answers: ['admin@mana.test'] })
    client.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } })
    expect(await run(['--file', 'x.csv'], deps)).toBe(2)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(output).toContain('Connexion refusée : vérifiez le courriel et le mot de passe.')
  })

  it('needs a file and an anon key, and refuses unknown options', async () => {
    const { deps, output } = setup()
    expect(await run([], deps)).toBe(2)
    expect(await run(['--file', 'x.csv', '--password', 'x'], deps)).toBe(2)
    deps.env = {}
    expect(await run(['--file', 'x.csv'], deps)).toBe(2)
    expect(output).toContain('Clé anon manquante : --anon-key <clé> ou VITE_SUPABASE_ANON_KEY.')
    expect(deps.openTerminal).not.toHaveBeenCalled()
  })
})
