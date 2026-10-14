import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { Loading } from '@/shared/components/LoadState'
import { formatClinicDateFull, formatClinicTime } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { DateField } from '@/shared/ui/date-field'
import type { SeriesDate } from '../api/parse'
import { weekdayLabel } from '../lib/display'
import type { SeriesDraft } from '../lib/series'

const S = 'modules.appointments.editor.series'

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
const INTERVALS = Array.from({ length: 12 }, (_, i) => i + 1)

/**
 * « Répéter » in « Nouveau rendez-vous »: the rule, then every date with its conflict
 * (« Déjà un rendez-vous », « Hors disponibilités ») read from the database before booking; dates
 * in conflict are booked only once « Ignorer … » is ticked (they are then skipped and kept on
 * the series).
 */
export function SeriesFields({
  draft,
  onChange,
  preview,
  loading,
}: {
  draft: SeriesDraft
  onChange: (draft: SeriesDraft) => void
  preview: readonly SeriesDate[] | undefined
  loading: boolean
}) {
  const set = (patch: Partial<SeriesDraft>) => onChange({ ...draft, ...patch, skipConflicts: false })
  const conflicts = preview?.filter((d) => d.conflict !== null).length ?? 0
  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-label={t(`${S}.title`)}>
      <CheckboxField label={t(`${S}.repeat`)} checked={draft.repeat} onCheckedChange={(repeat) => set({ repeat })} />
      {draft.repeat && (
        <>
          <FormRow>
            <FormField label={t(`${S}.interval`)} width="sm">
              {(field) => (
                <Select {...field} value={String(draft.intervalWeeks)} onChange={(e) => set({ intervalWeeks: Number(e.target.value) })}>
                  {INTERVALS.map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? t(`${S}.everyWeek`) : t(`${S}.everyNWeeks`, { n: String(n) })}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t(`${S}.end`)} width="sm">
              {(field) => (
                <Select {...field} value={draft.endKind} onChange={(e) => set({ endKind: e.target.value as SeriesDraft['endKind'] })}>
                  <option value="count">{t(`${S}.endCount`)}</option>
                  <option value="until">{t(`${S}.endUntil`)}</option>
                </Select>
              )}
            </FormField>
            {draft.endKind === 'count' ? (
              <FormField label={t(`${S}.count`)} width="xs" help={t(`${S}.countHelp`)}>
                {(field) => <Input {...field} type="number" min={2} max={52} value={draft.count} onChange={(e) => set({ count: e.target.value })} />}
              </FormField>
            ) : (
              <FormField label={t(`${S}.until`)} width="sm">
                {(field) => <DateField {...field} value={draft.until} onChange={(until) => set({ until })} />}
              </FormField>
            )}
          </FormRow>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t(`${S}.weekdays`)}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {WEEKDAYS.map((d) => (
                <CheckboxField
                  key={d}
                  label={weekdayLabel(d)}
                  checked={draft.weekdays.includes(d)}
                  onCheckedChange={(on) => set({ weekdays: on ? [...draft.weekdays, d].sort() : draft.weekdays.filter((x) => x !== d) })}
                />
              ))}
            </div>
          </fieldset>
          {loading && !preview ? (
            <Loading />
          ) : preview && preview.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm">
                {conflicts === 0
                  ? t(`${S}.summaryFree`, { count: String(preview.length) })
                  : t(`${S}.summaryConflicts`, { count: String(preview.length), conflicts: String(conflicts) })}
              </p>
              <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm" aria-label={t(`${S}.dates`)}>
                {preview.map((d) => (
                  <li key={d.occurrence} className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className={d.conflict ? 'text-muted-foreground line-through' : undefined}>
                      {formatClinicDateFull(d.startsAt)}, {formatClinicTime(d.startsAt)}
                    </span>
                    {d.conflict ? <Badge variant="warning">{t(`${S}.conflict.${d.conflict}`)}</Badge> : <Badge variant="outline">{t(`${S}.free`)}</Badge>}
                  </li>
                ))}
              </ul>
              {conflicts > 0 && (
                <CheckboxField
                  label={t(`${S}.skip`, { conflicts: String(conflicts) })}
                  help={t(`${S}.skipHelp`)}
                  checked={draft.skipConflicts}
                  onCheckedChange={(skipConflicts) => onChange({ ...draft, skipConflicts })}
                />
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
