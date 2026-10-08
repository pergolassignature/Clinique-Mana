import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UPLOAD_PURPOSES } from './purposes'

const root = path.resolve(__dirname, '../../..')
const MIGRATIONS = path.join(root, 'supabase/migrations')

type SqlValue = string | number | null | string[]

/** Splits `text` at the top-level commas (outside quotes, brackets and parentheses). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'") quoted = !quoted // '' (an escaped quote) toggles twice
    else if (quoted) continue
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

/** The parenthesised groups at the top level of `text` (`(a, b), (c, d)` → `a, b` and `c, d`). */
function tuples(text: string): string[] {
  const found: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'") quoted = !quoted
    else if (quoted) continue
    else if (c === '(' && depth++ === 0) start = i + 1
    else if (c === ')' && --depth === 0) found.push(text.slice(start, i))
  }
  return found
}

/** A literal as the purposes are seeded: null, an integer, a string, or `array['…', …]`. */
function literal(sql: string): SqlValue {
  if (/^null$/i.test(sql)) return null
  if (/^-?\d+$/.test(sql)) return Number(sql)
  const string = /^'((?:[^']|'')*)'$/.exec(sql)
  if (string) return (string[1] ?? '').replaceAll("''", "'")
  const array = /^array\[(.*)\]$/is.exec(sql)
  if (array) {
    return splitTopLevel(array[1] ?? '').map((item) => {
      const value = literal(item)
      if (typeof value !== 'string') throw new Error(`Unreadable array item: ${item}`)
      return value
    })
  }
  throw new Error(`Unreadable SQL literal (extend purposes.test.ts): ${sql}`)
}

/**
 * Each purpose's row once every migration has run, in order. An `on conflict do nothing` insert
 * keeps a row already there; an update, or an upsert, of a purpose this test checks fails it
 * (it cannot read those yet: extend it).
 */
function purposesFromMigrations(): Map<string, Record<string, SqlValue>> {
  const rows = new Map<string, Record<string, SqlValue>>()
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    const sql = readFileSync(path.join(MIGRATIONS, name), 'utf8').replace(/--[^\n]*/g, '')
    for (const statement of sql.split(/;\s*$/m)) {
      const checked = Object.keys(UPLOAD_PURPOSES).some((key) => statement.includes(`'${key}'`))
      const updates = /update\s+public\.upload_purposes/i.test(statement) || (/insert\s+into\s+public\.upload_purposes/i.test(statement) && /do\s+update/i.test(statement))
      if (checked && updates) throw new Error(`${name} updates a checked purpose: extend purposes.test.ts to read it`)
      const insert = /insert\s+into\s+public\.upload_purposes\s*\(([^)]*)\)\s*values\s*([\s\S]*?)(on\s+conflict(?:\s*\([^)]*\))?\s+do\s+nothing)?\s*$/i.exec(statement.trim())
      if (!insert) continue
      const columns = (insert[1] ?? '').split(',').map((column) => column.trim())
      const keepExisting = insert[3] !== undefined
      for (const tuple of tuples(insert[2] ?? '')) {
        const values = splitTopLevel(tuple).map(literal)
        const row = Object.fromEntries(columns.map((column, i) => [column, values[i] ?? null]))
        const key = row.key
        if (typeof key !== 'string') throw new Error(`${name}: an upload purpose without a key`)
        if (!(keepExisting && rows.has(key))) rows.set(key, row)
      }
    }
  }
  return rows
}

describe('UPLOAD_PURPOSES', () => {
  const rows = purposesFromMigrations()

  it.each(Object.entries(UPLOAD_PURPOSES))('%s matches upload_purposes as the migrations leave it', (key, purpose) => {
    const row = rows.get(key)
    expect(row, `no upload_purposes row for ${key}`).toBeDefined()
    expect({ mimeTypes: row?.mime_types, maxBytes: row?.max_bytes, maxImageSide: row?.max_image_side }).toEqual({
      mimeTypes: [...purpose.mimeTypes],
      maxBytes: purpose.maxBytes,
      maxImageSide: purpose.maxImageSide,
    })
  })

  it('reads the seeded purposes (the parser still understands the migrations)', () => {
    expect(rows.get('signing_source')).toMatchObject({ mime_types: ['application/pdf'], max_bytes: 10_485_760, max_image_side: null })
  })
})
