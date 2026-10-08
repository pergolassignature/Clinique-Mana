import { useMemo, useRef, type ReactNode } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import type { z } from 'zod'
import { useAccess } from '@/core/access/access-context'
import { t } from '@/i18n'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { Button } from '@/shared/ui/button'
import type { SpecializedRef } from '../../../api/parse'
import type { MutationFeedback } from '../../../hooks/mutation-feedback'
import { useSetClienteles, useSetLanguages, useSetMotifs, useSetSpecialties } from '../../../hooks/use-professional-mutations'
import { fullName } from '../../../lib/display'
import { matchingDigest } from '../../../lib/matching-digest'
import { clienteleGroups, languageGroups, motifGroups, recordSelections, specialtyGroups } from '../../../lib/matching-pickers'
import { clienteleItemsSchema, holdsRegulatedTitle, languageIdsSchema, motifIdsSchema, specialtyItemsSchema } from '../../../schemas/matching'
import { SetPickerSheet, type PickerDraft, type SetPickerSheetProps } from '../../pickers/SetPickerSheet'
import { AvailabilityCard } from '../AvailabilityCard'
import { HeldChips } from '../Chips'
import { MotifsSummary } from '../MotifsSummary'
import { useRecordData } from '../record-context'

const M = 'modules.professionals.record.matching'

/**
 * « Jumelage »: what matching reads, in one curated place. Clientèles, approaches, motifs and
 * languages each show what is held (motifs summarised per category, P4-73) and open a picker
 * sheet that saves the whole set at once; general availability is a form card. Editable with
 * `professionals.matching` (conseillères included); read-only otherwise. Everything comes from
 * the record bundle: the tab makes no request of its own until a save.
 */
export function MatchingTab() {
  const { record, catalog } = useRecordData()
  const canEdit = useAccess().can('professionals.matching')
  const digest = useMemo(() => matchingDigest(record, catalog), [record, catalog])
  const pickers = useMatchingPickers(canEdit)
  return (
    <div className="space-y-5">
      {!canEdit && <ReadOnlyNotice body={t(`${M}.readOnly`)} />}
      <div className="grid gap-5 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <SetCard list="clienteles" picker={pickers?.clienteles}>
            <HeldChips items={digest.clienteles} empty={t(`${M}.clienteles.empty`)} />
          </SetCard>
          <SetCard list="approaches" picker={pickers?.approaches}>
            <HeldChips items={digest.approaches} empty={t(`${M}.approaches.empty`)} />
          </SetCard>
          <SetCard list="motifs" picker={pickers?.motifs}>
            {digest.motifs.selected + digest.motifs.archived.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${M}.motifs.empty`)}</p>
            ) : (
              <div className="text-sm">
                <MotifsSummary summary={digest.motifs} />
              </div>
            )}
          </SetCard>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <SetCard list="languages" picker={pickers?.languages}>
            <HeldChips items={digest.languages} empty={t(`${M}.languages.empty`)} />
          </SetCard>
          <AvailabilityCard record={record} readOnly={!canEdit} />
        </div>
      </div>
    </div>
  )
}

type SetList = 'clienteles' | 'approaches' | 'motifs' | 'languages'
type PickerConfig = Omit<SetPickerSheetProps, 'trigger' | 'title'>

/** One held set: what is held, and « Modifier » opening its picker (none when read-only). */
function SetCard({ list, picker, children }: { list: SetList; picker: PickerConfig | undefined; children: ReactNode }) {
  const title = t(`${M}.${list}.title`)
  return (
    <SettingsCard
      as="section"
      title={title}
      description={t(`${M}.${list}.description`)}
      footer={
        picker && (
          <SetPickerSheet
            title={title}
            trigger={
              <Button type="button" variant="outline" size="sm" aria-label={t(`${M}.${list}.edit`)}>
                {t(`${M}.edit`)}
              </Button>
            }
            {...picker}
          />
        )
      }
    >
      {children}
    </SettingsCard>
  )
}

/**
 * The four pickers' lists, selections and saves, or null without `professionals.matching`. Each
 * save checks the draft with the module's schema (no new archived item, a restricted motif only
 * with a regulated title, at least one language), then calls its set RPC; a refusal stays in the
 * sheet. The mutation hooks write the returned set into the record and refetch it.
 */
function useMatchingPickers(canEdit: boolean): Record<SetList, PickerConfig> | null {
  const { record, catalog } = useRecordData()
  const id = record.professional.id
  const saveClienteles = useSetSave(useSetClienteles)
  const saveSpecialties = useSetSave(useSetSpecialties)
  const saveMotifs = useSetSave(useSetMotifs)
  const saveLanguages = useSetSave(useSetLanguages)
  const regulated = holdsRegulatedTitle(record.professions, catalog)
  const held = useMemo(() => recordSelections(record), [record])
  if (!canEdit) return null

  const subject = fullName(record.professional)
  const starred = (draft: PickerDraft): SpecializedRef[] => [...draft].map(([itemId, { specialized }]) => ({ id: itemId, specialized }))
  return {
    clienteles: {
      subject,
      groups: clienteleGroups(catalog, held.clienteles),
      selected: held.clienteles,
      withStars: true,
      searchPlaceholder: t(`${M}.clienteles.search`),
      onSave: (draft) =>
        checked(clienteleItemsSchema(catalog, { heldIds: [...held.clienteles.keys()] }), starred(draft), (items) => saveClienteles({ id, items })),
    },
    approaches: {
      subject,
      groups: specialtyGroups(catalog, held.specialties),
      selected: held.specialties,
      withStars: true,
      searchPlaceholder: t(`${M}.approaches.search`),
      onSave: (draft) =>
        checked(specialtyItemsSchema(catalog, { heldIds: [...held.specialties.keys()] }), starred(draft), (items) => saveSpecialties({ id, items })),
    },
    motifs: {
      subject,
      groups: motifGroups(catalog, held.motifs, regulated),
      selected: held.motifs,
      searchPlaceholder: t(`${M}.motifs.search`),
      onSave: (draft) =>
        checked(motifIdsSchema(catalog, { heldIds: record.motifIds, hasRegulatedTitle: regulated }), [...draft.keys()], (motifIds) => saveMotifs({ id, motifIds })),
    },
    languages: {
      subject,
      groups: languageGroups(catalog, held.languages),
      selected: held.languages,
      searchPlaceholder: t(`${M}.languages.search`),
      requiredMessage: t('modules.professionals.validation.languagesRequired'),
      onSave: (draft) =>
        checked(languageIdsSchema(catalog, { heldIds: record.languageIds }), [...draft.keys()], (languageIds) => saveLanguages({ id, languageIds })),
    },
  }
}

/** The schema's first message for a refused draft, else the save's outcome. */
function checked<T>(schema: z.ZodType<T>, value: T, save: (value: T) => Promise<string | null>): Promise<string | null> {
  const result = schema.safeParse(value)
  return result.success ? save(result.data) : Promise.resolve(result.error.issues[0]?.message ?? t('modules.professionals.errors.saveFailed'))
}

/**
 * A set mutation as a picker's save: null once saved (the hook toasts « Modifications
 * enregistrées. »), else the user-facing refusal for the sheet (`P0001` as is), never a toast.
 */
function useSetSave<V, R>(useMutationHook: (feedback?: MutationFeedback) => UseMutationResult<R, Error, V>) {
  const refusal = useRef<string | null>(null)
  const mutation = useMutationHook({
    onErrorMessage: (message) => {
      refusal.current = message
    },
  })
  return (variables: V): Promise<string | null> =>
    mutation.mutateAsync(variables).then(
      () => null,
      () => refusal.current ?? t('modules.professionals.errors.saveFailed'),
    )
}
