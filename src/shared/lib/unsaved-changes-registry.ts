// Outside React on purpose: the app's error boundary (above every provider) and the stale-chunk
// recovery (`app-update.ts`) need to know whether a reload would lose unsaved edits. Kept out of
// unsaved-changes-context.ts, which the login page does not load.

const checks = new Set<() => boolean>()

/**
 * Registers a check for unsaved edits (UnsavedChangesProvider registers its own). Returns the
 * function that removes it.
 */
export function registerUnsavedChangesCheck(check: () => boolean): () => void {
  checks.add(check)
  return () => {
    checks.delete(check)
  }
}

/** Whether any registered unsaved-changes guard has dirty forms right now. */
export function hasUnsavedChanges(): boolean {
  for (const check of checks) if (check()) return true
  return false
}
