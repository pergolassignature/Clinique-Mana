import { Cake } from 'lucide-react'
import { t } from '@/i18n'
import { formatDateOnly } from '@/shared/lib/timezone'
import type { AgendaBirthday } from '../api/agenda'

const A = 'modules.appointments.agenda'

/**
 * The professionals' birthdays on the days shown (P4-564), above the day, week and upcoming
 * views: « Anniversaires : Pia Un, jeudi 14 mars ». The month view marks its days instead.
 */
export function BirthdaysBanner({ birthdays }: { birthdays: readonly AgendaBirthday[] }) {
  if (birthdays.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
      <Cake aria-hidden className="size-4 text-primary" />
      <span className="font-medium">{t(`${A}.birthdays`)}</span>
      <span>{birthdays.map((b) => t(`${A}.birthdayOn`, { name: b.name, day: formatDateOnly(b.day, 'EEEE d MMMM') })).join(' · ')}</span>
    </p>
  )
}
