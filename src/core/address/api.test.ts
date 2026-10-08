import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import { fetchAddressSuggestions, fetchPlaceAddress, newPlacesSession } from './api'

const mocks = vi.hoisted(() => ({ invokeFunction: vi.fn() }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))

afterEach(() => vi.clearAllMocks())

const SESSION = '3519edfe-0f75-4a30-bfe4-7cbd89340b2c'

describe('address api (places)', () => {
  it('sends only the typed text and the session token, and maps the suggestions', async () => {
    mocks.invokeFunction.mockResolvedValue({
      suggestions: [{ place_id: 'ChIJfakePlateau000001', main_text: '1234 Rue Saint-Denis', secondary_text: 'Montréal, QC, Canada' }],
    })
    const signal = new AbortController().signal
    await expect(fetchAddressSuggestions('1234 saint-denis', SESSION, signal)).resolves.toEqual([
      { placeId: 'ChIJfakePlateau000001', mainText: '1234 Rue Saint-Denis', secondaryText: 'Montréal, QC, Canada' },
    ])
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('places', { action: 'autocomplete', input: '1234 saint-denis', session: SESSION }, { signal })
  })

  it('reads the chosen place with the same session token, and maps the address', async () => {
    mocks.invokeFunction.mockResolvedValue({
      address: { line1: '3450, rue Drummond', line2: '402', city: 'Montréal', province: 'QC', postal_code: 'H3G 1Y2', country: 'CA' },
    })
    await expect(fetchPlaceAddress('ChIJfakeUnit00000007', SESSION)).resolves.toEqual({
      line1: '3450, rue Drummond',
      line2: '402',
      city: 'Montréal',
      province: 'QC',
      postalCode: 'H3G 1Y2',
      country: 'CA',
    })
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('places', { action: 'details', place_id: 'ChIJfakeUnit00000007', session: SESSION }, { signal: undefined })
  })

  it('passes refusals on and refuses an unexpected answer', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('not_configured', 503, 'x'))
    await expect(fetchAddressSuggestions('rue laurier', SESSION)).rejects.toMatchObject({ code: 'not_configured' })
    mocks.invokeFunction.mockResolvedValue({ suggestions: 'nope' })
    await expect(fetchAddressSuggestions('rue laurier', SESSION)).rejects.toThrow()
  })

  it('makes a fresh UUID session token each time (Google: URL-safe, at most 36 characters)', () => {
    const a = newPlacesSession()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newPlacesSession()).not.toBe(a)
  })
})
