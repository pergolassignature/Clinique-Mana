/**
 * Annexe A of the service contract (P4-432, in the 2026 contract's format,
 * P4-556): the blocks that replace the template's `{{pricing.annexe_a}}` (a
 * block placeholder, P4-433), built from the terms
 * `prepare_professional_contract` snapshotted (P4-151). Pure: the same terms
 * always print the same words.
 *
 * One table, « Nature du service | Part du Professionnel | Part de la Clinique
 * MANA », as the contract Jonathan supplied (« Partage des honoraires »):
 * - « Consultation (individuelles, de couple et familiales) »: the FIRST tier
 *   of the professional's primary title's retention grid (the lowest number of
 *   cumulative sessions): the professional's share is 100 − its retention;
 *   the higher tiers are the « Programme de reconnaissance », which the
 *   contract describes in words only (the retention program, P4-180 …
 *   P4-194);
 * - « Ateliers, conférences et formations », « Annulation tardive ou absence
 *   non motivée* », « Autres frais administratifs »: the other kinds' rates in
 *   force (Paramètres → Rémunération), any other kind by its name; a rate not
 *   set yet reads « À confirmer ».
 * The note on the « * » and the rest of the annexe are the template's prose.
 * Shares are percentages (« 70 % »): a no-break space before « % »; a decimal
 * comma (« 72,5 % »).
 */
import { z } from 'zod'
import type { Block } from '../_shared/pdf/model.ts'

const NBSP = '\u00a0'

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
    retention_pct: z.number(),
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

/** The table's column labels (the contract's). */
export const ANNEXE_COLUMNS = [
  'Nature du service',
  'Part du Professionnel',
  'Part de la Clinique MANA',
] as const

/** The consultations' row: the first tier of the grid. */
export const CONSULTATION_LABEL =
  'Consultation (individuelles, de couple et familiales)'

/** The other kinds' rows, by kind key (`compensation_kinds`); another kind reads its name. */
const OTHER_LABELS: Record<string, string> = {
  workshop: 'Ateliers, conférences et formations',
  late_cancellation: 'Annulation tardive ou absence non motivée*',
  other_fees: 'Autres frais administratifs',
}

const TO_CONFIRM = 'À confirmer'

/** One row of the table: the service, the professional's share, the clinic's. */
export interface AnnexeRow {
  label: string
  professional: string
  clinic: string
}

/** The rows of « Partage des honoraires » for these terms (module comment). */
export function annexeRows(terms: AnnexeTerms): AnnexeRow[] {
  const first = terms.tiers.reduce((low, t) => (t.from < low.from ? t : low))
  const row = (label: string, retention: number | null): AnnexeRow =>
    retention === null
      ? { label, professional: TO_CONFIRM, clinic: TO_CONFIRM }
      : {
        label,
        professional: percent(100 - retention),
        clinic: percent(retention),
      }
  return [
    row(CONSULTATION_LABEL, first.retention_pct),
    ...terms.other.map((o) =>
      row(OTHER_LABELS[o.kind] ?? o.name, o.retention_pct)
    ),
  ]
}

/** The blocks of Annexe A for these terms: one table (module comment). */
export function annexeBlocks(terms: AnnexeTerms): Block[] {
  return [{
    type: 'table',
    columns: [
      { label: ANNEXE_COLUMNS[0], width: 50 },
      { label: ANNEXE_COLUMNS[1], width: 25 },
      { label: ANNEXE_COLUMNS[2], width: 25 },
    ],
    rows: annexeRows(terms).map((
      r,
    ) => [r.label, r.professional, r.clinic]),
  }]
}

/** One line of the preview's summary: « Consultation (…) » → « Professionnel 70 % · Clinique 30 % ». */
export interface SummaryLine {
  label: string
  value: string
}

/**
 * The main values Annexe A prints, for the preview's side panel (P4-502):
 * the profession (whose grid gives the consultations' share), then each row
 * of the table. The same words as `annexeBlocks`, from the same terms.
 */
export function annexeSummary(terms: AnnexeTerms): SummaryLine[] {
  return [
    { label: 'Profession', value: terms.title_label },
    ...annexeRows(terms).map((r) => ({
      label: r.label,
      value: r.professional === TO_CONFIRM
        ? TO_CONFIRM
        : `Professionnel ${r.professional} · Clinique ${r.clinic}`,
    })),
  ]
}
