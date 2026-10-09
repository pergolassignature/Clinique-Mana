/**
 * Annexe A of the service contract (P4-432): the blocks that replace the
 * template's `{{pricing.annexe_a}}` (a block placeholder, P4-433), built from
 * the terms `prepare_professional_contract` snapshotted (P4-151). Pure: the
 * same terms always print the same words.
 *
 * What the professional reads is what they are paid, never a margin to
 * misread (the retention program, P4-180 … P4-194):
 * - the client price of each duration the grid prices (« Honoraires
 *   facturés au client »);
 * - the amount paid to the professional per meeting, one row per tier of
 *   cumulative sessions (« 0 à 50 séances », …, « 301 séances et plus »);
 * - where the professional stands on the contract's date, and the amount at
 *   the rate in force when it differs from the tier's (a « Taux particulier »
 *   or a « Maintenu »);
 * - the other kinds as the share paid to the professional, with what the
 *   clinic retains beside it, in words (« 75 % des honoraires facturés (la
 *   Clinique retient 25 %) »).
 * Every amount is « avant taxes » (P4-18: `TAX_WORDING`, one string to change
 * if the accountant says otherwise). French typography: no-break spaces
 * before « $ » and « % » and as the thousands separator, narrow ones (U+202F,
 * `NNBSP`) before « : » and inside « » as the template's text gets
 * (`frenchSpacing`, P4-433 blocks are never filled); whole dollars without
 * decimals, cents with a comma.
 */
import { z } from 'zod'
import { NNBSP } from '../_shared/french.ts'
import type { Block } from '../_shared/pdf/model.ts'

/** P4-18: the amounts are before taxes. */
export const TAX_WORDING = 'avant taxes'

const NBSP = ' '

const paySchema = z.array(z.object({
  duration: z.number().int(),
  cents: z.number().int().nullable(),
}))

/** The `annexe` of `prepare_professional_contract` (the snapshot's terms). */
export const annexeSchema = z.object({
  title_label: z.string(),
  prices: z.array(z.object({
    duration: z.number().int(),
    client_price_cents: z.number().int(),
  })),
  tiers: z.array(z.object({
    from: z.number().int(),
    to: z.number().int().nullable(),
    pay: paySchema,
  })).min(1),
  sessions_total: z.number(),
  current_tier_from: z.number().int().nullable(),
  in_force: z.object({ pay: paySchema }).nullable(),
  other: z.array(z.object({
    kind: z.string(),
    name: z.string(),
    retention_pct: z.number().nullable(),
  })),
})
export type AnnexeTerms = z.infer<typeof annexeSchema>

/** Digits grouped by three with no-break spaces: « 1 200 ». */
function grouped(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** « 126 $ », « 93,60 $ », « 1 200 $ ». */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = grouped(Math.floor(abs / 100))
  const rest = abs % 100
  return `${sign}${dollars}${
    rest === 0 ? '' : `,${String(rest).padStart(2, '0')}`
  }${NBSP}$`
}

/** A number with a decimal comma and no trailing zeros: « 27,5 », « 25 », « 78,5 ». */
export function decimal(value: number): string {
  const fixed = Number(value.toFixed(2))
  const [whole, fraction] = String(Math.abs(fixed)).split('.')
  return `${fixed < 0 ? '-' : ''}${grouped(Number(whole))}${
    fraction ? `,${fraction}` : ''
  }`
}

/** « 27,5 % ». */
export function percent(value: number): string {
  return `${decimal(value)}${NBSP}%`
}

/** « Rencontre 60 min (couple ou famille) », « Rencontre 50 min ». */
export function durationLabel(duration: number): string {
  return duration === 60
    ? `Rencontre 60${NBSP}min (couple ou famille)`
    : `Rencontre ${duration}${NBSP}min`
}

/** « text » with narrow no-break spaces inside the guillemets. */
const quoted = (text: string) => `«${NNBSP}${text}${NNBSP}»`

/** « 0 à 50 séances », « 301 séances et plus ». */
export function tierLabel(tier: { from: number; to: number | null }): string {
  return tier.to === null
    ? `${grouped(tier.from)} séances et plus`
    : `${grouped(tier.from)} à ${grouped(tier.to)} séances`
}

/** What the other kinds pay, by kind key (`compensation_kinds`); another kind reads its name. */
const OTHER_KINDS: Record<string, { label: string; base: string }> = {
  workshop: {
    label: 'Ateliers et conférences',
    base: 'des honoraires facturés',
  },
  late_cancellation: {
    label: 'Annulation tardive ou absence non motivée',
    base: 'des frais payés par le client',
  },
  other_fees: {
    label: 'Autres frais (rapports, échanges avec un intervenant externe)',
    base: 'des montants facturés',
  },
}

const cell = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? 'À confirmer' : money(cents)

const payFor = (
  pay: { duration: number; cents: number | null }[],
  duration: number,
) => pay.find((p) => p.duration === duration)?.cents ?? null

/** The blocks of Annexe A for these terms (module comment). */
export function annexeBlocks(terms: AnnexeTerms): Block[] {
  const durations = terms.prices.map((p) => p.duration)
  const width = durations.length > 0 ? Math.floor(60 / durations.length) : 60
  const current = terms.tiers.find((t) => t.from === terms.current_tier_from) ??
    null

  const blocks: Block[] = [
    {
      type: 'paragraph',
      runs: [
        { text: `Profession${NNBSP}: ` },
        { text: terms.title_label, bold: true },
        {
          text:
            `. Tous les montants sont en dollars canadiens, ${TAX_WORDING}.`,
        },
      ],
    },
    { type: 'heading', level: 3, text: 'Consultations' },
  ]
  if (durations.length === 0) {
    // A grid without prices (never seeded so): no table without columns.
    blocks.push({
      type: 'paragraph',
      runs: [{
        text:
          'Les honoraires des consultations restent à confirmer par la Clinique.',
      }],
    })
  } else {
    blocks.push(
      {
        type: 'paragraph',
        runs: [{
          text:
            `Honoraires facturés au client par rencontre (${TAX_WORDING})${NNBSP}:`,
        }],
      },
      {
        type: 'table',
        columns: terms.prices.map((p) => ({
          label: durationLabel(p.duration),
          width: 1,
        })),
        rows: [terms.prices.map((p) => money(p.client_price_cents))],
      },
      {
        type: 'paragraph',
        runs: [{
          text:
            `Montant versé au Professionnel par rencontre (${TAX_WORDING}), selon le nombre cumulatif de séances réalisées avec les clients de la Clinique${NNBSP}:`,
        }],
      },
      {
        type: 'table',
        columns: [
          { label: 'Séances cumulées', width: 100 - width * durations.length },
          ...durations.map((d) => ({ label: durationLabel(d), width })),
        ],
        rows: terms.tiers.map((
          t,
        ) => [tierLabel(t), ...durations.map((d) => cell(payFor(t.pay, d)))]),
      },
    )
  }

  // French: singular below 2 (« 0 séance cumulée », « 1,5 séance cumulée »), plural from 2.
  const sessionsWord = terms.sessions_total < 2
    ? 'séance cumulée'
    : 'séances cumulées'
  const standing: string[] = [
    `À la date du contrat, le Professionnel compte ${
      decimal(terms.sessions_total)
    } ${sessionsWord}`,
  ]
  if (current) standing.push(` (palier ${quoted(tierLabel(current))})`)
  standing.push('. La Clinique fait le suivi du palier chaque mois.')
  blocks.push({ type: 'paragraph', runs: [{ text: standing.join('') }] })

  // The rate in force when it is not the tier's (a custom or maintained rate).
  const inForce = terms.in_force
  if (
    inForce && durations.length > 0 &&
    (!current ||
      durations.some((d) => payFor(inForce.pay, d) !== payFor(current.pay, d)))
  ) {
    blocks.push({
      type: 'paragraph',
      runs: [
        {
          text:
            `Montant versé à la date du contrat, selon l’entente en vigueur${NNBSP}: `,
        },
        {
          text: durations.map((d) =>
            `${durationLabel(d)}${NNBSP}: ${cell(payFor(inForce.pay, d))}`
          ).join(' · '),
          bold: true,
        },
        { text: '.' },
      ],
    })
  }

  blocks.push(
    { type: 'heading', level: 3, text: 'Autres services' },
    {
      type: 'table',
      columns: [
        { label: 'Service', width: 45 },
        { label: `Part versée au Professionnel (${TAX_WORDING})`, width: 55 },
      ],
      rows: terms.other.map((o) => {
        const kind = OTHER_KINDS[o.kind]
        const label = kind?.label ?? o.name
        if (o.retention_pct === null) return [label, 'À confirmer']
        const share = percent(100 - o.retention_pct)
        return [
          label,
          `${share} ${
            kind?.base ?? 'des montants facturés'
          } (la Clinique retient ${percent(o.retention_pct)})`,
        ]
      }),
    },
  )
  return blocks
}

/** One line of the preview's summary: « Rencontre 50 min » → « 126 $ … ». */
export interface SummaryLine {
  label: string
  value: string
}

/**
 * The main values Annexe A prints, for the preview's side panel (P4-502):
 * the profession, where the professional stands, and per duration the client
 * price and the amount paid today (the rate in force when there is one, else
 * the current tier's). The same words as `annexeBlocks`, from the same terms.
 */
export function annexeSummary(terms: AnnexeTerms): SummaryLine[] {
  const current = terms.tiers.find((t) => t.from === terms.current_tier_from) ??
    null
  const today = terms.in_force?.pay ?? current?.pay ?? []
  const lines: SummaryLine[] = [
    { label: 'Profession', value: terms.title_label },
    {
      label: 'Séances cumulées',
      value: `${decimal(terms.sessions_total)}${
        current ? ` (palier ${quoted(tierLabel(current))})` : ''
      }`,
    },
  ]
  for (const price of terms.prices) {
    lines.push({
      label: durationLabel(price.duration),
      value: `${money(price.client_price_cents)} facturés au client · ${
        cell(payFor(today, price.duration))
      } versés au professionnel (${TAX_WORDING})`,
    })
  }
  return lines
}
