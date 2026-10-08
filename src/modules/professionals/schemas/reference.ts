import { z } from 'zod'
import { t } from '@/i18n'
import { MOTIF_CATEGORY_ICONS, type MotifCategoryIcon, type ReferenceKind } from '../lib/constants'
import { hasPostgresOnlySyntax } from '../lib/licence-pattern'
import type { ReferenceFields, ReferenceRow } from '../api/catalog'
import { tidy, tidyText } from './text'

/**
 * The settings lists' dialogs (4a.6–4a.9), one schema per list, as the `save_*` RPCs check them
 * (20261008084945_professionals_reference_settings.sql): names 1–120, tidy; an acronym and a
 * language code normalised as typed; ages 0–120 with max ≥ min and no max without a min. The
 * output is what `saveReference(kind, { id, ...output })` sends. `referenceSchema(kind, …)` adds
 * the checks that need the list: a name already taken (NFKC, ignoring case), a system clientèle
 * keeping its kind, « Autre » keeping its note. The RPCs stay authoritative (a concurrent save).
 */

const M = {
  nameRequired: t('modules.professionals.validation.nameRequired'),
  nameTooLong: t('modules.professionals.validation.nameTooLong'),
  acronym: t('modules.professionals.validation.acronym'),
  licenceLabelTooLong: t('modules.professionals.validation.licenceLabelTooLong'),
  licencePatternTooLong: t('modules.professionals.validation.licencePatternTooLong'),
  licencePattern: t('modules.professionals.validation.licencePattern'),
  licencePatternSyntax: t('modules.professionals.validation.licencePatternSyntax'),
  categoryRequired: t('modules.professionals.validation.categoryRequired'),
  ages: t('modules.professionals.validation.ages'),
  maxAgeNeedsMin: t('modules.professionals.validation.maxAgeNeedsMin'),
  maxAgeBelowMin: t('modules.professionals.validation.maxAgeBelowMin'),
  descriptionTooLong: t('modules.professionals.validation.descriptionTooLong'),
  icon: t('modules.professionals.validation.icon'),
  languageCode: t('modules.professionals.validation.languageCode'),
  clienteleKind: t('modules.professionals.validation.clienteleKind'),
  otherReasonNote: t('modules.professionals.validation.otherReasonNote'),
} as const

const name = () => tidyText({ max: 120, requiredMessage: M.nameRequired, tooLongMessage: M.nameTooLong })
const emptyToNull = (v: string) => (v === '' ? null : v)

/** Whether a JavaScript engine can read the pattern; the database checks its own dialect again. */
function isReadablePattern(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

const age = () =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^[0-9]{1,3}$/.test(v) && Number(v) <= 120), { error: M.ages })
    .transform((v) => (v === '' ? null : Number(v)))

const orderSchema = z.object({
  name: name(),
  acronym: z
    .string()
    .transform((v) => tidy(v).toUpperCase())
    .refine((v) => /^[A-Z]{2,10}$/.test(v), { error: M.acronym }),
  licenceLabel: tidyText({ max: 60, tooLongMessage: M.licenceLabelTooLong }),
  licencePattern: tidyText({ max: 200, tooLongMessage: M.licencePatternTooLong, fold: false })
    // The licence checks run the format in the browser too: refuse what the two dialects read
    // differently (PostgreSQL may accept it), then what JavaScript cannot read at all.
    .refine((v) => v === null || !hasPostgresOnlySyntax(v), { error: M.licencePatternSyntax, abort: true })
    .refine((v) => v === null || isReadablePattern(v), { error: M.licencePattern }),
})

const nameOnlySchema = z.object({ name: name() })

const titleSchema = z.object({
  name: name(),
  categoryId: z.string().min(1, { error: M.categoryRequired }),
  /** '' = « Aucun ordre » (not regulated: no licence required). */
  orderId: z.string().transform(emptyToNull),
})

const clienteleSchema = z
  .object({ name: name(), minAge: age(), maxAge: age() })
  .superRefine((v, ctx) => {
    if (v.maxAge === null) return
    if (v.minAge === null) ctx.addIssue({ code: 'custom', path: ['maxAge'], message: M.maxAgeNeedsMin })
    else if (v.maxAge < v.minAge) ctx.addIssue({ code: 'custom', path: ['maxAge'], message: M.maxAgeBelowMin })
  })

const motifCategorySchema = z.object({
  name: name(),
  description: tidyText({ max: 300, tooLongMessage: M.descriptionTooLong }),
  icon: z.enum(MOTIF_CATEGORY_ICONS, { error: M.icon }),
})

const motifSchema = z.object({
  name: name(),
  /** '' = « Sans catégorie » (no category). */
  categoryId: z.string().transform(emptyToNull),
  isRestricted: z.boolean(),
})

const languageSchema = z.object({
  name: name(),
  code: z
    .string()
    .transform((v) => tidy(v).toLowerCase())
    .refine((v) => /^[a-z]{2}$/.test(v), { error: M.languageCode }),
})

const deactivationReasonSchema = z.object({ name: name(), requiresNote: z.boolean(), disablesAccount: z.boolean() })

/** The dialogs' form values: strings for text and numbers, booleans for switches. */
export interface ReferenceFormValues {
  professional_orders: { name: string; acronym: string; licenceLabel: string; licencePattern: string }
  profession_categories: { name: string }
  profession_titles: { name: string; categoryId: string; orderId: string }
  clienteles: { name: string; minAge: string; maxAge: string }
  motif_categories: { name: string; description: string; icon: string }
  motifs: { name: string; categoryId: string; isRestricted: boolean }
  languages: { name: string; code: string }
  deactivation_reasons: { name: string; requiresNote: boolean; disablesAccount: boolean }
}

/** Each list's schema: form values in, the save RPC's fields out. */
export const referenceSchemas = {
  professional_orders: orderSchema,
  profession_categories: nameOnlySchema,
  profession_titles: titleSchema,
  clienteles: clienteleSchema,
  motif_categories: motifCategorySchema,
  motifs: motifSchema,
  languages: languageSchema,
  deactivation_reasons: deactivationReasonSchema,
} as const satisfies { [K in ReferenceKind]: z.ZodType<ReferenceFields<K>, ReferenceFormValues[K]> }

/** The duplicate comparison of the save RPCs and the unique indexes: lower(normalize(name, NFKC)). */
const nameKey = (name: string) => name.normalize('NFKC').toLowerCase()

/** The row being edited (null for a new one) and the list it belongs to, archived rows included. */
export interface ReferenceContext<K extends ReferenceKind> {
  rows: readonly ReferenceRow<K>[]
  current: ReferenceRow<K> | null
}

type SystemRule<K extends ReferenceKind> = (value: ReferenceFields<K>, row: ReferenceRow<K>, ctx: z.RefinementCtx) => void

/** What a system row keeps (P4-42): matching relies on a clientèle's kind, « Autre » says nothing without a note. */
const SYSTEM_RULES: { [K in ReferenceKind]?: SystemRule<K> } = {
  clienteles: (value, row, ctx) => {
    if ((row.minAge === null) !== (value.minAge === null)) ctx.addIssue({ code: 'custom', path: ['minAge'], message: M.clienteleKind })
  },
  deactivation_reasons: (value, row, ctx) => {
    if (row.key === 'other' && !value.requiresNote) ctx.addIssue({ code: 'custom', path: ['requiresNote'], message: M.otherReasonNote })
  },
}

/**
 * A dialog's schema: `referenceSchemas[kind]` plus the checks against the list. A name another
 * row holds (archived included) gets the RPC's message.
 */
export function referenceSchema<K extends ReferenceKind>(kind: K, { rows, current }: ReferenceContext<K>): z.ZodType<ReferenceFields<K>, ReferenceFormValues[K]> {
  const base = referenceSchemas[kind] as unknown as z.ZodType<ReferenceFields<K>, ReferenceFormValues[K]>
  const systemRule = SYSTEM_RULES[kind] as SystemRule<K> | undefined
  const taken = new Set(rows.filter((r) => r.id !== current?.id).map((r) => nameKey(r.name)))
  return base.superRefine((value, ctx) => {
    if (taken.has(nameKey(value.name))) ctx.addIssue({ code: 'custom', path: ['name'], message: t(`modules.professionals.validation.nameTaken.${kind}`) })
    if (current?.isSystem && systemRule) systemRule(value, current, ctx)
  })
}

const str = (v: string | number | null) => (v === null ? '' : String(v))
/** The icon of a new category: the column's default. */
const DEFAULT_ICON: MotifCategoryIcon = 'Brain'

const TO_FORM: { [K in ReferenceKind]: (row: ReferenceRow<K> | null) => ReferenceFormValues[K] } = {
  professional_orders: (r) => ({ name: r?.name ?? '', acronym: r?.acronym ?? '', licenceLabel: r?.licenceLabel ?? '', licencePattern: r?.licencePattern ?? '' }),
  profession_categories: (r) => ({ name: r?.name ?? '' }),
  profession_titles: (r) => ({ name: r?.name ?? '', categoryId: r?.categoryId ?? '', orderId: r?.orderId ?? '' }),
  clienteles: (r) => ({ name: r?.name ?? '', minAge: str(r?.minAge ?? null), maxAge: str(r?.maxAge ?? null) }),
  motif_categories: (r) => ({ name: r?.name ?? '', description: r?.description ?? '', icon: r?.icon ?? DEFAULT_ICON }),
  motifs: (r) => ({ name: r?.name ?? '', categoryId: r?.categoryId ?? '', isRestricted: r?.isRestricted ?? false }),
  languages: (r) => ({ name: r?.name ?? '', code: r?.code ?? '' }),
  deactivation_reasons: (r) => ({ name: r?.name ?? '', requiresNote: r?.requiresNote ?? false, disablesAccount: r?.disablesAccount ?? false }),
}

/** A dialog's starting values: the row being edited, or a new row's defaults (`row` null). */
export function toReferenceFormValues<K extends ReferenceKind>(kind: K, row: ReferenceRow<K> | null): ReferenceFormValues[K] {
  const toForm = TO_FORM[kind] as (row: ReferenceRow<K> | null) => ReferenceFormValues[K]
  return toForm(row)
}
