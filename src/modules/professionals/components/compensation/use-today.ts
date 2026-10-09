import { getClinicDateString } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'

/** The clinic's date, following the clock (midnight, the 24-hour correction window of P4-145). */
export function useToday() {
  const now = useNow(60_000)
  return { now, today: getClinicDateString(new Date(now)) }
}
