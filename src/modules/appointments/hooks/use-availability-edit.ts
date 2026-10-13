import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { formatDateOnly } from '@/shared/lib/timezone'
import { toast } from '@/shared/ui/sonner'
import {
  addAvailabilityException,
  deleteAvailabilityRule,
  removeAvailabilityException,
  restoreAvailabilityRule,
  setAvailabilityWindow,
  undoAvailabilityWindow,
  type ExceptionInput,
  type WindowInput,
  type WindowResult,
} from '../api/agenda'
import type { AvailabilityException, AvailabilityRule } from '../api/parse'
import { repeatPhrase, windowPhrase, type Range } from '../lib/availability-edit'
import { addDays, instantOf, isoWeekday, minutesOf } from '../lib/time'
import { appointmentsKeys } from './keys'

const D = 'modules.appointments.availability'
/**
 * An undo stays offered long enough to read the toast, its buttons on a line of their own under
 * the message (two buttons beside it would squeeze the text).
 */
const UNDO_TOAST = {
  duration: 8000,
  classNames: { toast: '!flex-wrap', content: '!min-w-0 !flex-1 !basis-[calc(100%-48px)]', cancelButton: '!ml-7', actionButton: '!ml-7 [[data-cancel]+&]:!ml-2' },
}

/**
 * Availability by direct manipulation (AP-27): what the grid's drops, its popover and the quick
 * exceptions do. Each change is saved at once, then told in a toast with « Annuler » (a new
 * window also offers « Seulement cette semaine »); the database refuses in French (a toast).
 * `weekStart` is the Monday shown.
 */
export function useAvailabilityEditing(professionalId: string | null, weekStart: string) {
  const queryClient = useQueryClient()
  const weekEnd = addDays(weekStart, 6)
  const run = useMutation({
    mutationFn: (job: () => Promise<void>) => job(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: appointmentsKeys.all }),
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      toast.error(moduleErrorMessage(error, t('modules.appointments.errors.saveFailed'), 'appointments'))
    },
  })

  const undo = (job: () => Promise<unknown>) => () => {
    void job()
      .then(() => toast.success(t(`${D}.undone`)))
      .catch(() => toast.error(t(`${D}.undoFailed`)))
      .finally(() => void queryClient.invalidateQueries({ queryKey: appointmentsKeys.all }))
  }

  const announce = (result: WindowResult, input: WindowInput, created: boolean) => {
    const vars = { window: windowPhrase(result.weekday, result), repeat: repeatPhrase(result.validUntil === null) }
    const merged = result.absorbed.length > 0
    const message = t(merged ? `${D}.merged` : created ? `${D}.created` : `${D}.changed`, vars)
    const back = { label: t(`${D}.undo`), onClick: undo(() => undoAvailabilityWindow(result)) }
    if (result.outsideCount > 0) {
      const description = result.outsideCount === 1 ? t(`${D}.outsideOne`) : t(`${D}.outsideOther`, { count: String(result.outsideCount) })
      toast.warning(message, { description, action: back, ...UNDO_TOAST })
    } else if (created && !merged && result.validUntil === null) {
      const thisWeek = () => drop({ ...input, id: result.id, start: result.start, end: result.end, validFrom: weekStart, validUntil: weekEnd }, false)
      toast.success(message, { action: { label: t(`${D}.onlyThisWeek`), onClick: () => void thisWeek() }, cancel: back, ...UNDO_TOAST })
    } else {
      toast.success(message, { action: back, ...UNDO_TOAST })
    }
  }

  const drop = (input: WindowInput, created: boolean) =>
    run.mutateAsync(async () => announce(await setAvailabilityWindow(input), input, created)).catch(() => undefined)

  const block = (day: string, range: Range) =>
    run
      .mutateAsync(async () => {
        if (!professionalId) return
        const input: ExceptionInput = { professionalId, kind: 'other', startsAt: instantOf(day, range.start), endsAt: instantOf(day, range.end), label: null }
        const id = await addAvailabilityException(input)
        toast.success(t(`${D}.blocked`, { window: windowPhrase(isoWeekday(day), range) }), {
          action: { label: t(`${D}.undo`), onClick: undo(() => removeAvailabilityException(id)) },
          ...UNDO_TOAST,
        })
      })
      .catch(() => undefined)

  return {
    busy: run.isPending,
    /** A window drawn on `day`: weekly from the week shown, with the defaults. */
    create: (day: string, range: Range) =>
      professionalId
        ? drop({ id: null, professionalId, weekday: isoWeekday(day), ...range, validFrom: weekStart, validUntil: null, week: weekStart }, true)
        : Promise.resolve(),
    /** A window moved (to `day`) or resized: its validity kept. */
    change: (rule: AvailabilityRule, day: string, range: Range) =>
      drop({ id: rule.id, professionalId: rule.professionalId, weekday: isoWeekday(day), ...range, validFrom: rule.validFrom, validUntil: rule.validUntil, week: weekStart }, false),
    /** « Chaque semaine » / « Seulement cette semaine ». */
    setWeekly: (rule: AvailabilityRule, weekly: boolean) =>
      drop(
        {
          id: rule.id,
          professionalId: rule.professionalId,
          weekday: rule.weekday,
          start: minutesOf(rule.startTime),
          end: minutesOf(rule.endTime),
          validFrom: weekly ? rule.validFrom : weekStart,
          validUntil: weekly ? null : weekEnd,
          week: weekStart,
        },
        false,
      ),
    remove: (rule: AvailabilityRule) =>
      run
        .mutateAsync(async () => {
          await deleteAvailabilityRule(rule.id)
          toast.success(t(`${D}.deleted`, { window: windowPhrase(rule.weekday, { start: minutesOf(rule.startTime), end: minutesOf(rule.endTime) }) }), {
            action: { label: t(`${D}.undo`), onClick: undo(() => restoreAvailabilityRule(rule)) },
            ...UNDO_TOAST,
          })
        })
        .catch(() => undefined),
    /** « Bloquer »: a time taken off on `day` (an exception « Autre »). */
    block,
    unblock: (exception: AvailabilityException) =>
      run
        .mutateAsync(async () => {
          await removeAvailabilityException(exception.id)
          const { professionalId: pro, kind, startsAt, endsAt, label } = exception
          toast.success(t(`${D}.unblocked`), {
            action: { label: t(`${D}.undo`), onClick: undo(() => addAvailabilityException({ professionalId: pro, kind, startsAt, endsAt, label })) },
            ...UNDO_TOAST,
          })
        })
        .catch(() => undefined),
    /** « En vacances toute la semaine »: Monday 0:00 to the next Monday 0:00, clinic time. */
    vacationWeek: () =>
      run
        .mutateAsync(async () => {
          if (!professionalId) return
          const id = await addAvailabilityException({
            professionalId,
            kind: 'vacation',
            startsAt: instantOf(weekStart, 0),
            endsAt: instantOf(addDays(weekStart, 7), 0),
            label: null,
          })
          toast.success(t(`${D}.vacationAdded`, { date: formatDateOnly(weekStart, 'd MMMM') }), {
            action: { label: t(`${D}.undo`), onClick: undo(() => removeAvailabilityException(id)) },
            ...UNDO_TOAST,
          })
        })
        .catch(() => undefined),
  }
}

export type AvailabilityEditing = ReturnType<typeof useAvailabilityEditing>
