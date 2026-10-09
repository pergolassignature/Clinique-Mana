/**
 * The seeded « Consentement au droit à l'image » (draft version 1 of
 * `*_professionals_image_consent.sql`,
 * `private.professionals_image_consent_template()`) renders: every
 * placeholder is declared, the professional is the only signer, nothing is
 * initialled, and the signature lands on the last page (P4-481).
 */
import { assert, assertEquals } from '@std/assert'
import { PLACEHOLDER_SOURCE, type TemplateVariable } from '../_shared/format.ts'
import { checkDocument, type PdfDocument } from '../_shared/pdf/model.ts'
import { renderPdf } from '../_shared/pdf/render.ts'
import { fillTemplate, fillTexts } from '../_shared/pdf/template.ts'

const MIGRATIONS = new URL('../../migrations/', import.meta.url)

async function seededTemplate(): Promise<{
  body: PdfDocument
  variables: TemplateVariable[]
  signers: { role: string; order: number; required: boolean }[]
  email_subject: string
  email_message: string
}> {
  const name = [...Deno.readDirSync(MIGRATIONS)].map((e) => e.name)
    .find((n) => n.endsWith('_professionals_image_consent.sql'))
  assert(name, 'the image consent migration exists')
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS))
  const start = sql.indexOf('$json$') + '$json$'.length
  const end = sql.indexOf('$json$::jsonb')
  return JSON.parse(sql.slice(start, end))
}

const samples = (variables: TemplateVariable[]) => {
  const values: Record<string, unknown> = {}
  for (const v of variables) {
    const keys = v.path.split('.')
    let at = values
    for (const k of keys.slice(0, -1)) {
      at = (at[k] ??= {}) as Record<string, unknown>
    }
    at[keys[keys.length - 1]] = v.sample
  }
  return values
}

Deno.test('seeded image consent: the draft opens with the validation banner, no initials, the signature page last', async () => {
  const { body } = await seededTemplate()
  assertEquals(body.blocks[0], {
    type: 'paragraph',
    runs: [{
      text: 'Texte à faire valider par la direction avant publication',
      bold: true,
    }],
  })
  assertEquals(body.header?.initialsFor, undefined)
  assertEquals(body.blocks.at(-1)?.type, 'signaturePage')
  assert(
    !JSON.stringify(body).includes('pricing.'),
    'no Annexe A in a consent',
  )
})

Deno.test('seeded image consent: every placeholder is a declared variable, every variable is used', async () => {
  const { body, variables, email_subject, email_message } =
    await seededTemplate()
  const used = new Set(
    [...(JSON.stringify(body) + email_subject + email_message).matchAll(
      new RegExp(PLACEHOLDER_SOURCE, 'g'),
    )]
      .map((m) => m[1].trim()),
  )
  assertEquals([...used].sort(), variables.map((v) => v.path).sort())
})

Deno.test('seeded image consent: the professional is the only signer (as the legacy consent)', async () => {
  const { body, signers } = await seededTemplate()
  const page = body.blocks.at(-1)
  assert(page?.type === 'signaturePage')
  assertEquals(page.signers.map((s) => s.role), ['professional'])
  assertEquals(signers.map((s) => [s.role, s.order, s.required]), [[
    'professional',
    1,
    true,
  ]])
})

Deno.test("seeded image consent: filled with the samples, it renders with the professional's signature on the last page", async () => {
  const { body, variables, email_subject, email_message } =
    await seededTemplate()
  const values = samples(variables)
  const filled = fillTemplate(body, variables, values, 'America/Toronto')
  assert(filled.ok, JSON.stringify(filled))
  const check = checkDocument(filled.document)
  assert(check.ok, JSON.stringify(check))
  assert(!JSON.stringify(filled.document).includes('{{'), 'no placeholder left')
  const pdf = await renderPdf(filled.document, {})
  assertEquals(pdf.fields.filter((f) => f.type === 'INITIALS').length, 0)
  assertEquals(
    pdf.fields.filter((f) => f.type === 'SIGNATURE').map((f) => [
      f.role,
      f.page,
    ]),
    [['professional', pdf.pageCount]],
  )
  const email = fillTexts(
    { subject: email_subject, message: email_message },
    variables,
    values,
    'America/Toronto',
  )
  assert(email.ok)
  assertEquals(
    email.texts.subject,
    'Votre consentement au droit à l’image pour Clinique MANA',
  )
})
