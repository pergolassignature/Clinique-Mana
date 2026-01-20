// src/availability/utils/time-grid.ts
// Single source of truth for all time/pixel conversions in the calendar

export interface TimeGridConfig {
  slotHeight: number        // pixels per slot (40px)
  intervalMinutes: number   // minutes per slot (30min)
  startHour: number         // first visible hour (6)
  endHour: number           // last visible hour (22)
}

export type SnapMode = 'floor' | 'nearest'

export const DEFAULT_CONFIG: TimeGridConfig = {
  slotHeight: 40,
  intervalMinutes: 30,
  startHour: 6,
  endHour: 22,
}

/**
 * Convert Y position (relative to day column top) to minutes from midnight
 */
export function pixelToMinutes(yRelativeToColumnTop: number, config = DEFAULT_CONFIG): number {
  const { slotHeight, intervalMinutes, startHour } = config
  const slots = yRelativeToColumnTop / slotHeight
  return slots * intervalMinutes + startHour * 60
}

/**
 * Convert minutes from midnight to Y position (relative to day column top)
 */
export function minutesToPixel(minutes: number, config = DEFAULT_CONFIG): number {
  const { slotHeight, intervalMinutes, startHour } = config
  const minutesFromStart = minutes - startHour * 60
  return (minutesFromStart / intervalMinutes) * slotHeight
}

/**
 * Snap minutes to the grid interval
 */
export function snapMinutes(
  minutes: number,
  config = DEFAULT_CONFIG,
  mode: SnapMode = 'floor'
): number {
  const { intervalMinutes } = config
  const slots = minutes / intervalMinutes
  const snappedSlots = mode === 'nearest' ? Math.round(slots) : Math.floor(slots)
  return snappedSlots * intervalMinutes
}

/**
 * Clamp minutes within visible range (06:00 - 22:00)
 */
export function clampMinutes(minutes: number, config = DEFAULT_CONFIG): number {
  const { startHour, endHour } = config
  const minMinutes = startHour * 60
  const maxMinutes = endHour * 60
  return Math.max(minMinutes, Math.min(maxMinutes, minutes))
}

/**
 * Get minutes from pointer position + column rect
 * Returns snapped and clamped minutes
 */
export function getMinutesFromPointer(
  clientY: number,
  columnRect: DOMRect,
  config = DEFAULT_CONFIG,
  mode: SnapMode = 'floor'
): number {
  // Small bias prevents snapping to the previous slot when hovering on grid lines.
  const yRelative = clientY - columnRect.top + 1
  const rawMinutes = pixelToMinutes(yRelative, config)
  const snapped = snapMinutes(rawMinutes, config, mode)
  return clampMinutes(snapped, config)
}

/**
 * Normalize a range (handles negative drags, snaps, clamps)
 * Always returns { startMinutes, endMinutes } where start < end
 */
export function normalizeRange(
  aMinutes: number,
  bMinutes: number,
  config = DEFAULT_CONFIG,
  mode: SnapMode = 'floor'
): { startMinutes: number; endMinutes: number } {
  const snappedA = snapMinutes(aMinutes, config, mode)
  const snappedB = snapMinutes(bMinutes, config, mode)
  const clampedA = clampMinutes(snappedA, config)
  const clampedB = clampMinutes(snappedB, config)

  return {
    startMinutes: Math.min(clampedA, clampedB),
    endMinutes: Math.max(clampedA, clampedB),
  }
}

/**
 * Get the minimum duration in minutes for an entity
 */
export function getMinDuration(entityType: 'availability' | 'appointment'): number {
  return entityType === 'availability' ? 30 : 15
}

/**
 * Get the maximum duration in minutes for appointments
 */
export function getMaxAppointmentDuration(): number {
  return 240
}

/**
 * Convert minutes from midnight to ISO datetime string for a given date
 */
export function minutesToISOString(minutes: number, baseDate: Date): string {
  const date = new Date(baseDate)
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return date.toISOString()
}

/**
 * Extract minutes from midnight from an ISO datetime string
 */
export function isoStringToMinutes(isoString: string): number {
  const date = new Date(isoString)
  return date.getHours() * 60 + date.getMinutes()
}
