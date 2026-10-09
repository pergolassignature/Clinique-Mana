import { t, type TranslationKey } from '@/i18n'
import type { Province } from './schemas'

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

/** A province code's French name; the code itself when it is not one of the 13. */
export function provinceName(code: string): string {
  const option = PROVINCE_OPTIONS.find((o) => o.value === code)
  return option ? t(option.labelKey) : code
}
