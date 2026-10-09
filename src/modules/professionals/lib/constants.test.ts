import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_PERIODS,
  DOCUMENT_EXPIRY_RULES,
  DOCUMENT_MIME_TYPES,
  DOCUMENT_STATUSES,
  PHOTO_MIME_TYPES,
  GENDERS,
  MOTIF_CATEGORY_ICONS,
  PAYER_TYPES,
  PROFESSIONAL_STATUSES,
  READINESS_DOCUMENT_MISSING,
  READINESS_MISSING,
  RECORD_TABS,
  recordPath,
  REFERENCE_KINDS,
} from './constants'

const root = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')
const REFERENCE = read('20261008133511_professionals_reference_data.sql')
const CORE = read('20261008133537_professionals_core.sql')
const LIFECYCLE = read('20261008133549_professionals_lifecycle.sql')
const DOCUMENTS = read('20261009000253_professionals_documents.sql')

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

  it('document gaps, in the order the readiness view lists them (4c.2)', () => {
    const missing = section(DOCUMENTS, /pg_catalog\.array_remove\(array\[([\s\S]*?)\]::text\[\], null\) as documents_missing/)
    expect([...missing.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...READINESS_DOCUMENT_MISSING])
  })

  it('reference kinds are the eight list tables (no approaches, P4-240) and the document types (4c.2)', () => {
    for (const kind of REFERENCE_KINDS.filter((k) => k !== 'document_types')) expect(REFERENCE).toContain(`create table public.${kind} (`)
    expect(DOCUMENTS).toContain('create table public.document_types (')
    expect(REFERENCE_KINDS).toHaveLength(9)
    expect(REFERENCE).not.toContain('create table public.specialties')
  })

  it('document statuses, expiry rules and file types', () => {
    expect(quoted(section(DOCUMENTS, /professional_documents_status_check check \(status in \(([^)]*)\)/))).toEqual([...DOCUMENT_STATUSES])
    expect(quoted(section(DOCUMENTS, /document_types_expiry_rule_check check \(expiry_rule in \(([^)]*)\)/))).toEqual([...DOCUMENT_EXPIRY_RULES])
    expect(quoted(section(DOCUMENTS, /accepted_mime <@ array\[([^\]]*)\]/))).toEqual([...DOCUMENT_MIME_TYPES])
    expect(quoted(section(DOCUMENTS, /document_types_photo_mime_check check \(key <> 'photo' or accepted_mime <@ array\[([^\]]*)\]/))).toEqual([...PHOTO_MIME_TYPES])
    expect(DOCUMENTS).toContain("('professional_document', 'professionals', 'documents', 'professionals.manage', 'professionals.view', null, 10485760")
    expect(DOCUMENTS).toContain("('professional_self_document', 'professionals', 'documents', 'professionals.self', 'professionals.view',")
    expect(DOCUMENTS).toContain('max_bytes between 102400 and 10485760')
  })

  it('record tabs are the seven of P4-13, as URL segments', () => {
    expect(RECORD_TABS).toEqual(['apercu', 'jumelage', 'profil-public', 'identite', 'documents', 'remuneration', 'historique'])
  })

  it('a record opens on « Aperçu » unless a tab is named', () => {
    expect(recordPath('p1')).toBe('/professionnels/p1/apercu')
    expect(recordPath('p1', 'historique')).toBe('/professionnels/p1/historique')
  })
})
