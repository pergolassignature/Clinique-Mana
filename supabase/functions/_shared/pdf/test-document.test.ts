import { assert, assertEquals } from '@std/assert'
import { checkDocument } from './model.ts'
import { signingTestDocument } from './test-document.ts'

Deno.test('signingTestDocument: a valid document for any clinic name, signed and initialled by the clinic', () => {
  for (
    const name of ['Clinique MANA', '  ', 'É'.repeat(300), '😀'.repeat(130)]
  ) {
    const doc = signingTestDocument(name)
    assert(checkDocument(doc).ok, `valid for a ${name.length}-unit name`)
    assert(doc.footer.text.length <= 120)
  }
  const doc = signingTestDocument('Clinique MANA')
  assertEquals(
    doc.title,
    'Document test de signature électronique — Clinique MANA',
  )
  assertEquals(doc.header?.initialsFor, ['clinic'])
  assertEquals(doc.blocks.at(-1), {
    type: 'signaturePage',
    signers: [{ role: 'clinic', label: 'Personne qui fait le test' }],
  })
  assertEquals(signingTestDocument('  ').footer.text, 'Clinique')
})
