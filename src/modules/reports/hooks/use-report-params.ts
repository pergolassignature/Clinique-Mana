import { useSearchParams } from 'react-router-dom'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { presetPeriod, type Period } from '../lib/reports'

/**
 * A report's filters live in the address (`?du=…&au=…&pro=…`): a link or a reload shows the same
 * report. Empty or default values are left out.
 */
export function useReportParams() {
  const [params, setParams] = useSearchParams()
  const today = useClinicDate()
  const month = presetPeriod('thisMonth', today)
  const period: Period = { from: params.get('du') || month.from, to: params.get('au') || month.to }
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )
  return { params, period, today, set }
}
