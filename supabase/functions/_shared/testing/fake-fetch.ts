/**
 * A `fetch` double: a route table keyed by `METHOD origin+path` (query string
 * ignored), with a call log. Test-only: never deployed.
 */

/** Answers one request. Throwing simulates a network error. */
export type Responder = (req: Request) => Response | Promise<Response>

/** One logged request; `body` is read from a clone, so responders can read it too. */
export interface FetchCall {
  method: string
  url: string
  headers: Headers
  body: string
}

/**
 * Builds a fake fetch. A route is one responder (reused) or a list used in
 * order (one per call; running out throws). An unknown route throws.
 */
export function fakeFetch(
  routes: Record<string, Responder | Responder[]>,
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const used = new Map<string, number>()
  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const key = `${req.method} ${url.origin}${url.pathname}`
    calls.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: await req.clone().text(),
    })
    const route = routes[key]
    if (route === undefined) throw new Error(`fake-fetch: no route for ${key}`)
    if (!Array.isArray(route)) return await route(req)
    const index = used.get(key) ?? 0
    used.set(key, index + 1)
    if (index >= route.length) {
      throw new Error(`fake-fetch: no response left for ${key}`)
    }
    return await route[index](req)
  }
  return { fetch: fake as typeof fetch, calls }
}
