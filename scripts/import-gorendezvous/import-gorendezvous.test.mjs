// Runs in Node: vitest.config.ts's « scripts » project. Fixtures are synthetic (invented names,
// 555 numbers, exemple.test addresses): never real client data.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readClients } from './clients.mjs'
import { buildReport, checkOutsideRepo, run } from './dry-run.mjs'
import { findDuplicates, similarity } from './duplicates.mjs'
import { readCancellations, readWaitlist } from './lists.mjs'
import {
  foldText,
  normalizeEmail,
  normalizeName,
  normalizePostalCode,
  normalizeProvince,
  normalizeSex,
  parseDateOnly,
  parseMoneyCents,
  toE164,
} from './normalize.mjs'
import { mapPaymentMethod, readInvoiceLines, readInvoices, readPayments } from './revenue.mjs'
import { mapTags, splitTags } from './tags.mjs'
import { InputError, decodeUtf8, readTable } from './table.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8')
const TODAY = '2026-10-12'

describe('normalisers', () => {
  it('names: trimmed and collapsed; all caps or all lower case get capitals; mixed case kept', () => {
    expect(normalizeName('  MARIE-ÈVE   D’AMOURS ')).toBe('Marie-Ève D’Amours')
    expect(normalizeName('tremblay')).toBe('Tremblay')
    expect(normalizeName('McDonald')).toBe('McDonald')
    expect(normalizeName('de la Fontaine')).toBe('de la Fontaine')
    expect(normalizeName('   ')).toBeNull()
  })

  it('emails: lower case, refused when not an address', () => {
    expect(normalizeEmail(' Camille.Fictive@Exemple.TEST ')).toBe('camille.fictive@exemple.test')
    for (const bad of ['', 'pas-un-courriel', 'a@b', 'a b@c.d']) expect(normalizeEmail(bad)).toBeNull()
  })

  it('phones: E.164 from the number and its separate country code column', () => {
    expect(toE164('514 555-0101', '1')).toBe('+15145550101')
    expect(toE164('(514) 555-0101', '+1')).toBe('+15145550101')
    expect(toE164('1-514-555-0101', '')).toBe('+15145550101')
    expect(toE164('+33 1 23 45 67 89')).toBe('+33123456789')
    expect(toE164('01 23 45 67 89', '33')).toBe('+33123456789')
    for (const bad of ['555-1234', '0145550101', '', 'aucun']) expect(toE164(bad, '1')).toBeNull()
  })

  it('dates: calendar days only, never through a time zone; Excel serials; ambiguous forms refused', () => {
    expect(parseDateOnly('1990-04-12')).toBe('1990-04-12')
    expect(parseDateOnly('1990/4/2')).toBe('1990-04-02')
    expect(parseDateOnly('2026-09-30 00:00:00')).toBe('2026-09-30')
    expect(parseDateOnly('2020-01-01T00:00:00Z')).toBe('2020-01-01')
    expect(parseDateOnly('44259')).toBe('2021-03-04')
    for (const bad of ['13/10/2026', '04/03/2021', '2021-02-30', '1850-01-01', 'hier', '']) expect(parseDateOnly(bad)).toBeNull()
  })

  it('money: cents from French and English cells, integer arithmetic', () => {
    expect(parseMoneyCents('1 234,56 $')).toBe(123456)
    expect(parseMoneyCents('1\u00a0234,56\u00a0$')).toBe(123456)
    expect(parseMoneyCents('$1,234.56')).toBe(123456)
    expect(parseMoneyCents('43,49')).toBe(4349)
    expect(parseMoneyCents('21,7')).toBe(2170)
    expect(parseMoneyCents('175')).toBe(17500)
    expect(parseMoneyCents('-21,74')).toBe(-2174)
    expect(parseMoneyCents('(21,74 $)')).toBe(-2174)
    expect(parseMoneyCents('1.234,56')).toBe(123456)
    expect(parseMoneyCents('0,1')).toBe(10)
    for (const bad of ['', 'deux cents', '12.3.4', '1,2,3']) expect(parseMoneyCents(bad)).toBeNull()
  })

  it('sex, province, postal code', () => {
    expect([normalizeSex('F'), normalizeSex('Homme'), normalizeSex('Autre'), normalizeSex('Z')]).toEqual(['female', 'male', 'other', null])
    expect([normalizeProvince('Québec'), normalizeProvince('qc'), normalizeProvince('Narnia')]).toEqual(['QC', 'QC', null])
    expect(normalizePostalCode('h2x1a1')).toBe('H2X 1A1')
    expect(foldText(' Élise  ÉTÉ ')).toBe('elise ete')
  })
})

describe('readTable', () => {
  it('finds the header under an Excel title and matches headers by any case, accent or spacing', () => {
    const { rows, fields, unused } = readTable('Rapport\n\n Prénom ;NOM;Autre\nA;B;C\n;;\n', {
      columns: { first: ['Prenom'], last: ['Nom'] },
      required: ['first', 'last'],
    })
    expect(fields).toEqual(['first', 'last'])
    expect(unused).toEqual(['Autre'])
    expect(rows).toHaveLength(1)
    expect([rows[0].line, rows[0].get('first'), rows[0].get('last')]).toEqual([4, 'A', 'B'])
  })

  it('a « ; » file whose money cells hold commas, under a title line without either', () => {
    const csv = 'Revenus\nDate;Montant;TPS;TVQ;Total\n2026-09-01;1 234,56;1,00;2,00;1 237,56\n'
    const { rows } = readTable(csv, { columns: { date: [], amount: ['Montant'], total: [] }, required: ['date', 'amount', 'total'] })
    expect(rows[0].get('amount')).toBe('1 234,56')
  })

  it('refuses a file without the required columns, naming them', () => {
    expect(() => readTable('a,b\n1,2\n', { columns: { id: ['ClientId'] }, required: ['id'] })).toThrow(/ClientId/)
  })

  it('UTF-8 only: a Windows-1252 save is refused with what to do', () => {
    expect(decodeUtf8(new TextEncoder().encode('Prénom'))).toBe('Prénom')
    expect(() => decodeUtf8(Uint8Array.from([0x50, 0x72, 0xe9, 0x6e]))).toThrow(InputError)
  })
})

describe('tags', () => {
  it('useful tags become fields or payers; satisfaction and obsolete ones are dropped; the rest stay free', () => {
    const result = mapTags(splitTags('IVAC, Tarif étudiant, Satisfaite, ivac ; Statut Indien | Atelier'))
    expect(result.fields).toEqual({ rate_variant: 'student', tax_exempt_status: true })
    expect(result.payers).toEqual(['ivac'])
    expect(result.dropped).toEqual(['Satisfaite'])
    expect(result.freeTags).toEqual(['Atelier'])
    expect(result.issues).toEqual([])
  })

  it('both rates: neither set, flagged; more than 5 free tags: the first 5; an unknown tag kept free and listed', () => {
    expect(mapTags(['Tarif étudiant', 'Tarif réduit'])).toMatchObject({ fields: {}, issues: ['rate_conflict'] })
    const many = mapTags(['Atelier', 'Couple', 'Famille', 'Offert', 'Payeur', 'Fin de suivi'])
    expect(many.freeTags).toHaveLength(5)
    expect(many.issues).toEqual(['free_tags_over_limit'])
    expect(mapTags(['Étiquette maison'])).toMatchObject({ unknown: ['Étiquette maison'], freeTags: ['Étiquette maison'] })
  })
})

describe('readClients', () => {
  const result = readClients(fixture('clients.csv'), { today: TODAY })
  const byRef = (id) => result.clients.find((c) => c.externalRef === `gorendezvous:${id}`)

  it('keeps the readable rows, rejects the others with reasons (line numbers of the file)', () => {
    expect(result.clients).toHaveLength(10)
    expect(result.rejected).toEqual([
      { line: 12, reasons: ['missing_client_id'] },
      { line: 13, reasons: ['missing_name'] },
      { line: 14, reasons: ['duplicate_client_id'] },
    ])
  })

  it('normalises a full row: names, E.164, postal code, province, language, dates, tags', () => {
    expect(byRef(1001)).toMatchObject({
      line: 4,
      first_name: 'Camille',
      last_name: 'Tremblay-Fictif',
      email: 'camille.fictive@exemple.test',
      sex: 'female',
      language: 'fr',
      mobile_e164: '+15145550101',
      birthday: '1990-04-12',
      last_appointment_on: '2026-09-30',
      address: { line1: '12 rue des Essais', city: 'Montréal', province: 'QC', postal_code: 'H2X 1A1', country: 'Canada' },
      archived: false,
      primary_professional_label: 'Pro Alpha',
      tagFields: { rate_variant: 'student' },
      payers: ['ivac'],
      freeTags: [],
      flags: [],
    })
    expect(byRef(1002)).toMatchObject({ first_name: 'Camille', last_name: 'Tremblay-Fictif', language: 'fr' })
    expect(byRef(1007)).toMatchObject({ work_e164: '+18195550104', work_ext: '22', payers: ['pae'] })
  })

  it('flags the values it leaves out, keeps the row', () => {
    expect(byRef(1010)).toMatchObject({ email: null, mobile_e164: null, birthday: null, sex: null, language: 'fr', last_appointment_on: null, archived: false })
    expect(new Set(byRef(1010).flags)).toEqual(
      new Set(['invalid_email', 'invalid_cell_phone', 'future_birthday', 'invalid_language', 'invalid_archived', 'invalid_sex', 'invalid_last_appointment', 'rate_conflict', 'unknown_tag']),
    )
    expect(byRef(1011)).toMatchObject({ first_name: 'Noah', last_name: 'Essai-Fictif', birthday: '2021-03-04', archived: true })
    expect(byRef(1011).flags).toEqual(['free_tags_over_limit'])
  })
})

describe('findDuplicates', () => {
  const { clients } = readClients(fixture('clients.csv'), { today: TODAY })
  const { pairs, groups, crowded } = findDuplicates(clients)
  const pairOf = (x, y) => pairs.find((p) => [p.a.line, p.b.line].sort().join() === [x, y].sort().join())

  it('HIGH: a shared contact and the same name (accents and case folded)', () => {
    expect(pairOf(4, 5)).toMatchObject({ level: 'high' })
    expect(pairOf(4, 5).reasons).toEqual(expect.arrayContaining(['email', 'phone', 'same_name', 'birthday']))
    expect(groups.map((g) => g.map((r) => r.line).sort())).toEqual([[4, 5]])
  })

  it('MEDIUM: a contact shared by two different people (a parent on two files)', () => {
    expect(pairOf(6, 7)).toMatchObject({ level: 'medium' })
    expect(pairOf(6, 7).reasons).toContain('shared_contact')
  })

  it('MEDIUM: the same name and birth date without a shared contact', () => {
    expect(pairOf(8, 9)).toMatchObject({ level: 'medium', reasons: ['same_name', 'birthday'] })
  })

  it('never a name alone', () => {
    expect(pairOf(10, 11)).toBeUndefined()
    expect(pairs).toHaveLength(3)
    expect(crowded).toEqual([])
  })

  it('a contact shared by many files is a placeholder: reported, never paired on', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ line: i + 2, first_name: `P${i}`, last_name: 'Fictif', email: 'aucun@exemple.test' }))
    const result = findDuplicates(many)
    expect(result.pairs).toEqual([])
    expect(result.crowded).toEqual([{ kind: 'email', size: 8 }])
  })

  it('a similar name with a partial contact is MEDIUM; a birth date conflict demotes a HIGH', () => {
    const result = findDuplicates([
      { line: 2, first_name: 'Alexandra', last_name: 'Fictive', email: 'alexandra.f@exemple.test' },
      { line: 3, first_name: 'Alexandr', last_name: 'Fictive', email: 'alexandra.f@autre.test' },
      { line: 4, first_name: 'Sam', last_name: 'Essai', mobile_e164: '+15145550199', birthday: '2000-01-01' },
      { line: 5, first_name: 'Sam', last_name: 'Essai', mobile_e164: '+15145550199', birthday: '2001-01-01' },
    ])
    expect(result.pairs.map((p) => [p.a.line, p.b.line, p.level, p.reasons.at(-1)])).toEqual(
      expect.arrayContaining([
        [2, 3, 'medium', 'partial_email'],
        [4, 5, 'medium', 'birthday_differs'],
      ]),
    )
  })

  it('compares the export with clients already in the app, never the app clients with each other', () => {
    const existing = [
      { first_name: 'Camille', last_name: 'Tremblay-Fictif', email: 'camille.fictive@exemple.test' },
      { first_name: 'Camille', last_name: 'Tremblay-Fictif', email: 'camille.fictive@exemple.test' },
    ]
    const result = findDuplicates([clients[0]], existing)
    expect(result.pairs).toHaveLength(2)
    expect(result.pairs.every((p) => p.a.source !== p.b.source)).toBe(true)
  })

  it('the legacy similarity', () => {
    expect(similarity('marie', 'marie')).toBe(1)
    expect(similarity('anne', 'anne marie')).toBe(0.7)
    expect(similarity('alexandra', 'alexandr')).toBeCloseTo(8 / 9)
    expect(similarity('', 'x')).toBe(0)
  })
})

describe('the Revenus exports', () => {
  it('payments: « Argent comptant » is a card through QuickBooks Payments; unknown methods and unreadable amounts are rejected', () => {
    const { payments, rejected } = readPayments(fixture('revenus-paiements.csv'))
    expect(payments.map((p) => [p.line, p.method, p.amount_cents])).toEqual([
      [2, 'card_qbo_payments', 17500],
      [3, 'interac', 123456],
      [4, 'card_stripe', 12000],
      [5, 'credit_note', -2174],
    ])
    expect(payments[3].refund).toBe(true)
    expect(rejected).toEqual([
      { line: 6, reasons: ['unknown_payment_method'], methodLabel: 'Carte cadeau' },
      { line: 7, reasons: ['invalid_amount'] },
      { line: 8, reasons: ['invalid_date'] },
    ])
    expect(mapPaymentMethod('ACCÈS D')).toBe('bank_transfer')
  })

  it('invoices: the AAAA-N number, totals checked when the sub-total is given', () => {
    const { invoices, rejected } = readInvoices(fixture('revenus-factures.csv'))
    expect(invoices.map((i) => [i.line, i.invoiceNumber, i.total_cents, i.tps_cents, i.tvq_cents, i.balance_cents])).toEqual([
      [5, '2026-0000101', 17500, 0, 0, 0],
      [6, '2026-0000102', 4349, 189, 377, 0],
      [8, '2026-103', 9450, 0, 0, 9450],
    ])
    expect(rejected).toEqual([
      { line: 7, reasons: ['totals_mismatch'] },
      { line: 9, reasons: ['invalid_invoice_number'] },
    ])
  })

  it('lines: the 5-digit code when given, taxed when a tax is', () => {
    const csv = 'Date,Facture,Service,Code,Quantité,Prix,TPS,TVQ,Total\n2026-09-03,2026-0000102,Ouverture de dossier – Individuel,10100,1,"37,83","1,89","3,77","43,49"\n2026-09-04,2026-0000103,50 minutes – Rencontre d’intervention web,,1,"120,00",,,"120,00"\n'
    const { lines, rejected } = readInvoiceLines(csv)
    expect(rejected).toEqual([])
    expect(lines.map((l) => [l.service_code, l.total_cents, l.taxed])).toEqual([
      ['10100', 4349, true],
      [null, 12000, false],
    ])
  })
})

describe('the waitlist and cancellations exports', () => {
  it('waitlist rows, an unreadable validity flagged', () => {
    const { entries, rejected } = readWaitlist('Client,Professionnel,Priorité,Valide jusqu’au\nClient Fictif,Pro Alpha,2,2026-12-31\nAutre Fictif,,haute,31/12\n,Pro Beta,,\n')
    expect(entries.map((e) => [e.line, e.priority, e.valid_until, e.flags])).toEqual([
      [2, 2, '2026-12-31', []],
      [3, null, null, ['invalid_valid_until', 'invalid_priority']],
    ])
    expect(rejected).toEqual([{ line: 4, reasons: ['missing_client'] }])
  })

  it('cancellations, counted per reason', () => {
    const { cancellations, reasons } = readCancellations('Date,Client,Raison\n2026-10-01,Client Fictif,Maladie\n2026-10-02,Autre Fictif,maladie\n')
    expect(cancellations).toHaveLength(2)
    expect(reasons).toEqual({ maladie: 2 })
  })
})

describe('the dry-run report', () => {
  const texts = {
    clients: fixture('clients.csv'),
    invoices: fixture('revenus-factures.csv'),
    payments: fixture('revenus-paiements.csv'),
  }
  const report = buildReport(texts, { today: TODAY }).join('\n')

  it('counts, reasons by line number, duplicates, money totals per month', () => {
    expect(report).toContain('Lignes lues : 13 ; gardées : 10 (actives 9, archivées 1) ; rejetées : 3')
    expect(report).toContain('ClientId déjà vu plus haut dans le fichier (1) : lignes 14')
    expect(report).toContain('Doublons : HIGH 1 paire (1 personne en plusieurs fiches), MEDIUM 2 paires à trancher')
    expect(report).toContain('Étiquettes devenues des champs : tarif étudiant (1), payeur IVAC (1), payeur PAE (1)')
    expect(report).toContain('Carte (QuickBooks Payments) 175,00 $')
    expect(report).toContain('ligne 4 ↔ ligne 5')
    expect(report).toContain('Étiquettes inconnues (gardées libres, à ajouter à la table) : Étiquette maison')
    expect(report).toContain('2026-09 : 218,49 $')
    expect(report).toContain('Modes inconnus : Carte cadeau')
  })

  it('prints no personal value: no name, email, phone, birth date, postal code or ClientId from the files', () => {
    const personal = [
      'Camille', 'Tremblay', 'Léo', 'Maude', 'Hélène', 'Helene', 'Jean', 'Zoé', 'Noah', 'Fictif Un',
      'exemple.test', '5145550101', '514 555', '438', '1990-04-12', '2010-02-03', 'H2X', 'h2x', 'Montréal',
      'gorendezvous:', '1001', 'Pro Alpha',
    ]
    for (const value of personal) expect(report, value).not.toContain(value)
  })
})

describe('the dry-run command', () => {
  it('refuses an export inside the repository', () => {
    expect(() => checkOutsideRepo(path.join(here, 'fixtures', 'clients.csv'))).toThrow(/hors du dépôt/)
  })

  it('reads files outside the repository, prints the report, writes it once (never over a file)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gor-import-'))
    try {
      const file = path.join(dir, 'clients.csv')
      writeFileSync(file, fixture('clients.csv'))
      const out = []
      const reportFile = path.join(dir, 'rapport.txt')
      run(['--clients', file, '--today', TODAY, '--report', reportFile], { stdout: { write: (t) => out.push(t) } })
      expect(out.join('')).toContain('== Clients')
      expect(readFileSync(reportFile, 'utf8')).toBe(out.join(''))
      expect(() => run(['--clients', file, '--report', reportFile], { stdout: { write: () => {} } })).toThrow()
      expect(() => run([], { stdout: { write: () => {} } })).toThrow(InputError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
