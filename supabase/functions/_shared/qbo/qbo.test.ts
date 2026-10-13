import { assert, assertEquals, assertFalse, assertRejects } from '@std/assert'
import { QboClient, QboError, qboQuote } from './client.ts'
import { qboCredentials, ReconnectNeeded } from './credentials.ts'
import {
  cleanName,
  dossierNames,
  ensureBillingCustomer,
  type LinkStore,
  type QboPerson,
} from './customers.ts'
import { QBO_API_ORIGINS, qboOrigins, redirectUri } from './env.ts'
import { customerRow, rowHash, runQboSync } from './sync.ts'
import { FAKE_ERROR_MARKER } from '../testing/fake-qbo.ts'
import { FAKE_ORIGIN, ORG_ID, qboHarness } from '../testing/qbo-fixtures.ts'

const noSleep = () => Promise.resolve()

function client(h: ReturnType<typeof qboHarness>) {
  return new QboClient({
    fetch: h.deps.fetch,
    origin: FAKE_ORIGIN,
    realmId: h.intuit.realmId,
    accessToken: h.state.connection!.access,
    sleep: noSleep,
  })
}

const ctx = (h: ReturnType<typeof qboHarness>) => ({
  client: h.service.client,
  fetch: h.deps.fetch,
  origins: qboOrigins(h.deps.env),
  now: h.deps.now,
  orgId: ORG_ID,
})
const APP = {
  clientId: 'local-dev-qbo-client-id',
  clientSecret: 'local-dev-qbo-client-secret',
}

Deno.test('env: Intuit by default; the fake only while APP_URL is local; a fixed return path', () => {
  const hosted = qboOrigins((k) =>
    ({
      APP_URL: 'https://app.cliniquemana.com',
      QBO_API_BASE_URL: 'http://evil.test',
    })[k]
  )
  assertEquals(hosted.api('production'), QBO_API_ORIGINS.production)
  assertEquals(hosted.api('sandbox'), QBO_API_ORIGINS.sandbox)
  assertEquals(hosted.oauth, 'https://oauth.platform.intuit.com')
  const local = qboOrigins((k) =>
    ({
      APP_URL: 'http://localhost:5173',
      QBO_API_BASE_URL: 'http://127.0.0.1:55394/x',
    })[k]
  )
  assertEquals(local.api('production'), 'http://127.0.0.1:55394')
  assertEquals(
    redirectUri((k) => ({ APP_URL: 'https://app.cliniquemana.com/' })[k]),
    'https://app.cliniquemana.com/facturation/retour-quickbooks',
  )
  assertEquals(
    redirectUri((k) => ({ APP_URL: 'http://app.example.test' })[k]),
    null,
  )
})

Deno.test('client: pages every query, pins minorversion, quotes values', async () => {
  const h = qboHarness({ connected: true })
  for (let i = 0; i < 1_200; i++) {
    h.intuit.customers.set(String(5_000 + i), {
      Id: String(5_000 + i),
      SyncToken: '0',
      DisplayName: `C ${i}`,
      Active: true,
    })
  }
  const rows = await client(h).customers()
  assertEquals(rows.length, 1_206)
  const queries = h.intuit.calls.filter((c) => c.path.endsWith('/query'))
  assertEquals(queries.length, 2)
  assert(queries[1].query!.includes('startposition 1001'))
  assertEquals(qboQuote("O'Brien \\ x"), "'O\\'Brien \\\\ x'")
})

Deno.test('client: a throttle is retried; a taken name is duplicate_name; Intuit bodies stay out', async () => {
  const h = qboHarness({ connected: true })
  h.intuit.failNext('/query', 429)
  assertEquals((await client(h).accounts()).length, 9)
  await client(h).createCustomer({ DisplayName: 'Nouveau' })
  const error = await assertRejects(
    () => client(h).createCustomer({ DisplayName: 'nouveau' }),
    QboError,
  )
  assertEquals([error.code, error.faultCode], ['duplicate_name', '6240'])
  assertFalse(error.message.includes(FAKE_ERROR_MARKER))
  h.intuit.expireAccess()
  assertEquals(
    (await assertRejects(() => client(h).companyName(), QboError)).code,
    'unauthorized',
  )
})

Deno.test('credentials: refreshed ahead of expiry, both tokens rotated and stored', async () => {
  const h = qboHarness({ connected: true })
  const before = h.state.connection!.refresh
  assertEquals(
    (await qboCredentials(ctx(h), APP)).accessToken,
    h.state.connection!.access,
  )
  h.advance(56 * 60_000)
  const fresh = await qboCredentials(ctx(h), APP)
  assert(h.state.connection!.refresh !== before)
  assertEquals(fresh.accessToken, h.state.connection!.access)
  assertEquals(h.rpcNames().filter((n) => n === 'set_qbo_tokens').length, 1)
})

Deno.test('credentials: a lost rotation race uses the winner; a dead grant marks needs_reconnect', async () => {
  const h = qboHarness({ connected: true })
  // Another pass rotated first: Intuit refuses the old refresh token, the stored one is newer.
  const oldRefresh = h.state.connection!.refresh
  const winner = await qboCredentials(ctx(h), APP, { force: true })
  h.state.connection!.refresh = oldRefresh
  let reads = 0
  const racing = qboHarness({
    connected: true,
    rpc: {
      get_qbo_credentials: () => {
        reads++
        return {
          data: [{
            connection_id: 'c',
            realm_id: h.intuit.realmId,
            environment: 'sandbox',
            status: 'connected',
            access_token: reads === 1 ? 'stale' : winner.accessToken,
            refresh_token: reads === 1 ? 'already-rotated' : 'the-winners',
            access_token_expires_at: '2026-10-13T12:00:00.000Z',
          }],
          error: null,
        }
      },
    },
  })
  assertEquals(
    (await qboCredentials(ctx(racing), APP, { force: true })).accessToken,
    winner.accessToken,
  )
  assertFalse(racing.rpcNames().includes('set_qbo_connection_status'))

  const dead = qboHarness({ connected: true })
  dead.intuit.revokeAll()
  await assertRejects(
    () => qboCredentials(ctx(dead), APP, { force: true }),
    ReconnectNeeded,
  )
  assertEquals(dead.state.connection!.status, 'needs_reconnect')
})

const people = {
  mother: {
    clientId: 'p1',
    clientNumber: 5678,
    firstName: 'Marie',
    lastName: 'Lavoie',
    email: 'marie@example.test',
  },
  father: {
    clientId: 'p2',
    clientNumber: 5679,
    firstName: 'Paul',
    lastName: 'Lavoie',
  },
  child: {
    clientId: 'c1',
    clientNumber: 1234,
    firstName: 'Léa',
    lastName: 'Lavoie',
  },
} satisfies Record<string, QboPerson>

function memoryStore(): LinkStore & {
  links: {
    kind: string
    payerClientId: string
    clientId?: string
    qboCustomerId: string
  }[]
} {
  const links: {
    kind: string
    payerClientId: string
    clientId?: string
    qboCustomerId: string
  }[] = []
  return {
    links,
    payer: (p) =>
      Promise.resolve(
        links.find((l) => l.kind === 'payer' && l.payerClientId === p)
          ?.qboCustomerId ?? null,
      ),
    dossier: (p, c) =>
      Promise.resolve(
        links.find((l) =>
          l.kind === 'dossier' && l.payerClientId === p && l.clientId === c
        )?.qboCustomerId ?? null,
      ),
    record: (link) => {
      links.push(link)
      return Promise.resolve()
    },
  }
}

Deno.test('customers: payer parent, (payer, dossier) sub-customer billed with the parent, never twice', async () => {
  const h = qboHarness({ connected: true })
  const store = memoryStore()
  const first = await ensureBillingCustomer(
    client(h),
    store,
    people.mother,
    people.child,
  )
  const parent = h.intuit.customers.get(first.parentId)!
  const sub = h.intuit.customers.get(first.customerId)!
  assertEquals(parent.DisplayName, 'Marie Lavoie')
  assertEquals([
    sub.DisplayName,
    sub.Job,
    sub.ParentRef?.value,
    sub.BillWithParent,
  ], ['N° 1234 · Léa L.', true, first.parentId, true])
  const again = await ensureBillingCustomer(
    client(h),
    store,
    people.mother,
    people.child,
  )
  assertEquals(again, first)
  assertEquals(h.intuit.customers.size, 6 + 2)
  // The other parent: their own parent customer and their own sub-customer of the same dossier.
  const other = await ensureBillingCustomer(
    client(h),
    store,
    people.father,
    people.child,
  )
  assertEquals(
    h.intuit.customers.get(other.customerId)!.DisplayName,
    'N° 1234 · Léa L. (payé par N° 5679)',
  )
  assertEquals(store.links.map((l) => l.kind), [
    'payer',
    'dossier',
    'payer',
    'dossier',
  ])
})

Deno.test('customers: a matched GOrendezvous customer is the parent; a taken name gets the file number', async () => {
  const h = qboHarness({ connected: true })
  const store = memoryStore()
  store.links.push({ kind: 'payer', payerClientId: 'p1', qboCustomerId: '101' })
  const billed = await ensureBillingCustomer(
    client(h),
    store,
    people.mother,
    people.mother,
  )
  assertEquals(billed.parentId, '101')
  assertEquals(
    h.intuit.customers.get(billed.customerId)!.ParentRef?.value,
    '101',
  )
  // « Amélie Tremblay » exists (GOrendezvous made it, not matched): the new parent is numbered.
  const amelie = {
    clientId: 'p9',
    clientNumber: 42,
    firstName: 'Amélie',
    lastName: 'Tremblay',
  }
  const created = await ensureBillingCustomer(
    client(h),
    memoryStore(),
    amelie,
    amelie,
  )
  assertEquals(
    h.intuit.customers.get(created.parentId)!.DisplayName,
    'Amélie Tremblay (N° 42)',
  )
  assertEquals(cleanName('A: B\tC'), 'A B C')
  assertEquals(
    dossierNames(people.mother, { ...people.child, lastName: '' })[0],
    'N° 1234 · Léa',
  )
})

Deno.test('sync: the company, its accounts and customers, then the matching; nothing written to QuickBooks', async () => {
  const h = qboHarness({ connected: true })
  const result = await runQboSync({
    ...ctx(h),
    softDeadline: Date.now() + 60_000,
    sleep: noSleep,
  }, APP)
  assertEquals([
    result.status,
    result.accounts,
    result.customers,
    result.matched,
    result.pending,
  ], ['ok', 9, 6, 6, false])
  assertEquals(
    (h.state.accounts as { id: string; acct_num: string | null }[]).find((a) =>
      a.id === '3'
    )?.acct_num,
    '1075',
  )
  const amelie = h.state.customers.get('101')!
  assertEquals([amelie.given_name, amelie.email, amelie.is_job], [
    'Amélie',
    'amelie.tremblay@example.test',
    false,
  ])
  assertEquals(h.state.customers.get('102')!.phones, ['(514) 555-0142'])
  assertEquals(h.state.finished.at(-1)?.p_status, 'ok')
  assertEquals(
    h.intuit.calls.filter((c) =>
      c.method !== 'GET' && c.path.startsWith('/v3/')
    ).length,
    0,
  )
  // A second pass: nothing changed, nothing to match.
  const again = await runQboSync({
    ...ctx(h),
    softDeadline: Date.now() + 60_000,
    sleep: noSleep,
  }, APP)
  assertEquals(again.matched, 0)
})

Deno.test('sync: a 401 refreshes once and goes on; Intuit down is recorded failed with a code', async () => {
  const h = qboHarness({ connected: true })
  h.intuit.expireAccess()
  // The stored expiry is still ahead: the first call meets the 401.
  const result = await runQboSync({
    ...ctx(h),
    softDeadline: Date.now() + 60_000,
    sleep: noSleep,
  }, APP)
  assertEquals(result.status, 'ok')
  assertEquals(h.rpcNames().filter((n) => n === 'set_qbo_tokens').length, 1)

  const down = qboHarness({ connected: true })
  down.intuit.failNext('/query', 503, undefined, 5)
  const failed = await runQboSync({
    ...ctx(down),
    softDeadline: Date.now() + 60_000,
    sleep: noSleep,
  }, APP)
  assertEquals([failed.status, failed.errorCode], [
    'failed',
    'qbo_provider_error',
  ])
  assertEquals(down.state.finished.at(-1)?.p_error_code, 'qbo_provider_error')
})

Deno.test('sync: the hash follows what the matching reads, not the active flag', async () => {
  const base = customerRow({
    Id: '1',
    DisplayName: 'A B',
    GivenName: 'A',
    FamilyName: 'B',
    Active: true,
  })
  assertEquals(await rowHash(base), await rowHash({ ...base, active: false }))
  assert(await rowHash(base) !== await rowHash({ ...base, email: 'a@b.test' }))
  assertEquals((await rowHash(base)).length, 32)
})
