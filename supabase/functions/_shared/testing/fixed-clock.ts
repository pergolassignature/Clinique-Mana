/** A controllable clock for `Deps.now`. Test-only: never deployed. */

/** A clock fixed at `iso`; `now()` returns a new Date, `advance(ms)` moves it. */
export function fixedClock(
  iso: string,
): { now: () => Date; advance: (ms: number) => void } {
  let current = new Date(iso).getTime()
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms
    },
  }
}
