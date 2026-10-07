import type { TranslationKey } from '@/i18n'
import type { Province } from './schemas'

/** A clinic that has not set its province yet is shown (and saved) as in Québec. */
export const DEFAULT_PROVINCE: Province = 'QC'

/** The province and territory picker: the 13 codes of `PROVINCES`, by French name in alphabetical order. */
export const PROVINCE_OPTIONS: readonly { value: Province; labelKey: TranslationKey }[] = [
  { value: 'AB', labelKey: 'settings.provinces.AB' },
  { value: 'BC', labelKey: 'settings.provinces.BC' },
  { value: 'PE', labelKey: 'settings.provinces.PE' },
  { value: 'MB', labelKey: 'settings.provinces.MB' },
  { value: 'NB', labelKey: 'settings.provinces.NB' },
  { value: 'NS', labelKey: 'settings.provinces.NS' },
  { value: 'NU', labelKey: 'settings.provinces.NU' },
  { value: 'ON', labelKey: 'settings.provinces.ON' },
  { value: 'QC', labelKey: 'settings.provinces.QC' },
  { value: 'SK', labelKey: 'settings.provinces.SK' },
  { value: 'NL', labelKey: 'settings.provinces.NL' },
  { value: 'NT', labelKey: 'settings.provinces.NT' },
  { value: 'YT', labelKey: 'settings.provinces.YT' },
]
