import type { z } from 'zod'

/** The French message of the first issue at `path` (joined with '.'; '' for the root), or undefined when the value parses. Test-only. */
export function errorAt(schema: z.ZodType, values: unknown, path = ''): string | undefined {
  const result = schema.safeParse(values)
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path.join('.') === path)?.message
}

/** The first French message per path (joined with '.'), or {} when the value parses. Test-only. */
export function issuesOf(schema: z.ZodType, values: unknown): Record<string, string> {
  const result = schema.safeParse(values)
  if (result.success) return {}
  const issues: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.join('.')
    if (!(path in issues)) issues[path] = issue.message
  }
  return issues
}
