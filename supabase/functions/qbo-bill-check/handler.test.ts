import { assertEquals, assertFalse } from '@std/assert'
import { createHandler, STILL_THERE } from './handler.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { FAKE_ERROR_MARKER } from '../_shared/testing/fake-qbo.ts'
import {
  ADMIN_ID,
  ORG_ID,
  qboHarness,
  type QboHarnessOptions,
} from '../_shared/testing/qbo-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/qbo-bill-check'
const PERIOD = '00000000-0000-4000-8000-0000000000f5'
const BILL = '5001'

const post = (
  body: unknown = { period_id: PERIOD },
  token: string | null = 'tok',
) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)

/** A connected clinic whose period has the Bill 5001 in the fake company; the two RPCs recorded. */
function setup(opts: QboHarnessOptions = {}) {
  const cleared: Record<string, unknown>[] = []
  const h = qboHarness({
    connected: true,
    permissions: ['billing.payroll'],
    ...opts,
    rpc: {
      qbo_bill_to_check_for_service: { data: { bill_id: BILL } },
      clear_qbo_bill_for_service: (args) => {
        cleared.push(args)
        return { data: null }
      },
      ...opts.rpc,
    },
  })
  h.intuit.documents.push({
    entity: 'bill',
    id: BILL,
    body: { VendorRef: { value: '5000' }, Line: [{ Amount: 3450 }] },
    requestId: null,
  })
  const call = async (req: Request = post()) => {
    const res = await createHandler(h.deps)(req)
    return { status: res.status, body: await res.json() }
  }
  return { h, cleared, call }
}

Deno.test('qbo-bill-check: gates — session, billing.payroll, module, body', () =>
  run(async () => {
    const { call } = setup()
    assertEquals((await call(post(undefined, null))).status, 401)
    assertEquals(
      (await setup({ permissions: ['billing.settings'] }).call()).status,
      403,
    )
    assertEquals((await setup({ modules: [] }).call()).status, 403)
    assertEquals((await call(post({ period_id: 'nope' }))).status, 400)
    assertEquals(
      (await call(post({ period_id: PERIOD, extra: 1 }))).status,
      400,
    )
  }))

Deno.test('qbo-bill-check: the Bill still in QuickBooks is refused, nothing forgotten', () =>
  run(async () => {
    const { h, cleared, call } = setup()
    const res = await call()
    assertEquals(res.status, 400)
    assertEquals(res.body.error, {
      code: 'invalid_request',
      message: STILL_THERE,
      refusal: true,
    })
    assertEquals(cleared, [])
    assertEquals(
      h.intuit.calls.filter((c) => c.path.endsWith(`/bill/${BILL}`)).length,
      1,
    )
    assertEquals(
      h.service.calls.find((c) => c.fn === 'consume_rate_limit')?.args
        .p_bucket,
      'qbo.bill_check_user',
    )
    assertEquals(
      h.service.calls.find((c) => c.fn === 'qbo_bill_to_check_for_service')
        ?.args,
      { p_actor: ADMIN_ID, p_org_id: ORG_ID, p_period_id: PERIOD },
    )
  }))

Deno.test('qbo-bill-check: deleted in QuickBooks (fault 610) → forgotten', () =>
  run(async () => {
    const { h, cleared, call } = setup()
    // As Intuit does it: « Supprimer » in QuickBooks is the API's delete operation.
    const token = h.state.connection!.access
    const deleted = await h.intuit.fetch(
      `http://fake-intuit.test/v3/company/${h.intuit.realmId}/bill?operation=delete&minorversion=75`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ Id: BILL, SyncToken: '0' }),
      },
    )
    assertEquals((await deleted.json()).Bill.status, 'Deleted')
    const res = await call()
    assertEquals([res.status, res.body], [200, {
      status: 'cleared',
      qbo: 'deleted',
    }])
    assertEquals(cleared, [{
      p_actor: ADMIN_ID,
      p_org_id: ORG_ID,
      p_period_id: PERIOD,
      p_bill_id: BILL,
    }])
  }))

Deno.test('qbo-bill-check: voided in QuickBooks (a zero total) → forgotten', () =>
  run(async () => {
    const { h, cleared, call } = setup()
    h.intuit.voidBill(BILL)
    const res = await call()
    assertEquals([res.status, res.body], [200, {
      status: 'cleared',
      qbo: 'voided',
    }])
    assertEquals(cleared.length, 1)
  }))

Deno.test('qbo-bill-check: the database refuses first; QuickBooks is not asked', () =>
  run(async () => {
    const { h, cleared, call } = setup({
      rpc: {
        qbo_bill_to_check_for_service: {
          data: null,
          error: {
            code: 'P0001',
            message:
              "La facture de cette période n'a pas de Bill dans QuickBooks.",
          },
        },
      },
    })
    const res = await call()
    assertEquals([res.status, res.body.error.refusal], [400, true])
    assertEquals(
      res.body.error.message,
      "La facture de cette période n'a pas de Bill dans QuickBooks.",
    )
    assertEquals(cleared, [])
    assertEquals(h.intuit.calls.length, 0)

    const forbidden = setup({
      rpc: {
        qbo_bill_to_check_for_service: {
          data: null,
          error: { code: '42501', message: 'Permission refusée' },
        },
      },
    })
    assertEquals((await forbidden.call()).status, 403)
  }))

Deno.test('qbo-bill-check: no connection, no application, a dead grant, QuickBooks failing', () =>
  run(async () => {
    const none = setup({ connected: false })
    assertEquals((await none.call()).status, 404)

    const noApp = setup()
    noApp.h.state.secrets.qbo_client_id = null
    assertEquals((await noApp.call()).status, 503)

    const dead = setup()
    dead.h.intuit.revokeAll()
    dead.h.state.connection!.expiresAt = '2026-10-13T12:01:00.000Z'
    const conflict = await dead.call()
    assertEquals([conflict.status, conflict.body.error.code], [
      409,
      'conflict',
    ])
    assertEquals(dead.cleared, [])

    // A bare 404 (no fault 610) is a failure, never taken as a deletion.
    const failing = setup()
    failing.h.intuit.failNext(`/bill/${BILL}`, 404)
    const errors = await captureConsole('error', async () => {
      const res = await failing.call()
      assertEquals([res.status, res.body.error.code], [502, 'provider_error'])
      assertFalse(JSON.stringify(res.body).includes(FAKE_ERROR_MARKER))
    })
    assertFalse(JSON.stringify(errors).includes(FAKE_ERROR_MARKER))
    assertEquals(failing.cleared, [])
  }))
