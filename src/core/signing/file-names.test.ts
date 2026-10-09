import { afterEach, describe, expect, it } from 'vitest'
import { resetClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { sealedPdfFileName as serverSealedName, signedFileBase as serverBase } from '../../../supabase/functions/_shared/signing-file-name'
import { SEALED_SUFFIX, signedFileBase, signedFileName, signedFileNames } from './file-names'

afterEach(() => resetClinicTimezone())

describe('signedFileNames (P4-500)', () => {
  it('« Contrat de service - Prénom Nom - signé le {date clinique} », the certificate, the sealed original', () => {
    setClinicTimezone('America/Toronto')
    // 02:30 UTC on Oct 10 is still Oct 9 in Toronto.
    expect(signedFileNames('Contrat de service — Olivier Bergeron', '2026-10-10T02:30:00Z')).toEqual({
      document: 'Contrat de service - Olivier Bergeron - signé le 2026-10-09.pdf',
      certificate: 'Contrat de service - Olivier Bergeron - certificat et journal de signature.pdf',
      sealed: 'Contrat de service - Olivier Bergeron - complet scellé.pdf',
    })
  })

  it('no completion date: « signé »; no title: « Document signé »', () => {
    expect(signedFileNames(null, null).document).toBe('Document signé - signé.pdf')
  })

  it('unsafe characters become spaces; letters of every language stay', () => {
    expect(signedFileBase("Contrat de service – Anne/Marie O'Neil-Côté\u202e")).toBe("Contrat de service - Anne Marie O'Neil-Côté")
  })

  it('at most 100 characters: the title is cut, never the suffix', () => {
    const name = signedFileName(`Contrat de service — ${'Anne'.repeat(40)}`, SEALED_SUFFIX)
    expect(Array.from(name).length).toBeLessThanOrEqual(100)
    expect(name.endsWith(' - complet scellé.pdf')).toBe(true)
  })
})

describe('signed file names parity with the functions', () => {
  it.each([
    'Contrat de service — Olivier Bergeron',
    "Contrat de service — Marc-André O'Neil",
    'Contrat de service — Anne/Marie Roy\u202e',
    'Document test de signature électronique',
    `Contrat de service — ${'Anne'.repeat(40)}`,
    '  ',
  ])('%s: the stored name is the browser’s sealed name', (title) => {
    expect(serverBase(title)).toBe(signedFileBase(title))
    expect(serverSealedName(title)).toBe(signedFileName(title, SEALED_SUFFIX))
  })
})
