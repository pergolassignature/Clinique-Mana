import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { PROVINCE_OPTIONS } from './provinces'
import { PROVINCES } from './schemas'

describe('PROVINCE_OPTIONS', () => {
  it('lists each of the 13 codes the database accepts, once', () => {
    expect(PROVINCE_OPTIONS.map((p) => p.value).sort()).toEqual([...PROVINCES].sort())
  })

  it('names them in French, in French alphabetical order', () => {
    const labels = PROVINCE_OPTIONS.map((p) => t(p.labelKey))
    expect(labels).toEqual([...labels].sort(new Intl.Collator('fr-CA').compare))
    expect(labels).not.toContain(expect.stringMatching(/^settings\./)) // every key exists
    expect(t(PROVINCE_OPTIONS.find((p) => p.value === 'QC')!.labelKey)).toBe('Québec')
    expect(t(PROVINCE_OPTIONS.find((p) => p.value === 'ON')!.labelKey)).toBe('Ontario')
    expect(t(PROVINCE_OPTIONS.find((p) => p.value === 'PE')!.labelKey)).toBe('Île-du-Prince-Édouard')
  })
})
