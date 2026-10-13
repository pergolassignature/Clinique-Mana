/**
 * A fake Intuit for the QuickBooks connection (plan §8, FQ): the consent page
 * (`/connect/oauth2`), the token endpoint (`/oauth2/v1/tokens/bearer`), the
 * revocation endpoint (`/v2/oauth2/tokens/revoke`) and the API calls the
 * functions make (`companyinfo`, `query` on Account and Customer, `customer`
 * create), over one in-memory company, as Intuit answers them. One fake for
 * the Deno tests (`fakeQbo().fetch`) and local development
 * (`scripts/fake-qbo.ts`, `npm run fake:qbo`). Test-only: no `index.ts`
 * imports it.
 *
 * Behaviour, as Intuit's:
 * - the consent page's « Autoriser » sends the browser to
 *   `redirect_uri?code=…&state=…&realmId=…`; a code is good once;
 * - the token endpoint wants the client in a Basic header (401
 *   `invalid_client` otherwise); `refresh_token` **rotates** the refresh
 *   token (the old one is then `invalid_grant`, as is a revoked one);
 * - the API wants a live bearer token of the company (401 otherwise), pages
 *   queries with `startposition` / `maxresults`, refuses a customer whose
 *   display name is taken (400, fault 6240);
 * - `failNext(match, status, fault?)` makes the next matching calls fail.
 * Error bodies carry `FAKE_ERROR_MARKER`, so tests can prove the function
 * never passes them on.
 */

export const FAKE_QBO_CLIENT_ID = 'local-dev-qbo-client-id'
export const FAKE_QBO_CLIENT_SECRET = 'local-dev-qbo-client-secret'
export const FAKE_QBO_REALM = '9130350000000001'
export const FAKE_ERROR_MARKER = 'FAKE-INTUIT-ERROR-BODY'
export const QBO_ACCESS_TTL_S = 3_600
export const QBO_REFRESH_TTL_S = 8_726_400

export interface FakeAccount {
  Id: string
  Name: string
  AcctNum?: string
  AccountType: string
  AccountSubType?: string
  Classification?: string
  Active: boolean
}

export interface FakeCustomer {
  Id: string
  SyncToken: string
  DisplayName: string
  GivenName?: string
  FamilyName?: string
  CompanyName?: string
  PrimaryEmailAddr?: { Address: string }
  PrimaryPhone?: { FreeFormNumber: string }
  Job?: boolean
  ParentRef?: { value: string }
  BillWithParent?: boolean
  Active: boolean
}

interface Grant {
  realmId: string
  refresh: string
  revoked: boolean
}

export interface FakeQboOptions {
  clientId?: string
  clientSecret?: string
  realmId?: string
  companyName?: string
  now?: () => number
}

export function fakeQbo(opts: FakeQboOptions = {}) {
  const clientId = opts.clientId ?? FAKE_QBO_CLIENT_ID
  const clientSecret = opts.clientSecret ?? FAKE_QBO_CLIENT_SECRET
  const realmId = opts.realmId ?? FAKE_QBO_REALM
  const now = opts.now ?? (() => Date.now())
  let companyName = opts.companyName ?? 'Clinique MANA (bac à sable)'
  let counter = 1
  const next = (prefix: string) =>
    `${prefix}-${counter++}-${crypto.randomUUID().slice(0, 8)}`

  const codes = new Map<
    string,
    { redirect: string; used: boolean; realmId: string }
  >()
  /** refresh token → grant (the current one; an old one maps to a dead grant). */
  const refreshes = new Map<string, { grant: Grant; current: boolean }>()
  const access = new Map<string, { grant: Grant; expiresAt: number }>()
  const accounts: FakeAccount[] = []
  const customers = new Map<string, FakeCustomer>()
  const calls: { method: string; path: string; query?: string }[] = []
  const failures: {
    match: string
    status: number
    fault?: string
    times: number
  }[] = []

  const error = (status: number, body: Record<string, unknown>) =>
    Response.json({ ...body, marker: FAKE_ERROR_MARKER }, { status })
  const fault = (status: number, code: string, type = 'ValidationFault') =>
    error(status, {
      Fault: {
        Error: [{
          Message: FAKE_ERROR_MARKER,
          Detail: FAKE_ERROR_MARKER,
          code,
        }],
        type,
      },
    })

  function issueTokens(grant: Grant) {
    const refresh = next('refresh')
    const token = next('access')
    grant.refresh = refresh
    refreshes.set(refresh, { grant, current: true })
    access.set(token, { grant, expiresAt: now() + QBO_ACCESS_TTL_S * 1000 })
    return {
      access_token: token,
      refresh_token: refresh,
      token_type: 'bearer',
      expires_in: QBO_ACCESS_TTL_S,
      x_refresh_token_expires_in: QBO_REFRESH_TTL_S,
    }
  }

  function basicOk(req: Request): boolean {
    const header = req.headers.get('Authorization') ?? ''
    if (!header.startsWith('Basic ')) return false
    try {
      return atob(header.slice(6)) === `${clientId}:${clientSecret}`
    } catch {
      return false
    }
  }

  function bearer(req: Request, realm: string): boolean {
    const token = (req.headers.get('Authorization') ?? '').replace(
      /^Bearer /,
      '',
    )
    const entry = access.get(token)
    return !!entry && !entry.grant.revoked && entry.expiresAt > now() &&
      entry.grant.realmId === realm
  }

  function select(entity: string, query: string) {
    const start = Number(/startposition\s+(\d+)/i.exec(query)?.[1] ?? 1)
    const max = Number(/maxresults\s+(\d+)/i.exec(query)?.[1] ?? 100)
    const rows = entity === 'Account' ? accounts : [...customers.values()]
    return rows.slice(start - 1, start - 1 + max)
  }

  async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    calls.push({
      method: req.method,
      path,
      query: url.searchParams.get('query') ?? undefined,
    })
    const failure = failures.find((f) =>
      f.times > 0 && `${req.method} ${path}`.includes(f.match)
    )
    if (failure) {
      failure.times--
      return failure.fault
        ? fault(failure.status, failure.fault)
        : error(failure.status, { error: 'server_error' })
    }

    if (path === '/connect/oauth2' && req.method === 'GET') {
      if (url.searchParams.get('client_id') !== clientId) {
        return new Response(`${FAKE_ERROR_MARKER}: invalid client`, {
          status: 400,
        })
      }
      const redirect = url.searchParams.get('redirect_uri') ?? ''
      const code = next('code')
      codes.set(code, { redirect, used: false, realmId })
      const target = new URL(redirect)
      target.searchParams.set('code', code)
      target.searchParams.set('state', url.searchParams.get('state') ?? '')
      target.searchParams.set('realmId', realmId)
      const escape = (s: string) =>
        s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll(
          '<',
          '&lt;',
        )
      return new Response(
        `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fausse page Intuit</title>
<style>body{font-family:system-ui;margin:3rem auto;max-width:28rem}button{font-size:1rem;padding:.6rem 1rem}</style></head>
<body><h1>Fausse page de connexion QuickBooks</h1><p>Entreprise : <strong>${
          escape(companyName)
        }</strong></p>
<p>Portée : <code>${escape(url.searchParams.get('scope') ?? '')}</code></p>
<p><a href="${
          escape(target.toString())
        }"><button type="button">Autoriser</button></a></p></body></html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      )
    }

    if (path === '/oauth2/v1/tokens/bearer' && req.method === 'POST') {
      if (!basicOk(req)) return error(401, { error: 'invalid_client' })
      const form = new URLSearchParams(await req.text())
      if (form.get('grant_type') === 'authorization_code') {
        const code = codes.get(form.get('code') ?? '')
        if (!code || code.used || code.redirect !== form.get('redirect_uri')) {
          return error(400, { error: 'invalid_grant' })
        }
        code.used = true
        return Response.json(
          issueTokens({ realmId: code.realmId, refresh: '', revoked: false }),
        )
      }
      if (form.get('grant_type') === 'refresh_token') {
        const entry = refreshes.get(form.get('refresh_token') ?? '')
        if (!entry || !entry.current || entry.grant.revoked) {
          return error(400, { error: 'invalid_grant' })
        }
        entry.current = false
        return Response.json(issueTokens(entry.grant))
      }
      return error(400, { error: 'unsupported_grant_type' })
    }

    if (path === '/v2/oauth2/tokens/revoke' && req.method === 'POST') {
      if (!basicOk(req)) return error(401, { error: 'invalid_client' })
      const body = await req.json().catch(() => ({})) as { token?: string }
      const entry = refreshes.get(body.token ?? '')
      if (entry) entry.grant.revoked = true
      return new Response(null, { status: 200 })
    }

    const api = /^\/v3\/company\/([^/]+)\/(.+)$/.exec(path)
    if (api) {
      const [, realm, rest] = api
      if (url.searchParams.get('minorversion') === null) {
        return fault(400, '2010')
      }
      if (!bearer(req, realm)) return fault(401, '3200', 'AUTHENTICATION')
      if (rest === `companyinfo/${realm}` && req.method === 'GET') {
        return Response.json({
          CompanyInfo: { CompanyName: companyName, Id: '1' },
        })
      }
      if (rest === 'query' && req.method === 'GET') {
        const query = url.searchParams.get('query') ?? ''
        const entity = /from\s+(\w+)/i.exec(query)?.[1]
        if (entity !== 'Account' && entity !== 'Customer') {
          return fault(400, '4000')
        }
        const rows = select(entity, query)
        return Response.json({
          QueryResponse: rows.length
            ? { [entity]: rows, startPosition: 1, maxResults: rows.length }
            : {},
        })
      }
      if (rest === 'customer' && req.method === 'POST') {
        const body = await req.json() as Partial<FakeCustomer>
        const name = body.DisplayName ?? ''
        if (!name || /:/.test(name)) return fault(400, '6000')
        if (
          [...customers.values()].some((c) =>
            c.DisplayName.toLowerCase() === name.toLowerCase()
          )
        ) return fault(400, '6240')
        if (body.ParentRef && !customers.has(body.ParentRef.value)) {
          return fault(400, '6000')
        }
        const id = String(1000 + customers.size + 1)
        const created: FakeCustomer = {
          ...body,
          Id: id,
          SyncToken: '0',
          DisplayName: name,
          Active: true,
        }
        customers.set(id, created)
        return Response.json({ Customer: created })
      }
      return fault(404, '610', 'ObjectNotFound')
    }
    return error(404, { error: 'not_found' })
  }

  return {
    handler,
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      handler(input instanceof Request ? input : new Request(input, init)),
    calls,
    accounts,
    customers,
    realmId,
    setCompanyName(name: string) {
      companyName = name
    },
    /** A code as if the consent page had been accepted. */
    issueCode(redirect: string): string {
      const code = next('code')
      codes.set(code, { redirect, used: false, realmId })
      return code
    },
    /** Tokens of a grant the company knows (a connection the tests start from). */
    grant(): { access_token: string; refresh_token: string } {
      return issueTokens({ realmId, refresh: '', revoked: false })
    },
    /** Every access token dies (Intuit's 1 h), the refresh tokens live on. */
    expireAccess() {
      for (const entry of access.values()) entry.expiresAt = 0
    },
    revokeAll() {
      for (const entry of refreshes.values()) entry.grant.revoked = true
    },
    isRevoked(refresh: string): boolean {
      return refreshes.get(refresh)?.grant.revoked ?? false
    },
    failNext(match: string, status: number, faultCode?: string, times = 1) {
      failures.push({ match, status, fault: faultCode, times })
    },
  }
}

export type FakeQbo = ReturnType<typeof fakeQbo>

/** The company GOrendezvous filled (fictional): Christine's accounts and a few customers. */
export function seedCompany(fake: FakeQbo): void {
  fake.accounts.push(
    {
      Id: '1',
      Name: 'Services',
      AccountType: 'Income',
      Classification: 'Revenue',
      Active: true,
    },
    {
      Id: '2',
      Name: 'Ventes',
      AccountType: 'Income',
      Classification: 'Revenue',
      Active: true,
    },
    {
      Id: '3',
      Name: 'Virement bancaire à recevoir',
      AcctNum: '1075',
      AccountType: 'Other Current Asset',
      Active: true,
    },
    {
      Id: '4',
      Name: 'Banque Stripe',
      AcctNum: '1070',
      AccountType: 'Bank',
      Active: true,
    },
    {
      Id: '5',
      Name: 'Fonds non déposés',
      AccountType: 'Other Current Asset',
      AccountSubType: 'UndepositedFunds',
      Active: true,
    },
    { Id: '6', Name: 'Compte courant', AccountType: 'Bank', Active: true },
    {
      Id: '7',
      Name: 'Honoraires - Psychologues',
      AccountType: 'Expense',
      Active: true,
    },
    {
      Id: '8',
      Name: 'Honoraires - Travailleurs sociaux',
      AccountType: 'Expense',
      Active: true,
    },
    { Id: '9', Name: 'Frais bancaires', AccountType: 'Expense', Active: true },
  )
  const people: [string, string, string | null, string | null][] = [
    ['Amélie', 'Tremblay', 'amelie.tremblay@example.test', null],
    ['Marc-Antoine', 'Côté', 'macote@example.test', '(514) 555-0142'],
    ['Julie', 'Bélanger', null, '438 555 0199'],
    ['Jonathan', 'Roy', 'jroy@example.test', null],
    ['Sophie', 'Gagnon', 'sophie.gagnon@example.test', null],
  ]
  for (const [first, last, email, phone] of people) {
    const id = String(100 + fake.customers.size + 1)
    fake.customers.set(id, {
      Id: id,
      SyncToken: '0',
      DisplayName: `${first} ${last}`,
      GivenName: first,
      FamilyName: last,
      ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
      ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}),
      Active: true,
    })
  }
  fake.customers.set('199', {
    Id: '199',
    SyncToken: '0',
    DisplayName: 'IVAC',
    CompanyName: 'IVAC',
    Active: true,
  })
}
