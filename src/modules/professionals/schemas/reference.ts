import { z } from 'zod'
import { t } from '@/i18n'
import { MOTIF_CATEGORY_ICONS, type MotifCategoryIcon, type ReferenceKind } from '../lib/constants'
import type { ReferenceFields, ReferenceRow } from '../api/catalog'
import { tidy, tidyText } from './text'

/**
 * The settings lists' dialogs (4a.6–4a.9), one schema per list, as the `save_*` RPCs check them
 * (20261008084945_professionals_reference_settings.sql): names 1–120, tidy; an acronym and a
 * language code normalised as typed; ages 0–120 with max ≥ min and no max without a min. The
 * output is what `saveReference(kind, { id, ...output })` sends.
 */

const M = {
  nameRequired: t('modules.professionals.validation.nameRequired'),
  nameTooLong: t('modules.professionals.validation.nameTooLong'),
  acronym: t('modules.professionals.validation.acronym'),
  licenceLabelTooLong: t('modules.professionals.validation.licenceLabelTooLong'),
  licencePatternTooLong: t('modules.professionals.validation.licencePatternTooLong'),
  licencePattern: t('modules.professionals.validation.licencePattern'),
  categoryRequired: t('modules.professionals.validation.categoryRequired'),
  ages: t('modules.professionals.validation.ages'),
  maxAgeNeedsMin: t('modules.professionals.validation.maxAgeNeedsMin'),
  maxAgeBelowMin: t('modules.professionals.validation.maxAgeBelowMin'),
  descriptionTooLong: t('modules.professionals.validation.descriptionTooLong'),
  icon: t('modules.professionals.validation.icon'),
  languageCode: t('modules.professionals.validation.languageCode'),
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
  licencePattern: tidyText({ max: 200, tooLongMessage: M.licencePatternTooLong, fold: false }).refine((v) => v === null || isReadablePattern(v), {
    error: M.licencePattern,
  }),
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
  /** '' = « Autres » (no category). */
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
  specialties: { name: string }
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
  specialties: nameOnlySchema,
  motif_categories: motifCategorySchema,
  motifs: motifSchema,
  languages: languageSchema,
  deactivation_reasons: deactivationReasonSchema,
} as const satisfies { [K in ReferenceKind]: z.ZodType<ReferenceFields<K>, ReferenceFormValues[K]> }

const str = (v: string | number | null) => (v === null ? '' : String(v))
/** The icon of a new category: the column's default. */
const DEFAULT_ICON: MotifCategoryIcon = 'Brain'

const TO_FORM: { [K in ReferenceKind]: (row: ReferenceRow<K> | null) => ReferenceFormValues[K] } = {
  professional_orders: (r) => ({ name: r?.name ?? '', acronym: r?.acronym ?? '', licenceLabel: r?.licenceLabel ?? '', licencePattern: r?.licencePattern ?? '' }),
  profession_categories: (r) => ({ name: r?.name ?? '' }),
  profession_titles: (r) => ({ name: r?.name ?? '', categoryId: r?.categoryId ?? '', orderId: r?.orderId ?? '' }),
  clienteles: (r) => ({ name: r?.name ?? '', minAge: str(r?.minAge ?? null), maxAge: str(r?.maxAge ?? null) }),
  specialties: (r) => ({ name: r?.name ?? '' }),
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
