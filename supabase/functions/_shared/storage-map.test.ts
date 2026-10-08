// Ties the SQL MIME → extension map (`private.mime_extension`, Task 3.24,
// supabase/migrations/*_core_storage.sql) to the TypeScript one in
// storage.ts: `create_pending_upload` and `register_system_file` build object
// paths in SQL, `buildObjectPath` checks them here, so the two maps must be
// the same set of exact MIME strings with the same extensions.
import { assert, assertEquals } from '@std/assert'
import {
  extensionForMime,
  type SniffedType,
  sniffMatchesMime,
} from './storage.ts'

const MIGRATIONS = new URL('../../migrations/', import.meta.url)

/** Every accepted type; `satisfies` fails to compile if storage.ts gains or loses one. */
const KNOWN = {
  pdf: true,
  png: true,
  jpeg: true,
  webp: true,
  doc: true,
  docx: true,
} satisfies Record<Exclude<SniffedType, 'unknown'>, true>

/** The `when '<mime>' then '<ext>'` pairs of the latest `private.mime_extension`. */
async function sqlMap(): Promise<Map<string, string>> {
  const names: string[] = []
  for await (const entry of Deno.readDir(MIGRATIONS)) {
    if (entry.isFile && entry.name.endsWith('.sql')) names.push(entry.name)
  }
  let body: string | undefined
  for (const name of names.sort()) {
    const sql = await Deno.readTextFile(new URL(name, MIGRATIONS))
    // The body between a dollar-quote tag and its closing twin: `$$`, `$fn$`…
    const match =
      /function private\.mime_extension\([\s\S]*?(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)([\s\S]*?)\1/
        .exec(sql)
    if (match) body = match[2]
  }
  assert(body, 'no migration defines private.mime_extension')
  return new Map(
    [...body.matchAll(/when '([^']+)' then '([^']+)'/g)].map((
      [, mime, ext],
    ) => [mime, ext]),
  )
}

Deno.test('storage map: the SQL map equals the TypeScript map', async () => {
  const map = await sqlMap()
  for (const [mime, ext] of map) {
    assertEquals(extensionForMime(mime), ext, `extension of ${mime}`)
  }
  for (const type of Object.keys(KNOWN) as (keyof typeof KNOWN)[]) {
    const mimes = [...map.keys()].filter((mime) => sniffMatchesMime(type, mime))
    assertEquals(mimes.length, 1, `one SQL MIME type for ${type}`)
  }
  assertEquals(map.size, Object.keys(KNOWN).length, 'no MIME type only in SQL')
})
