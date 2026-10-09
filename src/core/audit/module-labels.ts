import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import type { ModuleAuditLabels } from '@/core/modules/types'
import { auditKeys } from './hooks'

/** One enabled module's audit labels, as the shell hands them to the journal (`ModuleManifest.audit`). */
export interface ModuleAuditSource {
  /** The module's key (`professionals`). */
  key: string
  /** Its name: the heading of its tables in the « Section » filter. */
  labelKey: TranslationKey
  load: () => Promise<ModuleAuditLabels>
}

/**
 * The enabled modules' audit labels (AuthenticatedApp provides them; core never imports a module).
 * Empty outside the shell, as in a test that does not provide it.
 */
export const ModuleAuditContext = createContext<readonly ModuleAuditSource[]>([])

/** A module's labels, once loaded, with the heading of its group in the « Section » filter. */
export interface LoadedModuleAudit {
  key: string
  labelKey: TranslationKey
  labels: ModuleAuditLabels
}

/**
 * Loads the enabled modules' audit labels (one chunk each, cached for the session): undefined while
 * they load. A failed chunk (a deploy since the page loaded) is thrown to the section's boundary,
 * which recovers from a stale chunk.
 */
export function useModuleAuditLabels(): readonly LoadedModuleAudit[] | undefined {
  const sources = useContext(ModuleAuditContext)
  const { data } = useQuery({
    queryKey: auditKeys.moduleLabels(sources.map((source) => source.key)),
    queryFn: () => Promise.all(sources.map(async ({ key, labelKey, load }) => ({ key, labelKey, labels: await load() }))),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    throwOnError: true,
  })
  return data
}

/** The French text of a key built from database names, or undefined when there is none. */
export function lookupAuditText(key: string): string | undefined {
  // `t` returns the key itself when nothing (or no string) is there: an unknown table or column,
  // a name with a dot, or an inherited property such as `toString`.
  const text = t(key as TranslationKey)
  return text === key ? undefined : text
}

/** A stored code that may name an i18n key: lower-case letters, digits and `_` only. */
const CODE = /^[a-z0-9_]{1,60}$/

interface I18nAuditLabelsOptions {
  /** The module's i18n prefix: `modules.professionals.audit`. */
  prefix: string
  /** Its audited tables, in the « Section » filter's order. */
  tables: readonly string[]
  /** Values computed by the module (statuses through its own helper, amounts, months…); undefined falls back to the i18n codes. */
  value?: (table: string, column: string, value: unknown) => string | undefined
  /** Its own sources (`import`), as i18n keys under `<prefix>.sources`. */
  sources?: readonly string[]
}

/**
 * A module's `ModuleAuditLabels` from its i18n, for its tables only:
 * - `<prefix>.tables.<table>`: the table's name;
 * - `<prefix>.fields.<table>.<column>`: a column's name;
 * - `<prefix>.values.<table>.<column>.<code>`: a stored code (`in_review` → « À réviser »), after
 *   `value` had nothing to say;
 * - `<prefix>.sources.<source>`: one of `sources`.
 */
export function i18nAuditLabels({ prefix, tables, value, sources = [] }: I18nAuditLabelsOptions): ModuleAuditLabels {
  const own = new Set(tables)
  return {
    tables,
    tableLabel: (table) => (own.has(table) ? lookupAuditText(`${prefix}.tables.${table}`) : undefined),
    fieldLabel: (table, column) => (own.has(table) ? lookupAuditText(`${prefix}.fields.${table}.${column}`) : undefined),
    value: (table, column, stored) => {
      if (!own.has(table)) return undefined
      const computed = value?.(table, column, stored)
      if (computed !== undefined) return computed
      return typeof stored === 'string' && CODE.test(stored) ? lookupAuditText(`${prefix}.values.${table}.${column}.${stored}`) : undefined
    },
    sourceLabel: (source) => (sources.includes(source) ? lookupAuditText(`${prefix}.sources.${source}`) : undefined),
  }
}
