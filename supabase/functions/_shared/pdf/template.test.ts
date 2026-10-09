import { assert, assertEquals } from '@std/assert'
import type { TemplateVariable } from '../format.ts'
import type { PdfDocument } from './model.ts'
import { fillTemplate, fillTexts } from './template.ts'

const TORONTO = 'America/Toronto'
const v = (
  path: string,
  kind: TemplateVariable['kind'] = 'text',
  required = true,
): TemplateVariable => ({
  path,
  label: path,
  sample: `[${path}]`,
  required,
  kind,
})

const body: PdfDocument = {
  title: 'Contrat — {{ professional.name }}',
  header: { text: 'Contrat {{professional.name}}', initialsFor: ['clinic'] },
  footer: { text: 'Version {{version}}' },
  blocks: [
    { type: 'heading', level: 1, text: 'Entre {{clinic.name}} et vous' },
    {
      type: 'paragraph',
      runs: [{ text: 'Signé par ' }, {
        text: '{{professional.name}}',
        bold: true,
      }],
    },
    { type: 'list', ordered: false, items: [[{ text: '{{clinic.name}}' }]] },
    {
      type: 'table',
      columns: [{ label: '{{clinic.name}}', width: 100 }],
      rows: [['{{professional.name}}']],
    },
    {
      type: 'signaturePage',
      signers: [{ role: 'clinic', label: 'Pour {{clinic.name}}' }],
    },
  ],
}
const variables = [v('professional.name'), v('clinic.name'), v('version')]
const values = {
  professional: { name: 'Ana Côté' },
  clinic: { name: 'Clinique MANA' },
  version: 3,
}

function filled(
  doc: PdfDocument,
  vars: TemplateVariable[],
  vals: Record<string, unknown>,
): PdfDocument {
  const result = fillTemplate(doc, vars, vals, TORONTO)
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`)
  return result.document
}

const one = (text: string): PdfDocument => ({
  title: 'T',
  footer: { text: 'F' },
  blocks: [{ type: 'paragraph', runs: [{ text }] }],
})
const firstRun = (doc: PdfDocument) => {
  const block = doc.blocks[0]
  assert(block.type === 'paragraph')
  return block.runs[0].text
}

Deno.test('fillTemplate: fills every text of the document, keeping its shape', () => {
  const before = structuredClone(body)
  assertEquals(filled(body, variables, values), {
    title: 'Contrat — Ana Côté',
    header: { text: 'Contrat Ana Côté', initialsFor: ['clinic'] },
    footer: { text: 'Version 3' },
    blocks: [
      { type: 'heading', level: 1, text: 'Entre Clinique MANA et vous' },
      {
        type: 'paragraph',
        runs: [{ text: 'Signé par ' }, { text: 'Ana Côté', bold: true }],
      },
      { type: 'list', ordered: false, items: [[{ text: 'Clinique MANA' }]] },
      {
        type: 'table',
        columns: [{ label: 'Clinique MANA', width: 100 }],
        rows: [['Ana Côté']],
      },
      {
        type: 'signaturePage',
        signers: [{ role: 'clinic', label: 'Pour Clinique MANA' }],
      },
    ],
  })
  assertEquals(body, before, 'the template body is not mutated')
})

Deno.test('fillTemplate: control characters in values become spaces', () => {
  const doc = filled(one('« {{name}} »'), [v('name')], {
    name: 'Ana\nCôté\u0007\tB\u2028x',
  })
  assertEquals(firstRun(doc), '« Ana Côté  B x »')
})

Deno.test('fillTemplate: dates as in email (datetime in the clinic timezone, date-only as written)', () => {
  const doc = filled(
    one('{{starts_at}} / {{birthday}}'),
    [v('starts_at', 'datetime'), v('birthday', 'date')],
    { starts_at: '2026-07-15T18:30:00Z', birthday: '2020-01-01' },
  )
  assertEquals(firstRun(doc), '15 juillet 2026 à 14 h 30 / 1 janvier 2020')
})

Deno.test('fillTemplate: values are inserted once, never read as placeholders', () => {
  const doc = filled(one('{{a}}'), [v('a'), v('b')], { a: '{{b}}', b: 'B' })
  assertEquals(firstRun(doc), '{{b}}')
})

Deno.test('fillTemplate: an undeclared placeholder fails with its path', () => {
  assertEquals(
    fillTemplate(one('{{ secret.path }}'), [], {}, TORONTO),
    { ok: false, code: 'unknown_variable', path: 'secret.path' },
  )
  const label = structuredClone(body)
  label.footer.text = '{{nope}}'
  assertEquals(
    fillTemplate(label, variables, values, TORONTO),
    { ok: false, code: 'unknown_variable', path: 'nope' },
  )
})

Deno.test('fillTemplate: a missing required value fails; a missing optional one is empty', () => {
  assertEquals(
    fillTemplate(one('{{a}}'), [v('a')], { a: '  ' }, TORONTO),
    { ok: false, code: 'missing_variable', path: 'a' },
  )
  assertEquals(
    fillTemplate(one('{{a}}'), [v('a', 'date')], { a: '2026-02-30' }, TORONTO),
    { ok: false, code: 'missing_variable', path: 'a' },
  )
  assertEquals(
    firstRun(filled(one('[{{a}}]'), [v('a', 'text', false)], {})),
    '[]',
  )
})

Deno.test('fillTemplate: an invalid clinic timezone is a result, not a throw', () => {
  assertEquals(
    fillTemplate(one('x'), [], {}, 'Mars/Olympus'),
    { ok: false, code: 'invalid_timezone' },
  )
})

Deno.test('fillTexts: fills plain strings (the signing email) under the same rules', () => {
  assertEquals(
    fillTexts(
      {
        subject: 'Contrat — {{professional.name}}',
        message: 'De {{ clinic.name }}\n',
      },
      variables,
      { ...values, professional: { name: 'Ana\nCôté' } },
      TORONTO,
    ),
    {
      ok: true,
      texts: { subject: 'Contrat — Ana Côté', message: 'De Clinique MANA\n' },
    },
  )
  assertEquals(
    fillTexts({ subject: '{{nope}}' }, variables, values, TORONTO),
    { ok: false, code: 'unknown_variable', path: 'nope' },
  )
  assertEquals(
    fillTexts({ subject: '{{a}}' }, [v('a')], {}, TORONTO),
    { ok: false, code: 'missing_variable', path: 'a' },
  )
})

Deno.test('fillTemplate: a paragraph holding only a block placeholder becomes the given blocks (P4-433)', () => {
  const doc: PdfDocument = {
    title: 'Contrat',
    footer: { text: 'Pied' },
    blocks: [
      { type: 'heading', level: 1, text: 'Annexe A' },
      { type: 'paragraph', runs: [{ text: ' {{ pricing.annexe_a }} ' }] },
      { type: 'paragraph', runs: [{ text: 'Voir {{pricing.annexe_a}}.' }] },
      { type: 'paragraph', runs: [{ text: '{{clinic.name}}' }] },
    ],
  }
  const table = {
    type: 'table' as const,
    columns: [{ label: '{{clinic.name}}', width: 1 }],
    rows: [['{{professional.name}}']],
  }
  const result = fillTemplate(
    doc,
    [v('pricing.annexe_a'), v('clinic.name')],
    { clinic: { name: 'Clinique MANA' } },
    TORONTO,
    { 'pricing.annexe_a': [table, { type: 'pageBreak' }] },
  )
  assert(result.ok)
  assertEquals(result.document.blocks, [
    { type: 'heading', level: 1, text: 'Annexe A' },
    // Inserted as built: never filled (a value is never read as a placeholder).
    table,
    { type: 'pageBreak' },
    // Inside a sentence the placeholder is text: its value, or empty.
    { type: 'paragraph', runs: [{ text: 'Voir .' }] },
    // A placeholder of a path without blocks stays an ordinary paragraph.
    { type: 'paragraph', runs: [{ text: 'Clinique MANA' }] },
  ])
  // The same body without blocks: the required value is missing.
  assertEquals(
    fillTemplate(doc, [v('pricing.annexe_a'), v('clinic.name')], {
      clinic: { name: 'X' },
    }, TORONTO),
    { ok: false, code: 'missing_variable', path: 'pricing.annexe_a' },
  )
  // Its path must still be declared.
  assertEquals(
    fillTemplate(doc, [v('clinic.name')], { clinic: { name: 'X' } }, TORONTO, {
      'pricing.annexe_a': [],
    }),
    { ok: false, code: 'unknown_variable', path: 'pricing.annexe_a' },
  )
})
