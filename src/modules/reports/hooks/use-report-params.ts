import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { useUrlParams } from '@/shared/lib/use-url-params'
import { presetPeriod, type Period } from '../lib/reports'

/**
 * A report's filters live in the address (`?du=…&au=…&pro=…`): a link or a reload shows the same
 * report. Empty or default values are left out.
 */
export function useReportParams() {
  const { params, update } = useUrlParams()
  const today = useClinicDate()
  const month = presetPeriod('thisMonth', today)
  const period: Period = { from: params.get('du') || month.from, to: params.get('au') || month.to }
  // From the latest address (useUrlParams): two quick changes never undo each other.
  const set = (patch: Record<string, string | null>) => update(patch)
  return { params, period, today, set }
}
