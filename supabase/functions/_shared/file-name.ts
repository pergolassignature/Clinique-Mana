/**
 * The characters a stored file's name may not hold (`stored_files.original_name`,
 * 20261008071750_core_storage.sql): `/`, `\`, C0, DEL, C1, the line and
 * paragraph separators (U+2028–U+2029) and the bidirectional formatting
 * characters: LRM / RLM (U+200E–U+200F), embeddings and overrides
 * (U+202A–U+202E), isolates (U+2066–U+2069). « facture\u202Egnp.exe » shows
 * as « factureexe.png ».
 *
 * No import on purpose: the browser's twin (`src/core/storage/file-name.ts`)
 * and the SQL check are compared with it by
 * `src/core/storage/file-name-parity.test.ts` (Vitest imports this file).
 */
export function forbiddenNameChar(char: string): boolean {
  const code = char.codePointAt(0)!
  return char === '/' || char === '\\' || code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200e && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x2029) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
}
