// src/document-templates/template-engine.ts
import type { TemplateRenderContext } from './types'
import { KNOWN_VARIABLES } from './constants'

// =============================================================================
// TEMPLATE VARIABLE REGEX
// =============================================================================

/** Matches {{path.to.value}} template variables */
const VARIABLE_REGEX = /\{\{([^}]+)\}\}/g

// =============================================================================
// SAMPLE DATA (for preview rendering)
// =============================================================================

const SAMPLE_CONTEXT: TemplateRenderContext = {
  clinic: {
    name: 'CLINIQUE MANA INC',
    address: '300 \u2013 797 Boul. Lebourgneuf, Qc, G2J 0B5',
    representative: 'Madame Christine Sirois',
    representative_title: 'sa pr\u00e9sidente d\u00fbment autoris\u00e9e',
    legal_form:
      'corporation l\u00e9galement constitu\u00e9e en vertu de la Loi sur les soci\u00e9t\u00e9s par actions (Qu\u00e9bec)',
  },
  professional: {
    full_name: 'Jean Tremblay',
    email: 'jean.tremblay@exemple.com',
    phone: '(418) 555-0123',
    address: '123 Rue Exemple, Qu\u00e9bec, QC, G1A 1A1',
    profession: 'Psychologue',
    license_number: '12345-67',
  },
  today: '28 janvier 2026',
  pricing: {
    annexe_a_html: '<table><tr><td>Exemple de tableau de prix</td></tr></table>',
  },
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve a dot-notation path on a nested object.
 * e.g. getNestedValue({ a: { b: 'hello' } }, 'a.b') => 'hello'
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }

  return current
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Render a template by replacing {{path.to.value}} with context values.
 * Missing values are replaced with an empty string.
 */
export function renderTemplate(
  content: string,
  context: Record<string, unknown>,
): string {
  return content.replace(VARIABLE_REGEX, (_match, path: string) => {
    const trimmedPath = path.trim()
    const value = getNestedValue(context, trimmedPath)

    if (value === null || value === undefined) {
      return ''
    }

    return String(value)
  })
}

/**
 * Render a template with example/sample data for preview.
 */
export function renderTemplatePreview(content: string): string {
  return renderTemplate(content, SAMPLE_CONTEXT as unknown as Record<string, unknown>)
}

/**
 * Validate a template: find all variables used, flag unrecognized ones.
 *
 * Returns:
 * - variables: all unique variable paths found in the template
 * - recognized: variables that are in the KNOWN_VARIABLES list
 * - unrecognized: variables NOT in the KNOWN_VARIABLES list
 */
export function validateTemplate(content: string): {
  variables: string[]
  recognized: string[]
  unrecognized: string[]
} {
  const found = new Set<string>()
  let match: RegExpExecArray | null

  // Reset regex state
  const regex = new RegExp(VARIABLE_REGEX.source, VARIABLE_REGEX.flags)

  while ((match = regex.exec(content)) !== null) {
    found.add(match[1]!.trim())
  }

  const variables = Array.from(found)
  const knownSet = new Set<string>(KNOWN_VARIABLES)
  const recognized = variables.filter((v) => knownSet.has(v))
  const unrecognized = variables.filter((v) => !knownSet.has(v))

  return { variables, recognized, unrecognized }
}
