// Runs in Node: vitest.config.ts's « scripts » project (P4-130).
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  Aborted,
  InputError,
  LOCAL_URL,
  buildRows,
  checkPublicKey,
  describe as describeRow,
  normalizeHeader,
  openReportFile,
  openTerminal,
  parseCsv,
  parseQuebecNumber,
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

  it('refuses unknown, repeated, blank or missing columns', () => {
    expect(() => readRows('prenom,nom,courriel,motif\n')).toThrow('Colonnes inconnues : motif.')
    expect(() => readRows('prenom,nom,courriel,Nom\n')).toThrow('Colonne en double : nom.')
    expect(() => readRows('prenom,courriel\n')).toThrow('Colonnes obligatoires absentes : nom.')
    expect(() => readRows('prenom,,nom,courriel\n')).toThrow('En-tête vide à la colonne 2.')
    expect(() => readRows('')).toThrow(InputError)
  })

  it('ignores empty trailing header cells and empty trailing cells of a row', () => {
    expect(readRows('prenom,nom,courriel,,\nLéa,Roy,lea@example.test,,\n')).toEqual([
      { line: 2, values: { prenom: 'Léa', nom: 'Roy', courriel: 'lea@example.test' } },
    ])
  })

  it('says a file without a header row needs one, without printing any of its cells', () => {
    for (const text of [`${ROW}\n`, 'Jean,Tremblay,Montréal\n', 'Prenom,Jean,5145550101\n']) {
      let message = ''
      try {
        readRows(text)
      } catch (error) {
        message = error.message
      }
      expect(message).toMatch(/^La première ligne doit contenir les en-têtes/)
      for (const cell of ['Élodie', 'elodie', 'Jean', 'Tremblay', 'Montréal', '5145550101']) expect(message).not.toContain(cell)
    }
  })

  it('accepts the two optional compensation columns, however their headers are written', () => {
    expect(normalizeHeader('Séances cumulées')).toBe('seances_cumulees')
    expect(readRows('Prénom,Nom,Courriel,Retenue,Séances cumulées\nLéa,Roy,lea@example.test,"27,5 %","237,5"\n')).toEqual([
      { line: 2, values: { prenom: 'Léa', nom: 'Roy', courriel: 'lea@example.test', retenue: '27,5 %', seances_cumulees: '237,5' } },
    ])
  })

  it('keeps a row wider than the header without reading its cells', () => {
    expect(readRows('prenom,nom,courriel\na,b,c,d\n')).toEqual([{ line: 2, values: null }])
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

  it('reads the retention and the cumulative sessions typed the Québec way', () => {
    expect(rowToPayload(values({ retenue: '27,5 %', seances_cumulees: '237,5' }))).toMatchObject({
      errors: [],
      payload: { retention_pct: 27.5, cumulative_sessions: 237.5 },
    })
    for (const [retenue, seances, pct, count] of [
      ['27.5', '237.5', 27.5, 237.5],
      ['27,5%', '237', 27.5, 237],
      [' 30 \u00a0% ', '1\u202f237,5', 30, 1237.5],
      ['0', '0', 0, 0],
      ['27,125', '1 500', 27.125, 1500], // shape only: the bounds and the decimals are the database's
      ['-5 %', '-1', -5, -1],
    ]) {
      const { payload, errors } = rowToPayload(values({ retenue, seances_cumulees: seances }))
      expect(errors, retenue).toEqual([])
      expect([payload.retention_pct, payload.cumulative_sessions], retenue).toEqual([pct, count])
    }
  })

  it('leaves the two keys out when their cells are blank, as every other empty cell', () => {
    const { payload, errors } = rowToPayload(values({ retenue: '', seances_cumulees: '' }))
    expect(errors).toEqual([])
    expect(payload).not.toHaveProperty('retention_pct')
    expect(payload).not.toHaveProperty('cumulative_sessions')
  })

  it('refuses a number the CSV cannot read, on its column, without repeating the cell', () => {
    const retenue = 'Indiquez un pourcentage, par exemple 27,5 ou 27,5 %.'
    const seances = 'Indiquez un nombre de séances, par exemple 237 ou 237,5.'
    for (const cell of ['abc', '1.237,5', '27,5,0', '27..5', '%', '27 % %', '1e3', '12 34', ',5', '5,', '--5', 'trente-deux']) {
      const { payload, errors } = rowToPayload(values({ retenue: cell, seances_cumulees: cell }))
      expect(errors, cell).toEqual([
        { field: 'retentionPct', message: retenue },
        { field: 'cumulativeSessions', message: seances },
      ])
      expect(payload, cell).not.toHaveProperty('retention_pct')
      expect(payload, cell).not.toHaveProperty('cumulative_sessions')
    }
    expect(describeRow({ line: 2, email: '', payload: {}, errors: rowToPayload(values({ retenue: 'trente-deux' })).errors }, null).details).toEqual([
      `retenue : ${retenue}`,
    ])
    // The percent sign belongs to the retention only.
    expect(rowToPayload(values({ seances_cumulees: '237 %' })).errors).toEqual([{ field: 'cumulativeSessions', message: seances }])
  })

  it('never sends a number too long to be one (JSON would turn it into null)', () => {
    expect(parseQuebecNumber('9'.repeat(400))).toBeNull()
    expect(parseQuebecNumber('237,5')).toBe(237.5)
  })

  it('maps a file without the two columns exactly as before', () => {
    const [row] = buildRows(`${HEADER}\n${ROW}\n`)
    expect(row.errors).toEqual([])
    expect(Object.keys(row.payload)).toEqual([
      'first_name', 'last_name', 'email', 'personal_phone', 'city', 'province', 'postal_code', 'ivac',
      'years_experience', 'professions', 'languages', 'motifs', 'clienteles', 'approaches', 'activate',
    ])
    expect(describeRow(row, { status: 'ok', activated: true, complete: true, missing: [] }).details).toEqual([
      '1 titre, 2 langues, 2 clientèles, 2 approches, 2 motifs · activé',
    ])
  })

  it('flags an email repeated in the file from its second line on', () => {
    const rows = buildRows(`${HEADER}\n${ROW}\n${ROW.replace('Élodie', 'Élo').replace('elodie.gagnon', 'ELODIE.GAGNON').replace('IVAC-1', 'IVAC-2')}\n`)
    expect(rows[0].errors).toEqual([])
    expect(rows[1].errors).toEqual([{ field: 'email', message: 'Courriel déjà présent à la ligne 2 du fichier.' }])
  })

  it('flags an IVAC number repeated in the file (trimmed, case ignored) from its second line on', () => {
    const other = (n, ivac) => ROW.replace('elodie.gagnon', `autre${n}`).replace('IVAC-1', ivac)
    const rows = buildRows(`${HEADER}\n${ROW}\n${other(1, '"  ivac-1 "')}\n${other(2, 'IVAC-9')}\n${other(3, '')}\n${other(4, '')}\n`)
    expect(rows.map((r) => r.errors)).toEqual([[], [{ field: 'ivac', message: 'Numéro IVAC déjà présent à la ligne 2 du fichier.' }], [], [], []])
  })

  it('reports a row wider than the header without a payload or an email', () => {
    const [row] = buildRows('prenom,nom,courriel\nJean,Tremblay,jean@example.test,5145550101\n')
    expect(row).toEqual({
      line: 2,
      email: '',
      payload: null,
      errors: [{ field: null, message: 'Plus de cellules que de colonnes (un séparateur de trop ?) : la ligne n’est ni lue ni envoyée à la base.' }],
    })
  })

  it('reads the sample file without an error', () => {
    const rows = buildRows(readFileSync(new URL('./fixtures/professionals-sample.csv', import.meta.url), 'utf8'))
    expect(rows).toHaveLength(6)
    expect(rows.flatMap((r) => r.errors)).toEqual([])
    expect(rows.every((r) => r.email.endsWith('@example.test'))).toBe(true)
    expect(rows.map((r) => [r.payload.retention_pct, r.payload.cumulative_sessions])).toEqual([
      [25, 1237.5],
      [30, 642],
      [32.5, 318.5],
      [25, 1500],
      [undefined, undefined],
      [27.5, 893],
    ])
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

  it('refuses this computer under any other name, port or scheme', () => {
    for (const url of [
      'https://127.0.0.1:55321',
      'https://localhost:55321',
      'https://localhost',
      'https://127.0.0.1:54321',
      'https://127.1.2.3',
      'https://[::1]:55321',
      'https://[::ffff:127.0.0.1]',
      'https://api.localhost',
      'https://localhost.:55321',
      'https://0.0.0.0',
      'http://localhost:54321',
    ]) {
      expect(() => resolveTarget(url), url).toThrow('Adresse refusée')
    }
  })

  it('refuses plain http outside the local stack (PS Hub’s 54321 included), paths and credentials', () => {
    expect(() => resolveTarget('http://127.0.0.1:54321')).toThrow('Adresse refusée')
    expect(() => resolveTarget('http://abcdefghijklmnopqrst.supabase.co')).toThrow('Adresse refusée')
    expect(() => resolveTarget('https://abcdefghijklmnopqrst.supabase.co/rest/v1')).toThrow('L’adresse doit être celle du projet seulement')
    expect(() => resolveTarget('https://user:pw@abcdefghijklmnopqrst.supabase.co')).toThrow(InputError)
    expect(() => resolveTarget('pas une adresse')).toThrow('Adresse invalide')
  })
})

describe('checkPublicKey', () => {
  const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJl`

  it('accepts the public keys (anon JWT, sb_publishable_…)', () => {
    expect(() => checkPublicKey(jwt({ role: 'anon' }))).not.toThrow()
    expect(() => checkPublicKey('sb_publishable_abc123')).not.toThrow()
    expect(() => checkPublicKey('test-anon-key')).not.toThrow()
  })

  it('refuses a secret key without echoing it', () => {
    for (const key of [jwt({ iss: 'supabase', role: 'service_role' }), 'sb_secret_Zx9verysecret']) {
      let message = ''
      try {
        checkPublicKey(key)
      } catch (error) {
        message = error.message
      }
      expect(message).toMatch(/^Cette clé est une clé secrète \(service_role\)/)
      expect(message).not.toContain(key.slice(-12))
    }
  })
})

describe('describe (one row’s report entry)', () => {
  it('lists the CSV’s and the database’s errors together, column by column', () => {
    const row = {
      line: 3,
      email: 'a@example.test',
      payload: {},
      errors: [
        { field: 'activate', message: 'Indiquez oui ou non.' },
        { field: 'yearsExperience', message: 'Entre 0 et 60 ans.' },
      ],
    }
    const result = {
      status: 'error',
      errors: [
        { field: 'motifs', message: 'Motif inconnu : anxite' },
        { field: 'personalPhone', message: 'Numéro à 10 chiffres.' },
        { field: null, message: 'Contrôle refusé.' },
      ],
    }
    expect(describeRow(row, result).details).toEqual([
      'ligne : Contrôle refusé.',
      'telephone : Numéro à 10 chiffres.',
      'annees_experience : Entre 0 et 60 ans.',
      'motifs : Motif inconnu : anxite',
      'activer : Indiquez oui ou non.',
    ])
  })

  it('names the database’s retention and session errors by their columns', () => {
    const row = { line: 4, email: 'a@example.test', payload: {}, errors: [] }
    const result = {
      status: 'error',
      errors: [
        { field: 'cumulativeSessions', message: 'Le nombre de séances cumulées est compris entre 0 et 100 000, par demi-séance.' },
        { field: 'retentionPct', message: 'Le taux de retenue est un pourcentage entre 0 et 100, à deux décimales au plus.' },
        { field: 'activate', message: 'Indiquez oui ou non.' },
      ],
    }
    expect(describeRow(row, result).details).toEqual([
      'activer : Indiquez oui ou non.',
      'retenue : Le taux de retenue est un pourcentage entre 0 et 100, à deux décimales au plus.',
      'seances_cumulees : Le nombre de séances cumulées est compris entre 0 et 100 000, par demi-séance.',
    ])
  })

  it('says a row carries a retention and cumulative sessions, never their values', () => {
    const row = { line: 2, email: 'a@example.test', payload: { professions: [{}], retention_pct: 27.5, cumulative_sessions: 237.5 }, errors: [] }
    const { details } = describeRow(row, { status: 'ok', activated: false, complete: false, missing: [] })
    expect(details).toEqual(['1 titre, retenue, séances cumulées · non activé (« À inviter »)'])
    expect(details.join('')).not.toMatch(/27|237/)
  })
})

describe('reportCsv', () => {
  it('holds the line, the email, the mode, the status, the id and the messages, quoted when needed', () => {
    const csv = reportCsv(
      [
        { line: 2, email: 'a@example.test', status: 'ok', id: 'id-1', details: ['1 titre · activé'] },
        { line: 3, email: 'b@example.test', status: 'error', id: null, details: ['motifs : Motif inconnu : anxite', 'telephone : Numéro à 10 chiffres.'] },
        { line: 4, email: '=cmd', status: 'skipped', id: 'id-2', details: ['Courriel déjà présent, "x"'] },
        { line: 5, email: '\t=cmd', status: 'skipped', id: null, details: ['\r=cmd'] },
      ],
      'essai',
    )
    expect(csv).toBe(
      'ligne,courriel,mode,statut,id,details\r\n' +
        '2,a@example.test,essai,ok,id-1,1 titre · activé\r\n' +
        '3,b@example.test,essai,erreur,,motifs : Motif inconnu : anxite | telephone : Numéro à 10 chiffres.\r\n' +
        `4,'=cmd,essai,ignoré,id-2,"Courriel déjà présent, ""x"""\r\n` +
        `5,'\t=cmd,essai,ignoré,,"'\r=cmd"\r\n`,
    )
  })

  it('names the report after the UTC time', () => {
    expect(reportName(new Date('2026-10-08T16:31:57.123Z'))).toBe('import-report-20261008T163157Z.csv')
  })

  it('claims the report file with wx and mode 600, flushes every write, and removes it when it holds no row', () => {
    const fs = fakeFs()
    const report = openReportFile('r.csv', fs)
    expect(fs.calls[0]).toEqual(['open', 'r.csv', 'wx', 0o600])
    report.write('a\r\n')
    expect(fs.calls.slice(1)).toEqual([['write', 'a\r\n'], ['fsync']])
    report.close(false)
    expect(fs.files['r.csv']).toBe('a\r\n')
    openReportFile('vide.csv', fs).close(true)
    expect('vide.csv' in fs.files).toBe(false)
  })

  it('never replaces an existing report', () => {
    const fs = fakeFs({ 'r.csv': 'ancien' })
    expect(() => openReportFile('r.csv', fs)).toThrow('Le rapport r.csv existe déjà : il n’est pas remplacé.')
    expect(fs.files['r.csv']).toBe('ancien')
  })
})

// --- Fakes ---------------------------------------------------------------------------------------

/** node:fs as openReportFile uses it, over an in-memory map (no file is ever touched). */
function fakeFs(files = {}) {
  const calls = []
  const open = new Map()
  let next = 10
  return {
    files,
    calls,
    openSync: (path, flags, mode) => {
      calls.push(['open', path, flags, mode])
      if (path in files) throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
      files[path] = ''
      open.set(next, path)
      return next++
    },
    writeSync: (fd, text) => {
      calls.push(['write', text])
      files[open.get(fd)] += text
    },
    fsyncSync: () => calls.push(['fsync']),
    closeSync: (fd) => {
      calls.push(['close'])
      open.delete(fd)
    },
    unlinkSync: (path) => {
      calls.push(['unlink', path])
      delete files[path]
    },
  }
}

/** A terminal's two streams: what openTerminal does to them is logged in order. */
function fakeTty() {
  const log = []
  const input = new EventEmitter()
  Object.assign(input, {
    setRawMode: (on) => log.push(['raw', on]),
    setEncoding: () => {},
    resume: () => {},
    destroy: () => log.push(['destroy']),
  })
  const output = { write: (text) => log.push(['write', text]), destroy: () => {} }
  const written = () =>
    log
      .filter(([kind]) => kind === 'write')
      .map(([, text]) => text)
      .join('')
  const type = (text) => input.emit('data', text)
  return { input, output, log, written, type }
}

describe('openTerminal', () => {
  it('sets raw mode before the first prompt is written and keeps it until close', async () => {
    const tty = fakeTty()
    const terminal = openTerminal({ input: tty.input, output: tty.output })
    const email = terminal.ask('Courriel : ')
    expect(tty.log.slice(0, 2)).toEqual([
      ['raw', true],
      ['write', 'Courriel : '],
    ])
    tty.type('admin@mana.test\r')
    expect(await email).toBe('admin@mana.test')
    const password = terminal.askHidden('Mot de passe : ')
    tty.type('s3cret\r')
    expect(await password).toBe('s3cret')
    expect(tty.log.filter(([kind]) => kind === 'raw')).toEqual([['raw', true]])
    terminal.close()
    expect(tty.log.filter(([kind]) => kind === 'raw')).toEqual([
      ['raw', true],
      ['raw', false],
    ])
  })

  it('never shows what is typed at a hidden prompt, nor what is typed between prompts', async () => {
    const tty = fakeTty()
    const terminal = openTerminal({ input: tty.input, output: tty.output })
    tty.type('avance') // typed before any question: dropped
    const password = terminal.askHidden('Mot de passe : ')
    tty.type('mot-de')
    tty.type('-passe\u007fe-secret\r')
    expect(await password).toBe('mot-de-passe-secret')
    tty.type('apres')
    expect(tty.written()).toBe('Mot de passe : \n')
    terminal.close()
  })

  it('ignores escape sequences (arrow keys, function keys) and control characters', async () => {
    const tty = fakeTty()
    const terminal = openTerminal({ input: tty.input, output: tty.output })
    const answer = terminal.ask('Q : ')
    tty.type('im\u001b[Apor\u001bOBt\u001b[1;5C\u0007er\u001b')
    tty.type('\r')
    expect(await answer).toBe('importer')
    expect(tty.written()).toBe('Q : importer\n')
    terminal.close()
  })

  it('Ctrl-C or Ctrl-D at a prompt aborts it; Ctrl-C between prompts asks the run to stop', async () => {
    const tty = fakeTty()
    const onInterrupt = vi.fn()
    const terminal = openTerminal({ input: tty.input, output: tty.output, onInterrupt })
    const first = terminal.askHidden('Mot de passe : ')
    tty.type('abc\u0003')
    await expect(first).rejects.toBeInstanceOf(Aborted)
    const second = terminal.ask('Courriel : ')
    tty.type('\u0004')
    await expect(second).rejects.toBeInstanceOf(Aborted)
    expect(onInterrupt).not.toHaveBeenCalled()
    tty.type('\u0003')
    expect(onInterrupt).toHaveBeenCalledTimes(1)
    expect(tty.written()).not.toContain('abc')
    terminal.close()
  })
})

// --- run(): the flow, with a fake terminal, a fake client and an in-memory report ----------------

const okResult = (dryRun, id) => ({ status: 'ok', dry_run: dryRun, id: dryRun ? null : id, activated: true, complete: true, missing: [] })

function setup({ answers = [], results = {} } = {}) {
  const output = []
  const fs = fakeFs()
  const files = fs.files
  const signals = { handler: null }
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
    rpc: vi.fn(async (_name, { p_row, p_dry_run }) => ({ data: results[p_row.email] ?? okResult(p_dry_run, `id-${p_row.email}`), error: null })),
  }
  const deps = {
    env: { VITE_SUPABASE_ANON_KEY: 'anon' },
    out: (line) => output.push(line),
    readFile: () => `${HEADER}\n${ROW}\n${ROW.replace('elodie.gagnon', 'eve.roy').replace('Gagnon', 'Roy').replace('IVAC-1', 'IVAC-2')}\n`,
    openReport: vi.fn((path) => openReportFile(path, fs)),
    onSignals: vi.fn((handler) => {
      signals.handler = handler
      return () => {
        signals.handler = null
      }
    }),
    now: () => new Date('2026-10-08T16:31:57Z'),
    openTerminal: vi.fn(() => terminal),
    createClient: vi.fn(() => client),
  }
  return { deps, client, terminal, output, files, fs, signals }
}

describe('run', () => {
  it('is a dry run by default: every row with p_dry_run true, nothing for real, a report', async () => {
    const { deps, client, terminal, output, files, fs } = setup({ answers: ['admin@mana.test'] })
    expect(await run(['--file', 'x.csv'], deps)).toBe(0)
    expect(deps.createClient).toHaveBeenCalledWith(LOCAL_URL, 'anon')
    expect(client.rpc).toHaveBeenCalledTimes(2)
    expect(client.rpc.mock.calls.every(([name, args]) => name === 'import_professional' && args.p_dry_run === true)).toBe(true)
    expect(Object.keys(files)).toEqual(['import-report-20261008T163157Z.csv'])
    expect(fs.calls[0]).toEqual(['open', 'import-report-20261008T163157Z.csv', 'wx', 0o600])
    expect(output).toContain('Résumé : 2 à créer (2 activé(s)) · 0 déjà présent(s) · 0 en erreur.')
    expect(output).toContain('Rapport : import-report-20261008T163157Z.csv')
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(terminal.close).toHaveBeenCalled()
    expect(deps.onSignals).toHaveBeenCalled()
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
    const { deps, client, files } = setup({ answers: ['nope'] })
    expect(await run(['--file', 'x.csv', '--url', 'https://abcdefghijklmnopqrst.supabase.co'], deps)).toBe(2)
    expect(deps.createClient).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
    expect(files).toEqual({}) // a report without a row is removed

    const confirmed = setup({ answers: ['abcdefghijklmnopqrst', 'admin@example.test'] })
    expect(await run(['--file', 'x.csv', '--url', 'https://abcdefghijklmnopqrst.supabase.co'], confirmed.deps)).toBe(0)
    expect(confirmed.deps.createClient).toHaveBeenCalledWith('https://abcdefghijklmnopqrst.supabase.co', 'anon')
    expect(confirmed.client.rpc.mock.calls.every(([, args]) => args.p_dry_run === true)).toBe(true)
  })

  it('refuses a plain-http remote URL and a secret key without asking anything', async () => {
    const { deps, terminal, output } = setup()
    expect(await run(['--file', 'x.csv', '--url', 'http://127.0.0.1:54321'], deps)).toBe(2)
    expect(await run(['--file', 'x.csv', '--anon-key', 'sb_secret_abcdef'], deps)).toBe(2)
    expect(output.at(-1)).toMatch(/^Cette clé est une clé secrète/)
    expect(output.join('\n')).not.toContain('sb_secret_abcdef')
    expect(deps.openReport).not.toHaveBeenCalled()
    expect(deps.openTerminal).not.toHaveBeenCalled()
    expect(terminal.ask).not.toHaveBeenCalled()
  })

  it('stops before any question or call when the report path already exists', async () => {
    const { deps, client, output, files } = setup()
    files['r.csv'] = 'ancien rapport'
    expect(await run(['--file', 'x.csv', '--commit', '--report', 'r.csv'], deps)).toBe(2)
    expect(output).toContain('Le rapport r.csv existe déjà : il n’est pas remplacé. Choisissez un autre --report.')
    expect(deps.openTerminal).not.toHaveBeenCalled()
    expect(deps.createClient).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
    expect(files['r.csv']).toBe('ancien rapport')
  })

  it('--commit: dry run first, « importer » typed, then row by row for real; each line written and flushed as it completes', async () => {
    const { deps, client, output, files, fs } = setup({ answers: ['admin@mana.test', 'importer'] })
    const linesBeforeCall = []
    client.rpc.mockImplementation(async (_name, { p_row, p_dry_run }) => {
      linesBeforeCall.push(files['r.csv'].split('\r\n').length - 2)
      return { data: okResult(p_dry_run, `id-${p_row.email}`), error: null }
    })
    expect(await run(['--file', 'x.csv', '--commit', '--report', 'r.csv'], deps)).toBe(0)
    expect(client.rpc.mock.calls.map(([, args]) => args.p_dry_run)).toEqual([true, true, false, false])
    expect(linesBeforeCall).toEqual([0, 1, 2, 3])
    expect(fs.calls.filter(([kind]) => kind === 'fsync')).toHaveLength(5) // the header and 4 lines
    expect(output).toContain('Résumé : 2 créé(s) (2 activé(s)) · 0 déjà présent(s) · 0 en erreur.')
    expect(files['r.csv']).toContain('2,elodie.gagnon@example.test,essai,ok,,')
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

  it('sends a row with CSV errors to the dry run anyway and lists both sides’ errors; the report keeps no other personal data', async () => {
    const { deps, client, files } = setup({
      answers: ['admin@mana.test'],
      results: { 'elodie.gagnon@example.test': { status: 'error', dry_run: true, id: null, errors: [{ field: 'motifs', message: 'Motif inconnu : anxite' }] } },
    })
    deps.readFile = () => `${HEADER}\n${ROW.replace(',14,', ',quatorze,')}\n`
    expect(await run(['--file', 'x.csv'], deps)).toBe(1)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    const [, args] = client.rpc.mock.calls[0]
    expect(args.p_dry_run).toBe(true)
    expect(args.p_row).not.toHaveProperty('years_experience')
    const report = Object.values(files)[0]
    expect(report).toContain('2,elodie.gagnon@example.test,essai,erreur,,annees_experience : Entre 0 et 60 ans. | motifs : Motif inconnu : anxite')
    for (const value of ['Élodie', 'Gagnon', '555-0142', 'Montréal', 'H2J', '54321', 'IVAC-1']) expect(report).not.toContain(value)
  })

  it('sends the retention and the cumulative sessions as JSON numbers; the terminal and the report hold neither', async () => {
    const { deps, client, output, files } = setup({ answers: ['admin@mana.test'] })
    deps.readFile = () => `${HEADER},retenue,seances_cumulees\n${ROW},"27,5 %","1 237,5"\n`
    expect(await run(['--file', 'x.csv'], deps)).toBe(0)
    const [, args] = client.rpc.mock.calls[0]
    expect(args.p_row).toMatchObject({ retention_pct: 27.5, cumulative_sessions: 1237.5 })
    expect(JSON.stringify(args.p_row)).toContain('"retention_pct":27.5,"cumulative_sessions":1237.5')
    const printed = [...output, ...Object.values(files)].join('\n')
    expect(printed).toContain('retenue, séances cumulées')
    for (const value of ['27,5', '27.5', '1 237', '1237']) expect(printed).not.toContain(value)
  })

  it('says why a row too broken to read is not sent', async () => {
    const { deps, client, output, files } = setup({ answers: ['admin@mana.test'] })
    deps.readFile = () => 'prenom,nom,courriel\nJean,Tremblay,jean@example.test,5145550101\nLéa,Roy,lea@example.test\n'
    expect(await run(['--file', 'x.csv'], deps)).toBe(1)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(output).toContain('Ligne 2 · (sans courriel) · erreur')
    const report = Object.values(files)[0]
    expect(report).toContain('2,,essai,erreur,,ligne : Plus de cellules que de colonnes (un séparateur de trop ?) : la ligne n’est ni lue ni envoyée à la base.')
    for (const value of ['Jean', 'Tremblay', 'jean@', '5145550101']) expect(report).not.toContain(value)
  })

  it('stops on a database error (permission) and says so', async () => {
    const { deps, client, output } = setup({ answers: ['admin@mana.test'] })
    client.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Permission refusée : professionals.manage' } })
    expect(await run(['--file', 'x.csv'], deps)).toBe(2)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(output).toContain('Erreur de la base (42501) : Permission refusée : professionals.manage')
    expect(client.auth.signOut).toHaveBeenCalled()
  })

  it('--commit: a database error partway keeps the rows done in the report, counts them and says how to resume', async () => {
    const { deps, client, output, files, fs } = setup({ answers: ['admin@mana.test', 'importer'] })
    client.rpc
      .mockResolvedValueOnce({ data: okResult(true), error: null })
      .mockResolvedValueOnce({ data: okResult(true), error: null })
      .mockResolvedValueOnce({ data: okResult(false, 'id-1'), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'fetch failed' } })
    expect(await run(['--file', 'x.csv', '--commit', '--report', 'r.csv'], deps)).toBe(2)
    expect(files['r.csv'].trimEnd().split('\r\n')).toHaveLength(4) // the header, 2 dry-run lines, 1 imported
    expect(files['r.csv']).toContain('2,elodie.gagnon@example.test,import,ok,id-1,')
    expect(files['r.csv']).not.toContain('eve.roy@example.test,import')
    expect(output).toContain('Résumé : 1 créé(s) (1 activé(s)) · 0 déjà présent(s) · 0 en erreur.')
    expect(output.some((l) => l.startsWith('Import arrêté après 1 ligne(s) sur 2.') && l.includes('« ignoré »'))).toBe(true)
    expect(output).toContain('Erreur de la base (réseau) : fetch failed')
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(fs.calls.at(-1)).toEqual(['close'])
  })

  it('--commit: a row refused during the import is reported and the exit code is 1', async () => {
    const { deps, client, output, files } = setup({ answers: ['admin@mana.test', 'importer'] })
    client.rpc.mockImplementation(async (_name, { p_row, p_dry_run }) => ({
      data:
        !p_dry_run && p_row.email === 'eve.roy@example.test'
          ? { status: 'error', dry_run: false, id: null, errors: [{ field: 'ivac', message: 'Ce numéro IVAC est déjà attribué à un autre professionnel.' }] }
          : { ...okResult(p_dry_run, 'id-1'), activated: false },
      error: null,
    }))
    expect(await run(['--file', 'x.csv', '--commit', '--report', 'r.csv'], deps)).toBe(1)
    expect(output).toContain('Résumé : 1 créé(s) · 0 déjà présent(s) · 1 en erreur.')
    expect(files['r.csv']).toContain('3,eve.roy@example.test,import,erreur,,ivac : Ce numéro IVAC est déjà attribué à un autre professionnel.')
  })

  it('a signal during the import stops between two rows: the row under way finishes, sign-out, report closed', async () => {
    const { deps, client, output, files, signals, fs } = setup({ answers: ['admin@mana.test', 'importer'] })
    client.rpc.mockImplementation(async (_name, { p_row, p_dry_run }) => {
      if (!p_dry_run) signals.handler() // SIGINT / SIGTERM while the first real row is under way
      return { data: okResult(p_dry_run, `id-${p_row.email}`), error: null }
    })
    expect(await run(['--file', 'x.csv', '--commit', '--report', 'r.csv'], deps)).toBe(2)
    expect(client.rpc.mock.calls.map(([, args]) => args.p_dry_run)).toEqual([true, true, false])
    expect(output).toContain('Arrêt demandé : la ligne en cours se termine, puis l’import s’arrête.')
    expect(output.some((l) => l.startsWith('Import arrêté après 1 ligne(s) sur 2.'))).toBe(true)
    expect(files['r.csv']).toContain('2,elodie.gagnon@example.test,import,ok,id-elodie.gagnon@example.test,')
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(fs.calls.at(-1)).toEqual(['close'])
    expect(signals.handler).toBeNull() // the handlers are removed
  })

  it('Ctrl-C between prompts during the dry run ends it there, before the confirmation', async () => {
    const { deps, client, output, terminal } = setup({ answers: ['admin@mana.test', 'importer'] })
    client.rpc.mockImplementationOnce(async () => {
      deps.openTerminal.mock.calls[0][0].onInterrupt()
      return { data: okResult(true), error: null }
    })
    expect(await run(['--file', 'x.csv', '--commit'], deps)).toBe(2)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(terminal.ask).toHaveBeenCalledTimes(1) // the email only: no confirmation asked
    expect(output).toContain('Essai interrompu après 1 ligne(s) sur 2 : rien n’a été écrit.')
  })

  it('Ctrl-C at a prompt (the real terminal code): Aborted, exit 1, signed out, raw mode put back, nothing typed shown', async () => {
    const { deps, client, output, files } = setup()
    const tty = fakeTty()
    tty.output.write = (text) => {
      tty.log.push(['write', text])
      if (text === 'Courriel : ') queueMicrotask(() => tty.type('admin@mana.test\r'))
      if (text === 'Mot de passe : ') queueMicrotask(() => tty.type('ManaLocal\u0003'))
    }
    deps.openTerminal = vi.fn((options) => openTerminal({ ...options, input: tty.input, output: tty.output }))
    expect(await run(['--file', 'x.csv'], deps)).toBe(1)
    expect(output).toContain('Interrompu.')
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(client.rpc).not.toHaveBeenCalled()
    expect(tty.log.filter(([kind]) => kind === 'raw')).toEqual([
      ['raw', true],
      ['raw', false],
    ])
    expect(tty.written()).not.toContain('ManaLocal')
    expect(files).toEqual({})
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
