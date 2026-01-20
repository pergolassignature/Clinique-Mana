// src/availability/components/week-navigation.tsx

import { format, addWeeks, subWeeks, startOfWeek, isThisWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/shared/ui/button'

interface WeekNavigationProps {
  weekStartDate: Date
  onWeekChange: (newStart: Date) => void
}

export function WeekNavigation({ weekStartDate, onWeekChange }: WeekNavigationProps) {
  const weekEnd = new Date(weekStartDate)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const handlePrevWeek = () => {
    onWeekChange(subWeeks(weekStartDate, 1))
  }

  const handleNextWeek = () => {
    onWeekChange(addWeeks(weekStartDate, 1))
  }

  const handleToday = () => {
    onWeekChange(startOfWeek(new Date(), { weekStartsOn: 1 }))
  }

  const isCurrentWeek = isThisWeek(weekStartDate, { weekStartsOn: 1 })

  // Format: "13 – 19 janvier 2026"
  const sameMonth = format(weekStartDate, 'MMMM', { locale: fr }) ===
                    format(weekEnd, 'MMMM', { locale: fr })

  const dateRangeLabel = sameMonth
    ? `${format(weekStartDate, 'd')} – ${format(weekEnd, 'd MMMM yyyy', { locale: fr })}`
    : `${format(weekStartDate, 'd MMM', { locale: fr })} – ${format(weekEnd, 'd MMM yyyy', { locale: fr })}`

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background p-2">
      {/* Previous week */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePrevWeek}
        className="h-9 w-9"
      >
        <ChevronLeft className="h-5 w-5" />
        <span className="sr-only">Semaine précédente</span>
      </Button>

      {/* Center: Date range + Today button */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {dateRangeLabel}
        </span>

        {!isCurrentWeek && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleToday}
            className="h-7 text-xs"
          >
            <Calendar className="h-3 w-3 mr-1" />
            Aujourd'hui
          </Button>
        )}

        {isCurrentWeek && (
          <span className="text-xs text-sage-600 font-medium px-2 py-0.5 bg-sage-50 rounded">
            Cette semaine
          </span>
        )}
      </div>

      {/* Next week */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleNextWeek}
        className="h-9 w-9"
      >
        <ChevronRight className="h-5 w-5" />
        <span className="sr-only">Semaine suivante</span>
      </Button>
    </div>
  )
}
