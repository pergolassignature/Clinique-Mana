import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { formatClinicTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/shared/ui/popover'
import type { AvailabilityException, AvailabilityRule } from '../api/parse'
import {
  addedParts,
  clockLabel,
  defaultSettings,
  minutesAtOffset,
  moveRange,
  overlapsAny,
  previewMerge,
  rangeFromClick,
  rangeFromDrag,
  repeatPhrase,
  resizeRange,
  sameSettings,
  snappedDelta,
  windowPhrase,
  type Range,
} from '../lib/availability-edit'
import { exceptionKindLabel } from '../lib/display'
import { exceptionsOn, verticalBox, windowsOn } from '../lib/layout'
import { GRID_END, GRID_START, isoWeekday, minutesOf } from '../lib/time'
import { ColumnHeader, HOUR_HEIGHT, HourLines, HourRail, type GridColumn } from './TimeGrid'

const A = 'modules.appointments.agenda'
const D = 'modules.appointments.availability'
/** A finger held this long, then dragged: the page does not scroll (phones). */
const LONG_PRESS_MS = 400
/** A finger moving this far before the long press is a scroll. */
const SLOP_PX = 8

export type AvailabilityTool = 'available' | 'block'

interface AvailabilityGridProps {
  columns: readonly GridColumn[]
  professionalId: string
  rules: readonly AvailabilityRule[]
  exceptions: readonly AvailabilityException[]
  canWrite: boolean
  /** `available`: drawing adds a window; `block`: drawing takes the time off (an exception). */
  tool: AvailabilityTool
  onCreate: (day: string, range: Range) => Promise<unknown>
  onChange: (rule: AvailabilityRule, day: string, range: Range) => Promise<unknown>
  onBlock: (day: string, range: Range) => Promise<unknown>
  onWeekly: (rule: AvailabilityRule, weekly: boolean) => Promise<unknown>
  onDelete: (rule: AvailabilityRule) => Promise<unknown>
  onMore: (rule: AvailabilityRule) => void
  onUnblock: (exception: AvailabilityException) => Promise<unknown>
}

type Gesture =
  | { kind: 'draw'; day: string; top: number; anchor: number; current: number }
  | { kind: 'move' | 'start' | 'end'; rule: AvailabilityRule; from: Range; originDay: string; day: string; originY: number; delta: number; moved: boolean }

/** What is shown while a drop saves: the range where it went (the old block hidden). */
interface Settling {
  day: string
  range: Range
  ruleId: string | null
  block: boolean
}

/** The day column under a point (a move may change the weekday). */
function dayAt(x: number, y: number): string | null {
  if (typeof document.elementsFromPoint !== 'function') return null
  for (const el of document.elementsFromPoint(x, y)) {
    const column = (el as HTMLElement).closest?.('[data-availability-day]') as HTMLElement | null
    if (column) return column.dataset.availabilityDay ?? null
  }
  return null
}

/**
 * « Disponibilités » by direct manipulation (AP-27): one professional's week. Drag on an empty
 * part of a day to draw a window (15-minute snapping; a click draws one hour), saved at once with
 * the defaults; drag a window to move it (to another day too), its top or bottom edge to resize
 * it; a click on it opens « Supprimer », « Chaque semaine / Seulement cette semaine » and « Plus
 * d'options… » (the full editor). With « Bloquer », drawing takes the time off instead (an
 * exception), and a click on a blocked time offers « Retirer le blocage ». On a phone, a long
 * press starts the drag (the page scrolls otherwise). The preview shows a refusal coming (a
 * window with other settings, an exception); the database decides.
 */
export function AvailabilityGrid(props: AvailabilityGridProps) {
  const { columns, canWrite, tool } = props
  const height = ((GRID_END - GRID_START) / 60) * HOUR_HEIGHT
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const [settling, setSettling] = useState<Settling | null>(null)
  const [openRule, setOpenRule] = useState<string | null>(null)
  const [openException, setOpenException] = useState<string | null>(null)
  // A drag ends with a click on the block: that click must not open its popover.
  const justDragged = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  const set = (next: Gesture | null) => {
    gestureRef.current = next
    setGesture(next)
  }

  // While a finger drags, the page must not scroll (a non-passive listener: React's are passive).
  useEffect(() => {
    const el = root.current
    if (!el) return
    const stop = (event: Event) => {
      if (gestureRef.current) event.preventDefault()
    }
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  }, [])
  useEffect(() => () => clearTimeout(pending.current?.timer), [])

  /** Mouse and pen: at once. A finger: after a long press, still. */
  const begin = (event: ReactPointerEvent<HTMLElement>, start: () => void) => {
    const el = event.currentTarget
    const pointerId = event.pointerId
    const go = () => {
      pending.current = null
      el.setPointerCapture?.(pointerId)
      start()
    }
    if (event.pointerType !== 'touch') return go()
    clearTimeout(pending.current?.timer)
    pending.current = { timer: setTimeout(go, LONG_PRESS_MS), x: event.clientX, y: event.clientY }
  }

  const drawStart = (event: ReactPointerEvent<HTMLDivElement>, day: string) => {
    if (!canWrite || event.button !== 0 || event.target !== event.currentTarget) return
    const top = event.currentTarget.getBoundingClientRect().top
    const minutes = minutesAtOffset(event.clientY - top, HOUR_HEIGHT)
    begin(event, () => set({ kind: 'draw', day, top, anchor: minutes, current: minutes }))
  }

  const ruleStart = (event: ReactPointerEvent<HTMLElement>, rule: AvailabilityRule, day: string, kind: 'move' | 'start' | 'end') => {
    if (!canWrite || event.button !== 0) return
    event.stopPropagation()
    const from = { start: minutesOf(rule.startTime), end: minutesOf(rule.endTime) }
    const originY = event.clientY
    begin(event, () => set({ kind, rule, from, originDay: day, day, originY, delta: 0, moved: false }))
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const p = pending.current
    if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > SLOP_PX) {
      clearTimeout(p.timer)
      pending.current = null
    }
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'draw') {
      const current = minutesAtOffset(event.clientY - g.top, HOUR_HEIGHT)
      if (current !== g.current) set({ ...g, current })
      return
    }
    const delta = snappedDelta(event.clientY - g.originY, HOUR_HEIGHT)
    const day = g.kind === 'move' ? (dayAt(event.clientX, event.clientY) ?? g.day) : g.day
    if (delta !== g.delta || day !== g.day) set({ ...g, delta, day, moved: g.moved || delta !== 0 || day !== g.originDay })
  }

  const settle = (next: Settling, save: Promise<unknown>) => {
    setSettling(next)
    void save.finally(() => setSettling((s) => (s === next ? null : s)))
  }

  const onPointerUp = () => {
    if (pending.current) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
    const g = gestureRef.current
    if (!g) return
    set(null)
    if (g.kind === 'draw') {
      const range = Math.abs(g.current - g.anchor) < 5 ? rangeFromClick(g.anchor) : rangeFromDrag(g.anchor, g.current)
      const block = tool === 'block'
      settle({ day: g.day, range, ruleId: null, block }, block ? props.onBlock(g.day, range) : props.onCreate(g.day, range))
      return
    }
    if (!g.moved) return
    justDragged.current = true
    const range = gestureRange(g)
    if (range.start === g.from.start && range.end === g.from.end && g.day === g.originDay) return
    settle({ day: g.day, range, ruleId: g.rule.id, block: false }, props.onChange(g.rule, g.day, range))
  }

  const onPointerCancel = () => {
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = null
    set(null)
  }

  return (
    <div
      ref={root}
      className="overflow-x-auto rounded-md border border-border bg-card"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => {
        if (gestureRef.current || pending.current) event.preventDefault()
      }}
    >
      <div className="flex min-w-max">
        <HourRail />
        {columns.map((column) => (
          <DayColumn
            key={column.key}
            column={column}
            height={height}
            gesture={gesture}
            settling={settling}
            openRule={openRule}
            openException={openException}
            setOpenRule={setOpenRule}
            setOpenException={setOpenException}
            justDragged={justDragged}
            onDrawStart={drawStart}
            onRuleStart={ruleStart}
            {...props}
          />
        ))}
      </div>
    </div>
  )
}

function gestureRange(g: Extract<Gesture, { rule: AvailabilityRule }>): Range {
  if (g.kind === 'move') return moveRange(g.from, g.delta)
  return resizeRange(g.from, g.kind, g.delta)
}

interface DayColumnProps extends AvailabilityGridProps {
  column: GridColumn
  height: number
  gesture: Gesture | null
  settling: Settling | null
  openRule: string | null
  openException: string | null
  setOpenRule: (id: string | null) => void
  setOpenException: (id: string | null) => void
  justDragged: MutableRefObject<boolean>
  onDrawStart: (event: ReactPointerEvent<HTMLDivElement>, day: string) => void
  onRuleStart: (event: ReactPointerEvent<HTMLElement>, rule: AvailabilityRule, day: string, kind: 'move' | 'start' | 'end') => void
}

function DayColumn(props: DayColumnProps) {
  const { column, height, gesture, settling, canWrite, tool, professionalId } = props
  const day = column.day
  const windows = windowsOn(props.rules, professionalId, day)
  const offs = exceptionsOn(props.exceptions, professionalId, day)
  const offRanges = offs.map(({ start, end }) => ({ start, end }))

  // The ghost of this column: a window drawn, moved here or resized, or a drop saving.
  let ghost: { range: Range; refused: boolean; block: boolean } | null = null
  let hidden: string | null = null
  if (gesture?.kind === 'draw' && gesture.day === day) {
    const range = rangeFromDrag(gesture.anchor, gesture.current)
    const block = tool === 'block'
    const others = windows.map((w) => ({ id: w.rule.id, start: w.start, end: w.end, compatible: sameSettings(w.rule, defaultSettings(null)) }))
    ghost = { range, block, refused: !block && (previewMerge(others, range).conflict || overlapsAny(offRanges, range)) }
  } else if (gesture && gesture.kind !== 'draw') {
    hidden = gesture.moved ? gesture.rule.id : null
    if (gesture.moved && gesture.day === day) {
      const range = gestureRange(gesture)
      const rule = gesture.rule
      const others = windows
        .filter((w) => w.rule.id !== rule.id)
        .map((w) => ({ id: w.rule.id, start: w.start, end: w.end, compatible: sameSettings(w.rule, rule) }))
      const added = addedParts(gesture.day === gesture.originDay ? gesture.from : null, range)
      ghost = { range, block: false, refused: previewMerge(others, range).conflict || added.some((part) => overlapsAny(offRanges, part)) }
    }
  }
  if (!ghost && settling) {
    if (settling.ruleId) hidden = settling.ruleId
    if (settling.day === day) ghost = { range: settling.range, block: settling.block, refused: false }
  }

  const drawing = gesture?.kind === 'draw'
  return (
    <div className="w-44 shrink-0 border-r border-border last:border-r-0 sm:w-auto sm:min-w-40 sm:flex-1">
      <ColumnHeader column={column} />
      <div
        className={cn('relative select-none [-webkit-touch-callout:none]', canWrite && 'cursor-crosshair')}
        style={{ height }}
        onPointerDown={(event) => props.onDrawStart(event, day)}
        data-availability-day={day}
        data-testid={`agenda-column-${column.key}`}
      >
        <HourLines />
        {windows.map(({ rule, start, end }) => (
          <WindowBlock key={rule.id} {...props} rule={rule} range={{ start, end }} faded={hidden === rule.id} passThrough={tool === 'block' || drawing} />
        ))}
        {offs.map(({ exception, start, end }) => {
          const label = t(`${D}.blockedLabel`, { start: formatClinicTime(exception.startsAt), end: formatClinicTime(exception.endsAt) })
          return (
            <Popover key={exception.id} open={props.openException === exception.id} onOpenChange={(open) => props.setOpenException(open ? exception.id : null)}>
              <PopoverAnchor asChild>
                <button
                  type="button"
                  aria-label={label}
                  disabled={!canWrite}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => props.setOpenException(exception.id)}
                  className={cn(
                    'absolute inset-x-0 z-[1] bg-muted text-left text-xs text-muted-foreground [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(var(--border-strong))_6px_7px)]',
                    drawing && 'pointer-events-none',
                  )}
                  style={verticalBox(start, end, HOUR_HEIGHT)}
                />
              </PopoverAnchor>
              <PopoverContent align="start" className="w-64 space-y-3">
                <p>
                  <span className="font-medium">{exceptionKindLabel(exception.kind)}</span>
                  {exception.label && <span> · {exception.label}</span>}
                  <span className="block text-xs text-muted-foreground">{label}</span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    props.setOpenException(null)
                    void props.onUnblock(exception)
                  }}
                >
                  {t(`${D}.unblock`)}
                </Button>
              </PopoverContent>
            </Popover>
          )
        })}
        {ghost && (
          <div
            aria-hidden
            data-testid="availability-ghost"
            className={cn(
              'pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed px-1.5 py-1 text-xs font-medium tabular',
              ghost.block
                ? 'border-border bg-muted/80 text-muted-foreground'
                : ghost.refused
                  ? 'border-destructive bg-destructive/10 text-destructive'
                  : 'border-primary bg-primary/20 text-foreground',
            )}
            style={verticalBox(ghost.range.start, ghost.range.end, HOUR_HEIGHT)}
          >
            {clockLabel(ghost.range.start)} – {clockLabel(ghost.range.end)}
          </div>
        )}
      </div>
    </div>
  )
}

function WindowBlock(props: DayColumnProps & { rule: AvailabilityRule; range: Range; faded: boolean; passThrough: boolean }) {
  const { rule, range, canWrite, column } = props
  const weekly = rule.validUntil === null
  const phrase = windowPhrase(isoWeekday(column.day), range)
  const close = () => props.setOpenRule(null)
  return (
    <Popover open={props.openRule === rule.id} onOpenChange={(open) => props.setOpenRule(open ? rule.id : null)}>
      <PopoverAnchor asChild>
        <button
          type="button"
          onPointerDown={(event) => props.onRuleStart(event, rule, column.day, 'move')}
          onClick={() => {
            if (props.justDragged.current) {
              props.justDragged.current = false
              return
            }
            props.setOpenRule(rule.id)
          }}
          className={cn(
            'absolute inset-x-1 flex flex-col items-start justify-start overflow-hidden rounded-md border border-primary/40 bg-primary/10 px-1.5 py-1 text-left text-xs',
            canWrite && 'cursor-grab active:cursor-grabbing',
            props.faded && 'opacity-30',
            props.passThrough && 'pointer-events-none',
          )}
          style={verticalBox(range.start, range.end, HOUR_HEIGHT)}
          aria-label={t(`${A}.windowLabel`, { start: rule.startTime, end: rule.endTime })}
        >
          {canWrite && (
            <span
              aria-hidden
              data-edge="start"
              onPointerDown={(event) => props.onRuleStart(event, rule, column.day, 'start')}
              className="absolute inset-x-0 top-0 h-2 cursor-ns-resize max-sm:h-3"
            />
          )}
          <span className="tabular">
            {clockLabel(range.start)} – {clockLabel(range.end)}
          </span>
          {!weekly && <span className="block text-muted-foreground">{repeatPhrase(false)}</span>}
          {rule.serviceIds.length > 0 && <span className="block text-muted-foreground">{t(`${A}.windowServices`, { count: String(rule.serviceIds.length) })}</span>}
          {canWrite && (
            <span
              aria-hidden
              data-edge="end"
              onPointerDown={(event) => props.onRuleStart(event, rule, column.day, 'end')}
              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize max-sm:h-3"
            />
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent align="start" collisionPadding={16} className="w-auto min-w-72 max-w-[calc(100vw-32px)] space-y-3">
        <p className="font-medium first-letter:uppercase">{phrase}</p>
        {canWrite ? (
          <>
            <SegmentedToggle
              label={t(`${D}.repeatLabel`)}
              value={weekly ? 'weekly' : 'week'}
              onChange={(value) => {
                close()
                if ((value === 'weekly') !== weekly) void props.onWeekly(rule, value === 'weekly')
              }}
              options={[
                { value: 'weekly', label: t(`${D}.everyWeek`) },
                { value: 'week', label: t(`${D}.onlyThisWeek`) },
              ]}
            />
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  close()
                  props.onMore(rule)
                }}
              >
                {t(`${D}.more`)}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  close()
                  void props.onDelete(rule)
                }}
              >
                <Trash2 aria-hidden />
                {t(`${D}.remove`)}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">{repeatPhrase(weekly)}</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
