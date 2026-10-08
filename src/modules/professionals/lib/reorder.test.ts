import { describe, expect, it } from 'vitest'
import { moveRow } from './reorder'

const ALL = ['a', 'b', 'c', 'd', 'e']

describe('moveRow', () => {
  it('swaps a row with its neighbour when every row is shown', () => {
    expect(moveRow(ALL, ALL, 'c', 'up')).toEqual(['a', 'c', 'b', 'd', 'e'])
    expect(moveRow(ALL, ALL, 'c', 'down')).toEqual(['a', 'b', 'd', 'c', 'e'])
  })

  it('moves past the next shown row, keeping hidden (archived) rows in the full list', () => {
    // b and d are archived and hidden: c goes before a, the row shown above it.
    expect(moveRow(ALL, ['a', 'c', 'e'], 'c', 'up')).toEqual(['c', 'a', 'b', 'd', 'e'])
    expect(moveRow(ALL, ['a', 'c', 'e'], 'c', 'down')).toEqual(['a', 'b', 'd', 'e', 'c'])
  })

  it('returns null at either end of the shown rows', () => {
    expect(moveRow(ALL, ['b', 'c'], 'b', 'up')).toBeNull()
    expect(moveRow(ALL, ['b', 'c'], 'c', 'down')).toBeNull()
  })

  it('returns null for a row that is not shown', () => {
    expect(moveRow(ALL, ['a', 'b'], 'e', 'up')).toBeNull()
  })
})
