import { z } from 'zod'
import { t } from '@/i18n'
import { rpcErrorCode, rpcErrorDetail, rpcErrorHint } from '@/core/modules/errors'
import { titleOrder, type CatalogView } from '../lib/catalog-view'
import { hasPostgresOnlySyntax } from '../lib/licence-pattern'
import type { ProfessionInput } from '../api/record'
import type { ProfessionRow } from '../api/parse'

/**
 * Titles and licences, as `set_professional_professions` and `professional_professions_guard`
 * (20261008133537) check them: at most two titles, each once, one primary (the first when none is
 * flagged), a licence when the title belongs to an order, in that order's format; a title archived
 * since may stay, never be added; the last regulated title stays while restricted motifs are held.
 */

/** `professional_professions_licence_number_check`. */
const LICENCE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$/

/** A licence number: trimmed, empty → null, letters, digits, spaces and dashes (30 at most). */
export const licenceNumberField = () =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || LICENCE.test(v), { error: t('modules.professionals.validation.licenceFormat') })
    .transform((v) => (v === '' ? null : v))

/**
 * Whether `licence` fits the order's format. The format is a PostgreSQL regular expression; one
 * JavaScript cannot read, or would read differently (`hasPostgresOnlySyntax`), is left to the
 * database (true here).
 */
export function matchesOrderPattern(pattern: string | null, licence: string): boolean {
  if (pattern === null || hasPostgresOnlySyntax(pattern)) return true
  try {
    return new RegExp(pattern).test(licence)
  } catch {
    return true
  }
}

/**
 * The licence rules of one title, as issues on `path`: required for a regulated title, in the
 * order's format. Shared with the creation dialog.
 */
export function checkLicence(catalog: CatalogView, titleId: string, licence: string | null, ctx: z.RefinementCtx, path: (string | number)[]): void {
  const order = titleOrder(catalog, titleId)
  if (!order) return
  if (licence === null) {
    ctx.addIssue({ code: 'custom', path, message: t('modules.professionals.validation.licenceRequired') })
  } else if (!matchesOrderPattern(order.licencePattern, licence)) {
    const title = catalog.byId.titles.get(titleId)?.name ?? ''
    ctx.addIssue({ code: 'custom', path, message: t('modules.professionals.validation.licenceOrderFormat', { title }) })
  }
}

/** One row of the « Professions et permis » editor. */
export const professionItemSchema = z.object({
  titleId: z.string().min(1, { error: t('modules.professionals.validation.titleRequired') }),
  licenceNumber: licenceNumberField(),
  isPrimary: z.boolean(),
})
export type ProfessionItemValues = z.input<typeof professionItemSchema>

interface ProfessionsContext {
  /** The titles the professional holds now: an archived one may stay. */
  heldTitleIds: readonly string[]
  /** The motifs held now: restricted ones need a regulated title to remain. */
  heldMotifIds: readonly string[]
}

/** The whole list, validated against the catalogue; output: what `setProfessions` sends. */
export function professionsSchema(catalog: CatalogView, { heldTitleIds, heldMotifIds }: ProfessionsContext) {
  return z
    .array(professionItemSchema)
    .max(2, { error: t('modules.professionals.validation.professionsMax') })
    .superRefine((items, ctx) => {
      const seen = new Set<string>()
      items.forEach((item, i) => {
        if (seen.has(item.titleId)) ctx.addIssue({ code: 'custom', path: [i, 'titleId'], message: t('modules.professionals.validation.titleRepeated') })
        seen.add(item.titleId)
        const title = catalog.byId.titles.get(item.titleId)
        if (title && !title.isActive && !heldTitleIds.includes(item.titleId)) {
          ctx.addIssue({ code: 'custom', path: [i, 'titleId'], message: t('modules.professionals.validation.titleArchived') })
        }
        checkLicence(catalog, item.titleId, item.licenceNumber, ctx, [i, 'licenceNumber'])
      })
      if (items.filter((i) => i.isPrimary).length > 1) ctx.addIssue({ code: 'custom', message: t('modules.professionals.validation.onePrimary') })

      const regulated = items.some((i) => titleOrder(catalog, i.titleId) !== null)
      const restricted = heldMotifIds.flatMap((id) => {
        const motif = catalog.byId.motifs.get(id)
        return motif?.isRestricted ? [motif.name] : []
      })
      if (!regulated && restricted.length > 0) {
        ctx.addIssue({ code: 'custom', message: t('modules.professionals.validation.restrictedMotifsHeld', { names: restricted.join(', ') }) })
      }
    })
    .transform((items): ProfessionInput[] => {
      const primary = Math.max(0, items.findIndex((i) => i.isPrimary))
      return items.map((i, index) => ({ titleId: i.titleId, licenceNumber: i.licenceNumber, isPrimary: index === primary }))
    })
}

/** The editor's rows from the record (primary first, as the RPC returns them). */
export function toProfessionItems(professions: readonly ProfessionRow[]): ProfessionItemValues[] {
  return professions.map((p) => ({ titleId: p.titleId, licenceNumber: p.licenceNumber ?? '', isPrimary: p.isPrimary }))
}

/** A field of the editor's rows. */
export type ProfessionErrorField = `items.${number}.titleId` | `items.${number}.licenceNumber`

/**
 * Where a refusal of `set_professional_professions` belongs: under the field its HINT names
 * (`title`, `licence`), on the row of the title its DETAIL names (the last one, for a title chosen
 * twice); null (above the buttons) for a refusal about the whole list or a title no row holds.
 * P0001 only, the messages users read; never by the wording.
 */
export function professionsErrorField(error: unknown, items: readonly { titleId: string }[]): ProfessionErrorField | null {
  if (rpcErrorCode(error) !== 'P0001') return null
  const hint = rpcErrorHint(error)
  const field = hint === 'title' ? 'titleId' : hint === 'licence' ? 'licenceNumber' : null
  const titleId = rpcErrorDetail(error)
  if (!field || !titleId) return null
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]?.titleId === titleId) return `items.${index}.${field}`
  }
  return null
}
