// src/availability/components/now-line.tsx

import { useEffect, useState } from 'react'
import { isToday, format } from 'date-fns'

interface NowLineProps {
  dayDate: Date
  startHour: number
  slotHeight: number
  intervalMinutes: number
}

export function NowLine({ dayDate, startHour, slotHeight, intervalMinutes }: NowLineProps) {
  const [position, setPosition] = useState<number | null>(null)
  const [labelTime, setLabelTime] = useState<string>('')
  const [actualTime, setActualTime] = useState<string>('')

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

      const snappedFromStart =
        Math.round(minutesFromStart / intervalMinutes) * intervalMinutes
      const snappedMinutes = startMinutes + snappedFromStart
      const snappedDate = new Date(now)
      snappedDate.setHours(Math.floor(snappedMinutes / 60), snappedMinutes % 60, 0, 0)

      const pos = (snappedFromStart / intervalMinutes) * slotHeight
      setPosition(pos)
      setLabelTime(format(snappedDate, 'HH:mm'))
      setActualTime(format(now, 'HH:mm'))
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
      {/* Pulsing dot indicator */}
      <div className="relative -ml-1.5">
        <div className="w-3 h-3 rounded-full bg-wine-500 shadow-sm" />
        <div className="absolute inset-0 w-3 h-3 rounded-full bg-wine-500 animate-ping opacity-75" />
      </div>

      {/* Line with gradient fade */}
      <div className="flex-1 h-0.5 bg-gradient-to-r from-wine-500 via-wine-500 to-wine-500/20" />

      {/* Time label */}
      <div
        className="absolute -left-12 -top-2 text-[10px] font-medium text-wine-600 bg-wine-50 px-1 py-0.5 rounded"
        title={`Heure actuelle : ${actualTime}`}
      >
        {labelTime}
      </div>
    </div>
  )
}
