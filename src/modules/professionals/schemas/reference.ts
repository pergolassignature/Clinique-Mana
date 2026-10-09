import { z } from 'zod'
import { t } from '@/i18n'
import {
  DOCUMENT_EXPIRY_RULES,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_PURPOSE_MAX_BYTES,
  DOCUMENT_TYPE_MIN_BYTES,
  MOTIF_CATEGORY_ICONS,
  PHOTO_MIME_TYPES,
  type MotifCategoryIcon,
  type ReferenceKind,
} from '../lib/constants'
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
  reminderDays: t('modules.professionals.validation.reminderDays'),
  remindersNeedExpiry: t('modules.professionals.validation.remindersNeedExpiry'),
  acceptedMime: t('modules.professionals.validation.acceptedMime'),
  photoMime: t('modules.professionals.validation.photoMime'),
  maxBytes: t('modules.professionals.validation.maxBytes'),
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

/** A title's feminine or masculine form (P4-340): optional, blank = the name; 1–120, tidy. */
const titleForm = () => tidyText({ max: 120 })

const titleSchema = z.object({
  name: name(),
  nameFeminine: titleForm(),
  nameMasculine: titleForm(),
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

/**
 * « Rappels » as typed: up to three whole numbers of days (1–90) separated by commas or spaces
 * (« 30, 7 »); empty = none. Stored distinct, largest first, as `save_document_type` does.
 */
export function parseReminderDays(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter((p) => p !== '')
  if (parts.length > 3 || parts.some((p) => !/^[0-9]{1,2}$/.test(p))) return null
  const days = [...new Set(parts.map(Number))].sort((a, b) => b - a)
  return days.every((d) => d >= 1 && d <= 90) ? days : null
}

/**
 * A document type (« Documents requis », save_document_type): reminders only for the insurance and
 * with an expiry rule (P4-402); at least one accepted file type, the photo JPEG or PNG only; a size
 * between 100 Ko and 10 Mo. `key` is the row's (null when adding: a new type is never the insurance).
 */
const documentTypeSchema = (key: string | null) =>
  z
    .object({
      name: name(),
      required: z.boolean(),
      expiryRule: z.enum(DOCUMENT_EXPIRY_RULES),
      reminderDays: z.string(),
      weeklyAfterExpiry: z.boolean(),
      acceptedMime: z.array(z.enum(DOCUMENT_MIME_TYPES)),
      maxBytes: z.string(),
    })
    .transform((v, ctx) => {
      const insurance = key === 'insurance'
      const days = insurance ? parseReminderDays(v.reminderDays) : []
      if (days === null) ctx.addIssue({ code: 'custom', path: ['reminderDays'], message: M.reminderDays })
      const weekly = insurance && v.weeklyAfterExpiry
      if (insurance && v.expiryRule === 'none' && ((days?.length ?? 0) > 0 || weekly)) {
        ctx.addIssue({ code: 'custom', path: ['expiryRule'], message: M.remindersNeedExpiry })
      }
      if (v.acceptedMime.length === 0) ctx.addIssue({ code: 'custom', path: ['acceptedMime'], message: M.acceptedMime })
      else if (key === 'photo' && v.acceptedMime.some((m) => !PHOTO_MIME_TYPES.includes(m))) {
        ctx.addIssue({ code: 'custom', path: ['acceptedMime'], message: M.photoMime })
      }
      const bytes = Number(v.maxBytes)
      if (!Number.isInteger(bytes) || bytes < DOCUMENT_TYPE_MIN_BYTES || bytes > DOCUMENT_PURPOSE_MAX_BYTES) {
        ctx.addIssue({ code: 'custom', path: ['maxBytes'], message: M.maxBytes })
      }
      return {
        name: v.name,
        required: v.required,
        expiryRule: v.expiryRule,
        reminderDays: days ?? [],
        weeklyAfterExpiry: weekly,
        // In the order of the list (the RPC sorts them too).
        acceptedMime: DOCUMENT_MIME_TYPES.filter((m) => v.acceptedMime.includes(m)),
        maxBytes: bytes,
      }
    })

/** The dialogs' form values: strings for text and numbers, booleans for switches. */
export interface ReferenceFormValues {
  professional_orders: { name: string; acronym: string; licenceLabel: string; licencePattern: string }
  profession_categories: { name: string }
  profession_titles: { name: string; nameFeminine: string; nameMasculine: string; categoryId: string; orderId: string }
  clienteles: { name: string; minAge: string; maxAge: string }
  motif_categories: { name: string; description: string; icon: string }
  motifs: { name: string; categoryId: string; isRestricted: boolean }
  languages: { name: string; code: string }
  deactivation_reasons: { name: string; requiresNote: boolean; disablesAccount: boolean }
  /** `reminderDays` as typed (« 30, 7 »), `maxBytes` the chosen size in bytes. */
  document_types: {
    name: string
    required: boolean
    expiryRule: (typeof DOCUMENT_EXPIRY_RULES)[number]
    reminderDays: string
    weeklyAfterExpiry: boolean
    acceptedMime: (typeof DOCUMENT_MIME_TYPES)[number][]
    maxBytes: string
  }
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
  // A new type's schema; editing a system type goes through `documentTypeSchema(row.key)` (referenceSchema).
  document_types: documentTypeSchema(null),
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
  // A document type's rules depend on which one it is (the insurance's reminders, the photo's types).
  const schema = kind === 'document_types' ? documentTypeSchema((current as ReferenceRow<'document_types'> | null)?.key ?? null) : referenceSchemas[kind]
  const base = schema as unknown as z.ZodType<ReferenceFields<K>, ReferenceFormValues[K]>
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
  profession_titles: (r) => ({
    name: r?.name ?? '',
    nameFeminine: r?.nameFeminine ?? '',
    nameMasculine: r?.nameMasculine ?? '',
    categoryId: r?.categoryId ?? '',
    orderId: r?.orderId ?? '',
  }),
  clienteles: (r) => ({ name: r?.name ?? '', minAge: str(r?.minAge ?? null), maxAge: str(r?.maxAge ?? null) }),
  motif_categories: (r) => ({ name: r?.name ?? '', description: r?.description ?? '', icon: r?.icon ?? DEFAULT_ICON }),
  motifs: (r) => ({ name: r?.name ?? '', categoryId: r?.categoryId ?? '', isRestricted: r?.isRestricted ?? false }),
  languages: (r) => ({ name: r?.name ?? '', code: r?.code ?? '' }),
  deactivation_reasons: (r) => ({ name: r?.name ?? '', requiresNote: r?.requiresNote ?? false, disablesAccount: r?.disablesAccount ?? false }),
  // A new type: optional, no expiry, every file type, 10 Mo (save_document_type's defaults).
  document_types: (r) => ({
    name: r?.name ?? '',
    required: r?.required ?? false,
    expiryRule: r?.expiryRule ?? 'none',
    reminderDays: r ? r.reminderDays.join(', ') : '',
    weeklyAfterExpiry: r?.weeklyAfterExpiry ?? false,
    acceptedMime: r ? [...r.acceptedMime] : [...DOCUMENT_MIME_TYPES],
    maxBytes: String(r?.maxBytes ?? DOCUMENT_PURPOSE_MAX_BYTES),
  }),
}

/** A dialog's starting values: the row being edited, or a new row's defaults (`row` null). */
export function toReferenceFormValues<K extends ReferenceKind>(kind: K, row: ReferenceRow<K> | null): ReferenceFormValues[K] {
  const toForm = TO_FORM[kind] as (row: ReferenceRow<K> | null) => ReferenceFormValues[K]
  return toForm(row)
}
