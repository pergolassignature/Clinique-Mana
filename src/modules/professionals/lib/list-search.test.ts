import { describe, expect, it } from 'vitest'
import { highlightRanges, matchesSearch, searchWords } from './list-search'

describe('searchWords', () => {
  it('folds accents and case, and splits on spaces', () => {
    expect(searchWords('  Thérapie  COGNITIVE ')).toEqual(['therapie', 'cognitive'])
  })

  it('is empty for a blank search', () => {
    expect(searchWords('   ')).toEqual([])
  })
})

describe('matchesSearch', () => {
  it('matches every word in any of the texts, ignoring accents', () => {
    expect(matchesSearch(['Français', 'fr'], searchWords('francais'))).toBe(true)
    expect(matchesSearch(['Portugais', 'pt'], searchWords('port pt'))).toBe(true)
    expect(matchesSearch(['Portugais', 'pt'], searchWords('port en'))).toBe(false)
  })

  it('matches everything without words', () => {
    expect(matchesSearch(['Anglais'], [])).toBe(true)
  })
})

describe('highlightRanges', () => {
  it('gives the match in the original text, accents kept', () => {
    // « é » is one character in the text and folds to « e ».
    expect(highlightRanges('Fin de collaboration', searchWords('collab'))).toEqual([[7, 13]])
    expect(highlightRanges('Thérapie', searchWords('therap'))).toEqual([[0, 6]])
  })

  it('handles decomposed accents (the mark stays inside the range)', () => {
    const text = 'Thérapie'
    expect(highlightRanges(text, searchWords('ther'))).toEqual([[0, 5]])
  })

  it('marks every occurrence of every word, merging overlaps', () => {
    expect(highlightRanges('Anglais anglais', searchWords('ang'))).toEqual([
      [0, 3],
      [8, 11],
    ])
    expect(highlightRanges('Congé parental', searchWords('conge cong'))).toEqual([[0, 5]])
  })

  it('is empty without a match or without words', () => {
    expect(highlightRanges('Congé', searchWords('xyz'))).toEqual([])
    expect(highlightRanges('Congé', [])).toEqual([])
  })
})
