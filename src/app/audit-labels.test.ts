import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDITED_TABLES, fieldLabel, tableLabel } from '@/core/audit/labels'
import type { ModuleAuditLabels } from '@/core/modules/types'
import { ALL_MODULES } from './modules'

/**
 * Every table the migrations audit (`private.audit_trigger`) reads in French in the Journal
 * d'audit (gap audit V10): its name, each of its columns (from the generated types), and a place
 * in the « Section » filter, from core (`AUDITED_TABLES`) or from the module that owns it
 * (`ModuleManifest.audit`). A new audited table or column fails here until it has its labels.
 */

const root = path.resolve(__dirname, '../..')
const MIGRATIONS = path.join(root, 'supabase/migrations')

/** The tables with an audit trigger, from every migration (`create trigger … on public.<table> … private.audit_trigger(…)`). */
function auditedTables(): string[] {
  const tables = new Set<string>()
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '')
    for (const match of sql.matchAll(/create\s+trigger\s+\w+[^;]*?\son\s+public\.(\w+)[^;]*?execute\s+(?:function|procedure)\s+private\.audit_trigger\s*\(/gi)) {
      tables.add(match[1]!)
    }
    for (const match of sql.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?\w+_audit\s+on\s+public\.(\w+)/gi)) tables.delete(match[1]!)
  }
  return [...tables].sort()
}

/** A table's columns, from the generated types (`Tables.<table>.Row`). */
function columnsOf(types: string, table: string): string[] {
  const start = types.indexOf(`\n      ${table}: {\n        Row: {\n`)
  if (start < 0) throw new Error(`${table} is not in database.types.ts`)
  const body = types.slice(start).split('Row: {\n')[1]!.split('\n        }')[0]!
  return body.split('\n').map((line) => line.trim().split(':')[0]!)
}

async function loadModuleLabels(): Promise<ModuleAuditLabels[]> {
  return Promise.all(ALL_MODULES.flatMap((m) => (m.audit ? [m.audit()] : [])))
}

describe('Journal d’audit labels', () => {
  const tables = auditedTables()
  const types = readFileSync(path.join(root, 'src/core/supabase/database.types.ts'), 'utf8')

  it('finds the audited tables in the migrations', () => {
    expect(tables.length).toBeGreaterThan(50)
    expect(tables).toContain('organizations')
    expect(tables).toContain('professionals')
  })

  it('offers every audited table in the « Section » filter, once', async () => {
    const modules = await loadModuleLabels()
    const offered = [...AUDITED_TABLES, ...modules.flatMap((m) => m.tables)]
    expect(new Set(offered).size).toBe(offered.length)
    expect([...offered].sort()).toEqual(tables)
  })

  it('names every audited table and each of its columns in French', async () => {
    const modules = await loadModuleLabels()
    const missing: string[] = []
    for (const table of tables) {
      if (tableLabel(table, modules) === table) missing.push(table)
      for (const column of columnsOf(types, table)) {
        if (fieldLabel(table, column, modules) === column) missing.push(`${table}.${column}`)
      }
    }
    expect(missing).toEqual([])
  })
})
