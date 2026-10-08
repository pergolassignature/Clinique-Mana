import { foldSearch } from './filters'

/**
 * The settings lists' search (« Rechercher… »): accent- and case-insensitive words, each of which
 * must appear somewhere in the row (its name, or a column's text such as a code), and the ranges
 * to highlight in the original text, accents kept.
 */

/** The search's words, folded (accents removed, lower case). Empty for a blank search. */
export function searchWords(query: string): string[] {
  return foldSearch(query).split(/\s+/).filter(Boolean)
}

/** Whether every word appears in one of the texts. Without words, everything matches. */
export function matchesSearch(texts: readonly string[], words: readonly string[]): boolean {
  if (words.length === 0) return true
  const haystack = texts.map(foldSearch).join('\n')
  return words.every((word) => haystack.includes(word))
}

/** A half-open range `[start, end)` of UTF-16 indices in the original text. */
export type TextRange = [start: number, end: number]

/**
 * Where the words appear in `text`, as ranges of the original text (merged, in order). The text
 * is folded one code point at a time, so each folded character knows the original it came from:
 * « é » (one character, or « e » + a combining accent) highlights whole.
 */
export function highlightRanges(text: string, words: readonly string[]): TextRange[] {
  if (words.length === 0) return []
  let folded = ''
  // For each folded character: the start and end of the original code point it came from.
  const starts: number[] = []
  const ends: number[] = []
  let index = 0
  for (const char of text) {
    const piece = foldSearch(char)
    for (let i = 0; i < piece.length; i++) {
      starts.push(index)
      ends.push(index + char.length)
    }
    folded += piece
    index += char.length
  }
  const ranges: TextRange[] = []
  for (const word of words) {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      ranges.push([starts[at] ?? 0, ends[at + word.length - 1] ?? text.length])
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: TextRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}
