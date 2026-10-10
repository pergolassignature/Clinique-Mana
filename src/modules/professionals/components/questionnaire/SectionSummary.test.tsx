import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SectionValues } from '../../api/self'
import type { CatalogView } from '../../lib/catalog-view'
import { ProfileSectionSummary } from './SectionSummary'

const catalog = {} as CatalogView

function addressOf(values: SectionValues) {
  render(<ProfileSectionSummary section="personal" values={values} catalog={catalog} gender={null} />)
  return screen.getByText('Adresse').nextElementSibling?.textContent
}

describe('ProfileSectionSummary: the address', () => {
  it('reads « Non indiquée » when only the default province is set', () => {
    expect(addressOf({ province: 'QC', address_line1: '', city: ' ' })).toBe('Non indiquée')
  })

  it('reads « Non indiquée » with only an apartment or a postal code', () => {
    expect(addressOf({ province: 'QC', address_line2: 'App. 3', postal_code: 'H2X 1Y4' })).toBe('Non indiquée')
  })

  it('shows the whole address once the street is filled', () => {
    expect(addressOf({ address_line1: '123 rue Principale', address_line2: 'App. 3', city: 'Montréal', province: 'QC', postal_code: 'H2X 1Y4' })).toBe(
      '123 rue Principale, App. 3, Montréal, Québec, H2X 1Y4',
    )
  })

  it('shows the city and province once the city alone is filled', () => {
    expect(addressOf({ city: 'Laval', province: 'QC' })).toBe('Laval, Québec')
  })
})
