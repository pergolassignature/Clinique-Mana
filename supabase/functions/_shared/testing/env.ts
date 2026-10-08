/**
 * Test helpers for code that reads `Deno.env` or writes to the console.
 * Test-only: no `index.ts` imports this folder, so it is never deployed.
 */

/** Runs fn with the given env vars set (undefined = unset), then restores them. */
export async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(vars).map((k) => [k, Deno.env.get(k)]),
  )
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, value] of Object.entries(v)) {
      if (value === undefined) Deno.env.delete(k)
      else Deno.env.set(k, value)
    }
  }
  apply(vars)
  try {
    await fn()
  } finally {
    apply(previous)
  }
}

/** Silences `console[level]` while fn runs and returns the recorded calls. */
export async function captureConsole(
  level: 'error' | 'warn' | 'info' | 'log',
  fn: () => void | Promise<void>,
): Promise<unknown[][]> {
  const original = console[level]
  const calls: unknown[][] = []
  console[level] = (...args: unknown[]) => calls.push(args)
  try {
    await fn()
  } finally {
    console[level] = original
  }
  return calls
}
