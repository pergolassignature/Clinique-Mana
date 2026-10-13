import { assertEquals } from '@std/assert'
import { clauseBlocks } from './client-consents.ts'
import type { PdfDocument } from './pdf/model.ts'
import { keepSignerRoles } from './signing.ts'

const CLAUSES = [
  {
    key: 'accord',
    kind: 'agree' as const,
    text_fr: 'J’accepte.',
    text_en: 'I agree.',
  },
  {
    key: 'courriel',
    kind: 'yes_no' as const,
    text_fr: 'Par courriel ?',
    text_en: 'By email?',
  },
]

Deno.test('clauseBlocks: one table, the answers in the request language, « accord requis » noted', () => {
  assertEquals(clauseBlocks(CLAUSES, { accord: 'yes', courriel: 'no' }, 'fr'), [
    {
      type: 'table',
      columns: [{ label: 'Clause', width: 75 }, {
        label: 'Réponse',
        width: 25,
      }],
      rows: [['J’accepte. (accord requis)', 'Oui'], ['Par courriel ?', 'Non']],
    },
  ])
  const en = clauseBlocks(CLAUSES, { accord: 'yes', courriel: 'yes' }, 'en')
  assertEquals(en[0].type === 'table' && en[0].rows, [
    ['I agree. (agreement required)', 'Yes'],
    ['By email?', 'Yes'],
  ])
})

const doc: PdfDocument = {
  title: 'T',
  header: { text: 'H', initialsFor: ['client', 'client_2'] },
  footer: { text: 'F' },
  blocks: [
    { type: 'paragraph', runs: [{ text: 'x' }] },
    {
      type: 'signaturePage',
      signers: [{ role: 'client', label: 'A' }, {
        role: 'client_2',
        label: 'B',
      }],
    },
  ],
}

Deno.test('keepSignerRoles: a role without a signer prints no box nor initials; all present or none left keeps the document', () => {
  const one = keepSignerRoles(doc, ['client'])
  const page = one.blocks[1]
  assertEquals(page.type === 'signaturePage' && page.signers, [{
    role: 'client',
    label: 'A',
  }])
  assertEquals(one.header?.initialsFor, ['client'])
  assertEquals(keepSignerRoles(doc, ['client', 'client_2']), doc)
  assertEquals(keepSignerRoles(doc, ['professional']), doc)
})
