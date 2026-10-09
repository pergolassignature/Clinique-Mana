/**
 * Licence formats are PostgreSQL regular expressions (ARE), checked by `save_professional_order`
 * and `professional_professions_guard`. The client runs them as JavaScript regexes, which read
 * most patterns the same way but not all. This finds the syntax the two dialects read
 * differently, so the order dialog can refuse it and the licence checks can leave it to the
 * database:
 * - `***` director prefixes (`***=`, `***:`);
 * - bracket classes, collating elements and equivalence classes (`[[:digit:]]`, `[[.a.]]`, `[[=a=]]`),
 *   and a `]` first in a bracket (a literal in PostgreSQL, an empty class in JavaScript);
 * - every `(?` group (embedded options, lookarounds, non-capturing groups);
 * - the escapes `\m`, `\M`, `\y`, `\Y` (word bounds), `\A`, `\Z` (string bounds), `\b`, `\B`
 *   (backspace and backslash in PostgreSQL, word bounds in JavaScript) and back-references
 *   (`\1`–`\9`).
 */
const DIFFERING_ESCAPES = /^[mMyYAZbB1-9]$/

export function hasPostgresOnlySyntax(pattern: string): boolean {
  if (pattern.startsWith('***')) return true
  let inBracket = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') {
      if (DIFFERING_ESCAPES.test(pattern[i + 1] ?? '')) return true
      i++
      continue
    }
    if (inBracket) {
      if (c === '[' && ':.='.includes(pattern[i + 1] ?? '_')) return true
      if (c === ']') inBracket = false
      continue
    }
    if (c === '[') {
      inBracket = true
      if (pattern[i + 1] === '^') i++
      if (pattern[i + 1] === ']') return true
    } else if (c === '(' && pattern[i + 1] === '?') {
      return true
    }
  }
  return false
}
