/**
 * The booking page's helpers (Demandes D3c): the proof-of-work the page solves (D-7) and the source
 * it captures (R-74). Pure, browser APIs only.
 */

const encoder = new TextEncoder()

/** Leading zero bits of a SHA-256 digest. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    return bits + Math.clz32(byte) - 24
  }
  return bits
}

/**
 * Finds `n` such that SHA-256(`<ticket>:<n>`) starts with `bits` zero bits: about 2^bits hashes
 * (16 bits: well under a second). Yields to the page every 2 000 tries; stops when `signal` aborts.
 */
export async function solveCheck(ticket: string, bits: number, signal?: AbortSignal): Promise<string> {
  for (let n = 0; ; n++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${ticket}:${n}`)))
    if (leadingZeroBits(digest) >= bits) return String(n)
    if (n % 2_000 === 1_999) await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'] as const

/** A URL without its fragment (a link token never leaves the page), cut to 500 characters. */
const clean = (url: string) => url.split('#')[0]!.slice(0, 500)

/**
 * Where the person came from (R-74): the utm_* parameters of the page's address, the referrer (the
 * website's page with the button, when the browser gives it) and the landing page (the website may
 * pass its own with `?landing=`; else this page's address as opened, which carries the campaign).
 */
export function captureSource(href: string, referrer: string): { utm: Record<string, string>; referrer: string | null; landing: string | null } {
  const url = new URL(href)
  const utm: Record<string, string> = {}
  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key)?.trim()
    if (value) utm[key] = value.slice(0, 200)
  }
  const landing = url.searchParams.get('landing')?.trim()
  return {
    utm,
    referrer: referrer ? clean(referrer) : null,
    landing: landing ? clean(landing) : clean(url.toString()),
  }
}

/** A phone typed the North American way (« 514 555-0101 », « +1 514… ») → E.164, else null. */
export function toE164(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, '')
  if (input.trim().startsWith('+')) return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
