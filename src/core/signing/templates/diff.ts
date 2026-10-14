/**
 * « Comparer avec la version publiée » (CC-21): the published text and the draft, line by line (a
 * paragraph of the markup is one line), the lines kept, removed and added in order. A longest
 * common subsequence; past MAX_CELLS (two very long texts) the published lines read as removed and
 * the draft's as added, never a frozen page. Pure.
 */

export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string }

const MAX_CELLS = 4_000_000

const linesOf = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))

export function diffLines(before: string, after: string): DiffLine[] {
  const a = linesOf(before)
  const b = linesOf(after)
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: 'removed' as const, text })), ...b.map((text) => ({ kind: 'added' as const, text }))]
  }
  // lcs[i][j]: the longest common run of a[i..] and b[j..].
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'removed', text: a[i]! })
      i++
    } else {
      out.push({ kind: 'added', text: b[j]! })
      j++
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++]! })
  while (j < b.length) out.push({ kind: 'added', text: b[j++]! })
  return out
}

/** Whether the draft says something else than the published text. */
export const hasChanges = (lines: DiffLine[]) => lines.some((line) => line.kind !== 'same' && line.text !== '')
