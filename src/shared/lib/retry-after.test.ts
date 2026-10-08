import { describe, expect, it } from 'vitest'
import { retryInText } from './retry-after'

describe('retryInText', () => {
  it.each([
    [null, 'Réessayez plus tard.'],
    [0, 'Réessayez plus tard.'],
    [30, 'Réessayez dans un instant.'],
    [60, 'Réessayez dans environ 1 minute.'],
    [61, 'Réessayez dans environ 2 minutes.'],
    [9 * 60, 'Réessayez dans environ 9 minutes.'],
    [43 * 60, 'Réessayez dans environ 45 minutes.'],
    [45 * 60, 'Réessayez dans environ 45 minutes.'],
    [3599, 'Réessayez dans environ 1 heure.'],
    [3600, 'Réessayez dans environ 1 heure.'],
    [3 * 3600, 'Réessayez dans environ 3 heures.'],
  ])('reads %s seconds as « %s »', (seconds, text) => {
    expect(retryInText(seconds)).toBe(text)
  })
})
