// src/availability/dnd/snap-modifier.ts

import type { Modifier } from '@dnd-kit/core'
import { DEFAULT_CONFIG, type TimeGridConfig } from '../utils/time-grid'

/**
 * Creates a modifier that snaps drag transforms to the time grid.
 * - Locks horizontal movement (x: 0)
 * - Snaps vertical movement to slot height increments
 */
export function createSnapToTimeGrid(config: TimeGridConfig = DEFAULT_CONFIG): Modifier {
  return ({ transform, active }) => {
    const activeId = active?.id ? String(active.id) : ''
    const activeType = active?.data?.current?.type
    const isServiceDrag = activeType === 'service' || activeId.startsWith('service-')

    if (isServiceDrag) {
      return transform
    }

    const snapToSlot = (value: number) =>
      value >= 0
        ? Math.floor(value / config.slotHeight) * config.slotHeight
        : Math.ceil(value / config.slotHeight) * config.slotHeight

    return {
      ...transform,
      x: 0, // Lock horizontal movement - items stay in their day column
      y: snapToSlot(transform.y),
    }
  }
}

/**
 * Pre-configured snap modifier using default config
 */
export const snapToTimeGrid = createSnapToTimeGrid()
