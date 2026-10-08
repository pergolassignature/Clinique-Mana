import { z } from 'zod'
import { t } from '@/i18n'
import type { DeactivationReason } from '../api/parse'

/**
 * Activation and deactivation dialogs (4a.14), as `activate_professional` and
 * `deactivate_professional` (20261008100634) check them.
 */

const NOTE_MAX = 500

/**
 * « Désactiver »: an active reason of the clinic, and a note when that reason requires one.
 * `reasons` is the catalogue's list (archived reasons are not offered).
 */
export function deactivateSchema(reasons: readonly DeactivationReason[]) {
  return z
    .object({
      reasonId: z.string().refine((id) => reasons.some((r) => r.id === id && r.isActive), { error: t('modules.professionals.validation.reasonRequired') }),
      note: z
        .string()
        .trim()
        .max(NOTE_MAX, { error: t('modules.professionals.validation.noteMax') })
        .transform((v) => (v === '' ? null : v)),
    })
    .superRefine((v, ctx) => {
      if (v.note === null && reasons.find((r) => r.id === v.reasonId)?.requiresNote) {
        ctx.addIssue({ code: 'custom', path: ['note'], message: t('modules.professionals.validation.noteRequired') })
      }
    })
}
export type DeactivateValues = z.input<ReturnType<typeof deactivateSchema>>

/** « Activer quand même » (`professionals.activate_override`): why an incomplete file is activated. */
export const overrideSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { error: t('modules.professionals.validation.overrideReason') })
    .max(NOTE_MAX, { error: t('modules.professionals.validation.overrideReasonMax') }),
})
export type OverrideValues = z.input<typeof overrideSchema>
