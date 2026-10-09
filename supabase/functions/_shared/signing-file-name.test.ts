import { assertEquals } from '@std/assert'
import {
  sealedPdfFileName,
  signedFileBase,
  signedFileName,
} from './signing-file-name.ts'

Deno.test('sealedPdfFileName: « {titre} - complet scellé.pdf », dashes as « - » (P4-500)', () => {
  assertEquals(
    sealedPdfFileName('Contrat de service — Olivier Bergeron'),
    'Contrat de service - Olivier Bergeron - complet scellé.pdf',
  )
  assertEquals(
    sealedPdfFileName("Contrat de service – Marc-André O'Neil"),
    "Contrat de service - Marc-André O'Neil - complet scellé.pdf",
  )
})

Deno.test('signedFileBase: unsafe characters become spaces; nothing left → « Document signé »', () => {
  assertEquals(
    signedFileBase('Contrat de service — Anne/Marie Roy\u202e'),
    'Contrat de service - Anne Marie Roy',
  )
  assertEquals(signedFileBase('  '), 'Document signé')
  assertEquals(signedFileBase(null), 'Document signé')
  assertEquals(
    sealedPdfFileName(undefined),
    'Document signé - complet scellé.pdf',
  )
})

Deno.test('signedFileName: at most 100 characters, the title cut, never the suffix', () => {
  const name = signedFileName(
    `Contrat de service — ${'Anne'.repeat(40)}`,
    ' - certificat et journal de signature',
  )
  assertEquals(Array.from(name).length <= 100, true)
  assertEquals(name.endsWith(' - certificat et journal de signature.pdf'), true)
  assertEquals(name.startsWith('Contrat de service - Anne'), true)
})
