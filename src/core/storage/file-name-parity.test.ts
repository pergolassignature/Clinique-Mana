import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { forbiddenNameChar } from '../../../supabase/functions/_shared/file-name'
import { FORBIDDEN_NAME_CHAR } from './file-name'

/**
 * One list for the three places that refuse a file name's characters: the browser
 * (`./file-name.ts`, before an upload), storage-upload (`_shared/file-name.ts`) and the SQL check on
 * `stored_files.original_name`. The SQL check is read from its migration and run here with
 * `[:cntrl:]` as the database reads it (C0, DEL, C1: 022_core_storage.test.sql checks that against
 * the database itself, over every code point).
 */
const FORBIDDEN: [number, number][] = [
  [0x2f, 0x2f], // /
  [0x5c, 0x5c], // \
  [0x00, 0x1f], // C0
  [0x7f, 0x9f], // DEL, C1
  [0x200e, 0x200f], // LRM, RLM
  [0x2028, 0x2029], // line and paragraph separators
  [0x202a, 0x202e], // embeddings and overrides
  [0x2066, 0x2069], // isolates
]
const forbidden = (code: number) => FORBIDDEN.some(([from, to]) => code >= from && code <= to)

const root = path.resolve(__dirname, '../../..')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261008071750_core_storage.sql'), 'utf8')

/** The `original_name !~ '…'` class of the migration, as a JavaScript RegExp. */
function sqlCheck(): RegExp {
  const literal = /original_name !~ '(\[[^']*\])'/.exec(migration)?.[1]
  if (!literal) throw new Error('original_name check not found in the storage migration')
  const source = literal
    .replace('[:cntrl:]', '\\u0000-\\u001f\\u007f-\\u009f')
    // PostgreSQL's \uXXXX escapes are JavaScript's too; its `\\` is one backslash in a class.
    .replace(/\\\\/g, '\\\\')
  return new RegExp(source, 'u')
}

/** Every code point but the surrogates (a JavaScript string cannot hold one alone in a name). */
function* codePoints(): Generator<number> {
  for (let code = 0; code <= 0x10ffff; code++) {
    if (code < 0xd800 || code > 0xdfff) yield code
  }
}

describe('forbidden file-name characters: browser, storage-upload and SQL', () => {
  it('the SQL check is the class this test reads (it names [:cntrl:] and the separators)', () => {
    expect(migration).toContain(String.raw`original_name !~ '[/\\[:cntrl:]\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]'`)
  })

  it('all three refuse exactly the same characters, over every code point', () => {
    const browser = new RegExp(FORBIDDEN_NAME_CHAR.source, 'u')
    const sql = sqlCheck()
    const differences: string[] = []
    for (const code of codePoints()) {
      const char = String.fromCodePoint(code)
      const expected = forbidden(code)
      const seen = { browser: browser.test(char), function: forbiddenNameChar(char), sql: sql.test(char) }
      for (const [where, refused] of Object.entries(seen)) {
        if (refused !== expected) differences.push(`${where} U+${code.toString(16).padStart(4, '0')}`)
      }
      if (differences.length > 10) break
    }
    expect(differences).toEqual([])
  })
})
