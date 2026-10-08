import { z } from 'zod'
import { t } from '@/i18n'
import { AVAILABILITY_PERIODS, MAX_SET_SIZE, type AvailabilityPeriod } from '../lib/constants'
import { titleOrder, type CatalogView } from '../lib/catalog-view'
import type { MatchingProfile, ProfessionRow, SpecializedRef } from '../api/parse'
import { longText } from './text'

/**
 * « Jumelage » (`professionals.matching`), as the set RPCs and
 * `professional_matching_profiles_*_check` check it (20261008092451_professionals_core.sql).
 * A row archived since may stay where it is, never be added; at most 500 items.
 */

// --- Disponibilités générales (P4-4) -------------------------------------------------------------

/** Flat form values (so `useSettingsForm` compares them), out as the matching profile's columns. */
export const availabilitySchema = z
  .object({
    am: z.boolean(),
    pm: z.boolean(),
    evening: z.boolean(),
    weekend: z.boolean(),
    acceptingNewClients: z.boolean(),
    note: longText(500),
  })
  .transform((v) => ({
    availabilityPeriods: AVAILABILITY_PERIODS.filter((p) => v[p]) as AvailabilityPeriod[],
    acceptingNewClients: v.acceptingNewClients,
    availabilityNote: v.note,
  }))
export type AvailabilityValues = z.input<typeof availabilitySchema>

export function toAvailabilityFormValues(m: MatchingProfile): AvailabilityValues {
  const held = new Set(m.availabilityPeriods)
  return {
    am: held.has('am'),
    pm: held.has('pm'),
    evening: held.has('evening'),
    weekend: held.has('weekend'),
    acceptingNewClients: m.acceptingNewClients,
    note: m.availabilityNote ?? '',
  }
}

// --- Sets ----------------------------------------------------------------------------------------

const tooMany = () => t('modules.professionals.validation.tooMany')

/** An issue for each id that is archived and not already held (`message` gets the row's name). */
function refuseNewArchived(
  ids: readonly string[],
  rows: ReadonlyMap<string, { name: string; isActive: boolean }>,
  heldIds: readonly string[],
  message: (name: string) => string,
  ctx: z.RefinementCtx,
): void {
  const row = ids.map((id) => (heldIds.includes(id) ? undefined : rows.get(id))).find((r) => r !== undefined && !r.isActive)
  if (row) ctx.addIssue({ code: 'custom', message: message(row.name) })
}

/** Whether one of the held titles belongs to an order (what restricted motifs need, P4-16). */
export function holdsRegulatedTitle(professions: readonly Pick<ProfessionRow, 'titleId'>[], catalog: CatalogView): boolean {
  return professions.some((p) => titleOrder(catalog, p.titleId) !== null)
}

/** Motifs: no new archived motif; a restricted one only with a regulated title. */
export function motifIdsSchema(catalog: CatalogView, { heldIds, hasRegulatedTitle }: { heldIds: readonly string[]; hasRegulatedTitle: boolean }) {
  return z
    .array(z.string())
    .max(MAX_SET_SIZE, { error: tooMany() })
    .superRefine((ids, ctx) => {
      refuseNewArchived(ids, catalog.byId.motifs, heldIds, (name) => t('modules.professionals.validation.motifArchived', { name }), ctx)
      const restricted = hasRegulatedTitle ? undefined : ids.map((id) => catalog.byId.motifs.get(id)).find((m) => m?.isRestricted)
      if (restricted) ctx.addIssue({ code: 'custom', message: t('modules.professionals.validation.motifRestricted', { name: restricted.name }) })
    })
}

/** Languages: at least one, no new archived language. */
export function languageIdsSchema(catalog: CatalogView, { heldIds }: { heldIds: readonly string[] }) {
  return z
    .array(z.string())
    .min(1, { error: t('modules.professionals.validation.languagesRequired') })
    .max(MAX_SET_SIZE, { error: tooMany() })
    .superRefine((ids, ctx) =>
      refuseNewArchived(ids, catalog.byId.languages, heldIds, (name) => t('modules.professionals.validation.languageArchived', { name }), ctx),
    )
}

const specializedItems = () => z.array(z.object({ id: z.string(), specialized: z.boolean() })).max(MAX_SET_SIZE, { error: tooMany() })

/** Clientèles with their « spécialisé » star: no new archived clientèle. */
export function clienteleItemsSchema(catalog: CatalogView, { heldIds }: { heldIds: readonly string[] }): z.ZodType<SpecializedRef[]> {
  return specializedItems().superRefine((items, ctx) =>
    refuseNewArchived(
      items.map((i) => i.id),
      catalog.byId.clienteles,
      heldIds,
      (name) => t('modules.professionals.validation.clienteleArchived', { name }),
      ctx,
    ),
  )
}

/** Approaches with their « spécialisé » star: no new archived approach. */
export function specialtyItemsSchema(catalog: CatalogView, { heldIds }: { heldIds: readonly string[] }): z.ZodType<SpecializedRef[]> {
  return specializedItems().superRefine((items, ctx) =>
    refuseNewArchived(
      items.map((i) => i.id),
      catalog.byId.specialties,
      heldIds,
      (name) => t('modules.professionals.validation.specialtyArchived', { name }),
      ctx,
    ),
  )
}
