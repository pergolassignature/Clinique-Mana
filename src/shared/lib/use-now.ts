import { useEffect, useState } from 'react'

/**
 * The current time (ms), refreshed every `intervalMs`: for values that depend on the clock while a
 * page stays open (a status that changes at midnight, a window that closes after 24 h).
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
