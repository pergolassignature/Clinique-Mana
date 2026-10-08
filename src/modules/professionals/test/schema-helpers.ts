import type { z } from 'zod'

/** The French message of the first issue at `path` (joined with '.'; '' for the root), or undefined when the value parses. Test-only. */
export function errorAt(schema: z.ZodType, values: unknown, path = ''): string | undefined {
  const result = schema.safeParse(values)
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path.join('.') === path)?.message
}
