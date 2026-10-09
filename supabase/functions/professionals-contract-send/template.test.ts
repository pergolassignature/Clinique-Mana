/**
 * The seeded « Contrat de service » (draft version 1 of
 * `*_professionals_contracts.sql`, `private.professionals_contract_template()`)
 * renders: every placeholder is declared, Annexe A is its block placeholder,
 * the document passes the renderer's checks once filled with the variables'
 * samples and real Annexe A blocks, and the initials and signature boxes land
 * where Documenso expects them (P4-17, P4-431).
 */
import { assert, assertEquals } from '@std/assert'
import { PLACEHOLDER_SOURCE, type TemplateVariable } from '../_shared/format.ts'
import { checkDocument, type PdfDocument } from '../_shared/pdf/model.ts'
import { renderPdf } from '../_shared/pdf/render.ts'
import { fillTemplate, fillTexts } from '../_shared/pdf/template.ts'
import { annexeBlocks } from './annexe.ts'
import { ANNEXE_PATH } from './handler.ts'

const MIGRATIONS = new URL('../../migrations/', import.meta.url)

async function seededTemplate(): Promise<{
  body: PdfDocument
  variables: TemplateVariable[]
  signers: { role: string; order: number; required: boolean }[]
  email_subject: string
  email_message: string
}> {
  const name = [...Deno.readDirSync(MIGRATIONS)].map((e) => e.name)
    .find((n) => n.endsWith('_professionals_contracts.sql'))
  assert(name, 'the contracts migration exists')
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

const annexe = annexeBlocks({
  title_label: 'Psychologue',
  prices: [{ duration: 60, client_price_cents: 20000 }, {
    duration: 50,
    client_price_cents: 17500,
  }, {
    duration: 30,
    client_price_cents: 13000,
  }],
  tiers: Array.from({ length: 7 }, (_, n) => ({
    from: n === 0 ? 0 : n * 50 + 1,
    to: n === 6 ? null : (n + 1) * 50,
    pay: [60, 50, 30].map((duration) => ({ duration, cents: 10000 + n * 100 })),
  })),
  sessions_total: 78,
  current_tier_from: 51,
  in_force: null,
  other: [{
    kind: 'workshop',
    name: 'Ateliers et conférences',
    retention_pct: 25,
  }],
})

Deno.test('seeded contract: the draft opens with the validation banner and holds Annexe A as a block placeholder', async () => {
  const { body } = await seededTemplate()
  assertEquals(body.blocks[0], {
    type: 'paragraph',
    runs: [{
      text: 'Texte à faire valider par la direction avant publication',
      bold: true,
    }],
  })
  assert(
    body.blocks.some((b) =>
      b.type === 'paragraph' && b.runs.length === 1 &&
      b.runs[0].text === `{{${ANNEXE_PATH}}}`
    ),
  )
  assertEquals(body.header?.initialsFor, ['professional'])
  assertEquals(body.blocks.at(-1)?.type, 'signaturePage')
})

Deno.test('seeded contract: every placeholder is a declared variable, every variable is used', async () => {
  const { body, variables, email_subject, email_message } =
    await seededTemplate()
  const used = new Set(
    [...(JSON.stringify(body) + email_subject + email_message).matchAll(
      new RegExp(PLACEHOLDER_SOURCE, 'g'),
    )]
      .map((m) => m[1].trim()),
  )
  assertEquals([...used].sort(), variables.map((v) => v.path).sort())
  assert(variables.length <= 40, 'the database caps a version at 40 variables')
})

Deno.test('seeded contract: the signature page and the version signers are the same roles (publish_template_version)', async () => {
  const { body, signers } = await seededTemplate()
  const page = body.blocks.at(-1)
  assert(page?.type === 'signaturePage')
  assertEquals(
    page.signers.map((s) => s.role).sort(),
    signers.map((s) => s.role).sort(),
  )
  assertEquals(signers.map((s) => [s.role, s.order, s.required]), [[
    'professional',
    1,
    true,
  ], ['clinic', 2, false]])
})

Deno.test('seeded contract: filled with the samples and Annexe A, it renders with initials on every page and both signatures', async () => {
  const { body, variables, email_subject, email_message } =
    await seededTemplate()
  const values = samples(variables)
  const filled = fillTemplate(body, variables, values, 'America/Toronto', {
    [ANNEXE_PATH]: annexe,
  })
  assert(filled.ok, JSON.stringify(filled))
  const check = checkDocument(filled.document)
  assert(check.ok, JSON.stringify(check))
  assert(!JSON.stringify(filled.document).includes('{{'), 'no placeholder left')
  const pdf = await renderPdf(filled.document, {})
  assert(pdf.pageCount >= 6, `a real contract: ${pdf.pageCount} pages`)
  const initials = pdf.fields.filter((f) => f.type === 'INITIALS')
  assertEquals(initials.length, pdf.pageCount, 'one initials box per page')
  assert(initials.every((f) => f.role === 'professional'))
  assertEquals(
    pdf.fields.filter((f) => f.type === 'SIGNATURE').map((
      f,
    ) => [f.role, f.page]),
    [['professional', pdf.pageCount], ['clinic', pdf.pageCount]],
  )
  const email = fillTexts(
    { subject: email_subject, message: email_message },
    variables,
    values,
    'America/Toronto',
    {
      [ANNEXE_PATH]: annexe,
    },
  )
  assert(email.ok)
  assertEquals(
    email.texts.subject,
    'Votre contrat de service avec Clinique MANA',
  )
})
