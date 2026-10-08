/**
 * The built-in test document of « Signature électronique » (design §6.3,
 * `signing-test-document`): one page, signed and initialled by the person
 * who runs the test (role `clinic`), so a test proves the fields, the
 * webhook and the signed-PDF storage end to end without any module.
 *
 * pdfmake-free: plain model data.
 */
import type { PdfDocument } from './model.ts'

/** At most `max` UTF-16 units (the model's limit), never splitting a surrogate pair. */
function cut(text: string, max: number): string {
  let out = ''
  for (const char of text) {
    if (out.length + char.length > max) break
    out += char
  }
  return out
}

/** The test document for a clinic (its name is cut to the footer's 120 characters). */
export function signingTestDocument(clinicName: string): PdfDocument {
  const clinic = cut(clinicName.trim() || 'Clinique', 120)
  return {
    title: `Document test de signature électronique — ${clinic}`,
    header: { text: 'Document test', initialsFor: ['clinic'] },
    footer: { text: clinic },
    // Headings only before the signature page: they move onto it, so the
    // document is one page (the renderer starts the signature page on a new
    // page below any other block).
    blocks: [
      {
        type: 'heading',
        level: 1,
        text: 'Document test de signature électronique',
      },
      {
        type: 'heading',
        level: 3,
        text:
          'Ce document sert uniquement à vérifier le circuit de signature électronique de la clinique. Il n’a aucune valeur juridique.',
      },
      {
        type: 'signaturePage',
        signers: [{ role: 'clinic', label: 'Personne qui fait le test' }],
      },
    ],
  }
}

/** The Documenso invitation of the test document. */
export const SIGNING_TEST_EMAIL = {
  subject: 'Document test de signature électronique',
  message:
    'Ce document sert uniquement à vérifier le circuit de signature électronique de la clinique. Il n’a aucune valeur juridique.',
} as const
