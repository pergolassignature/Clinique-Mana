// src/availability/components/now-line.tsx

import { useEffect, useState } from 'react'
import { isToday } from 'date-fns'

interface NowLineProps {
  dayDate: Date
  startHour: number
  slotHeight: number
  intervalMinutes: number
}

export function NowLine({ dayDate, startHour, slotHeight, intervalMinutes }: NowLineProps) {
  const [position, setPosition] = useState<number | null>(null)

  useEffect(() => {
    if (!isToday(dayDate)) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const now = new Date()
      const currentMinutes = now.getHours() * 60 + now.getMinutes()
      const startMinutes = startHour * 60
      const minutesFromStart = currentMinutes - startMinutes

      if (minutesFromStart < 0 || minutesFromStart > 16 * 60) {
        setPosition(null)
        return
      }

      const pos = (minutesFromStart / intervalMinutes) * slotHeight
      setPosition(pos)
    }

    updatePosition()
    const interval = setInterval(updatePosition, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [dayDate, startHour, slotHeight, intervalMinutes])

  if (position === null) return null

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
      style={{ top: `${position}px` }}
    >
      <div className="w-2 h-2 rounded-full bg-wine-500 -ml-1" />
      <div className="flex-1 h-0.5 bg-wine-500" />
    </div>
  )
}
