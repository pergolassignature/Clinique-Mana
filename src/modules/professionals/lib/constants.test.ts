import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_PERIODS,
  GENDERS,
  MOTIF_CATEGORY_ICONS,
  PAYER_TYPES,
  PROFESSIONAL_STATUSES,
  READINESS_MISSING,
  RECORD_TABS,
  REFERENCE_KINDS,
} from './constants'

const root = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')
const REFERENCE = read('20261008083000_professionals_reference_data.sql')
const CORE = read('20261008092451_professionals_core.sql')
const LIFECYCLE = read('20261008100634_professionals_lifecycle.sql')

/** The quoted values of a SQL list, e.g. `in ('a', 'b')`. */
const quoted = (sql: string) => [...sql.matchAll(/'([^']+)'/g)].map((m) => m[1])

/** The text of the first match of `pattern` (group 1), or a failing empty string. */
const section = (sql: string, pattern: RegExp) => pattern.exec(sql)?.[1] ?? ''

describe('constants mirror the SQL checks', () => {
  it('statuses', () => {
    expect(quoted(section(CORE, /professionals_status_check check \(status in \(([^)]*)\)/))).toEqual([...PROFESSIONAL_STATUSES])
  })

  it('genders', () => {
    expect(quoted(section(CORE, /professionals_gender_check check \(gender in \(([^)]*)\)/))).toEqual([...GENDERS])
  })

  it('availability periods', () => {
    expect(quoted(section(CORE, /availability_periods <@ array\[([^\]]*)\]/))).toEqual([...AVAILABILITY_PERIODS])
  })

  it('payer types', () => {
    expect(quoted(section(CORE, /payer_type in \(([^)]*)\)/))).toEqual([...PAYER_TYPES])
  })

  it('motif category icons', () => {
    expect(quoted(section(REFERENCE, /motif_categories_icon_check check \(icon in \(([^)]*)\)/))).toEqual([...MOTIF_CATEGORY_ICONS])
  })

  it('readiness gaps, in the order the RPC lists them', () => {
    const missing = section(LIFECYCLE, /'missing', pg_catalog\.to_jsonb\(pg_catalog\.array_remove\(array\[([\s\S]*?)\], null\)/)
    expect([...missing.matchAll(/then '([a-z_]+)'/g)].map((m) => m[1])).toEqual([...READINESS_MISSING])
  })

  it('reference kinds are the nine list tables', () => {
    for (const kind of REFERENCE_KINDS) expect(REFERENCE).toContain(`create table public.${kind} (`)
    expect(REFERENCE_KINDS).toHaveLength(9)
  })

  it('record tabs are the seven of P4-13, as URL segments', () => {
    expect(RECORD_TABS).toEqual(['apercu', 'jumelage', 'profil-public', 'identite', 'documents', 'remuneration', 'historique'])
  })
})
