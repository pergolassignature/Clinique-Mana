import { assert, assertEquals, assertRejects } from '@std/assert'
import { pushOrg } from './handler.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { ORG_ID, qboHarness } from '../_shared/testing/qbo-fixtures.ts'
import type { FakeResult, RpcRoute } from '../_shared/testing/fake-supabase.ts'

const run = (fn: () => Promise<void>) =>
  withEnv(
    { INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret' },
    fn,
  )

const INVOICE = '00000000-0000-4000-8000-0000000000a1'
const PAYMENT = '00000000-0000-4000-8000-0000000000b1'
const CLIENT = '00000000-0000-4000-8000-0000000000d1'
const PRO = '00000000-0000-4000-8000-0000000000e1'
const PRO_INVOICE = '00000000-0000-4000-8000-0000000000f1'
const REFUND = '00000000-0000-4000-8000-0000000000c1'

/**
 * The database side of a pass, in memory: F2's outbox, the pushes (pushed or
 * failed, with their tries), the links, the items and vendors the push made,
 * and the professional's invoice to bill.
 */
function model(
  over: {
    paused?: boolean
    withBill?: boolean
    depositMapped?: boolean
    withRefund?: boolean
  } = {},
) {
  const events = [
    {
      id: 1,
      kind: 'invoice_issued',
      invoice_id: INVOICE,
      entity_id: INVOICE,
      processed: false,
      code: null as string | null,
    },
    {
      id: 2,
      kind: 'payment_recorded',
      invoice_id: INVOICE,
      entity_id: PAYMENT,
      processed: false,
      code: null as string | null,
    },
    ...(over.withRefund
      ? [{
        id: 3,
        kind: 'payment_refunded',
        invoice_id: INVOICE,
        entity_id: REFUND,
        processed: false,
        code: null as string | null,
      }]
      : []),
  ]
  const pushes = new Map<
    string,
    {
      status: string
      qboId: string | null
      customer: string | null
      attempts: number
      code: string | null
      mismatch: boolean
    }
  >()
  const links: Record<string, string> = {}
  const vendors: Record<string, string> = {}
  const madeItems: string[] = []
  let billPushed: string | null = null
  const person = {
    client_id: CLIENT,
    client_number: 42,
    first_name: 'Léa',
    last_name: 'Essai',
  }
  const routes: Record<string, RpcRoute> = {
    qbo_push_state_for_service: () => ({
      data: {
        connection_id: 'c1',
        status: 'connected',
        paused: over.paused ?? false,
        module_enabled: true,
      },
    }),
    billing_sync_events_for_service: () => ({
      data: events.filter((e) => !e.processed).map((
        { id, kind, invoice_id, entity_id },
      ) => ({ id, kind, invoice_id, entity_id, attempts: 0 })),
    }),
    finish_billing_sync_event_for_service: (args) => {
      const e = events.find((x) => x.id === args.p_id)!
      if (args.p_error_code === null) e.processed = true
      else e.code = args.p_error_code as string
      return { data: null }
    },
    prepare_qbo_push_for_service: (args) => {
      const kind = args.p_kind === 'invoice_issued'
        ? 'invoice'
        : args.p_kind === 'payment_refunded'
        ? 'refund'
        : 'payment'
      const done = pushes.get(`${kind}:${args.p_entity}`)
      if (done?.status === 'pushed') {
        return { data: { action: 'done', qbo_id: done.qboId } }
      }
      const invoicePush = pushes.get(`invoice:${INVOICE}`)
      if (kind === 'refund') {
        const paymentPush = pushes.get(`payment:${PAYMENT}`)
        if (paymentPush?.status !== 'pushed') {
          return { data: { action: 'wait', reason: 'payment_not_pushed' } }
        }
        return {
          data: {
            action: 'push',
            push_kind: 'refund',
            invoice: {
              id: INVOICE,
              number: '2026-12',
              issued_on: '2026-10-13',
              due_on: '2026-10-13',
              total_cents: 9198,
            },
            lines: [],
            payment: {
              id: PAYMENT,
              amount_cents: 9198,
              paid_on: '2026-10-14',
              mode_code: 'interac',
            },
            refund: {
              id: REFUND,
              payment_id: PAYMENT,
              invoice_number: '2026-12',
              amount_cents: 2500,
              refunded_on: '2026-10-15',
            },
            invoice_qbo_id: null,
            invoice_customer_id: paymentPush.customer,
            payer: null,
            dossier: null,
            payer_customer_id: null,
            dossier_customer_id: null,
            tax_taxable: null,
            tax_exempt: null,
            receivable_account_id: '10',
            deposit_account_id: '3',
          },
        }
      }
      if (kind === 'payment' && invoicePush?.status !== 'pushed') {
        return { data: { action: 'wait', reason: 'invoice_not_pushed' } }
      }
      if (kind === 'payment' && over.depositMapped === false) {
        return { data: { action: 'missing_map', keys: ['deposit.interac'] } }
      }
      return {
        data: {
          action: 'push',
          push_kind: kind,
          invoice: {
            id: INVOICE,
            number: '2026-12',
            issued_on: '2026-10-13',
            due_on: '2026-10-13',
            total_cents: 9198,
            credit_note: null,
          },
          lines: [
            {
              id: 'l1',
              line_type: 'service',
              service_code: '10150',
              quantity: 1,
              unit_price_cents: 8000,
              subtotal_cents: 8000,
              total_cents: 9198,
              taxable: true,
              description: 'Consultation individuelle 50 min',
              item_id: '201',
              item_name: '10150 Consultation individuelle 50 min',
              income_account_id: '1',
            },
            {
              id: 'l2',
              line_type: 'file_opening',
              service_code: null,
              quantity: 1,
              unit_price_cents: 0,
              subtotal_cents: 0,
              total_cents: 0,
              taxable: false,
              description: 'Ouverture de dossier',
              item_id: null,
              item_name: 'Ouverture de dossier',
              income_account_id: '2',
            },
          ],
          payment: kind === 'payment'
            ? {
              id: PAYMENT,
              amount_cents: 9198,
              paid_on: '2026-10-14',
              mode_code: 'interac',
              external_ref: 'CA1234',
            }
            : null,
          invoice_qbo_id: invoicePush?.qboId ?? null,
          invoice_customer_id: invoicePush?.customer ?? null,
          payer: person,
          dossier: person,
          payer_customer_id: links.payer ?? null,
          dossier_customer_id: links.dossier ?? null,
          tax_taxable: '4',
          tax_exempt: '8',
          deposit_account_id: kind === 'payment' ? '3' : null,
        },
      }
    },
    record_qbo_link_for_service: (args) => {
      links[args.p_kind as string] = args.p_qbo_customer_id as string
      return { data: null }
    },
    record_qbo_item_for_service: (args) => {
      madeItems.push(args.p_qbo_id as string)
      return { data: null }
    },
    record_qbo_push_for_service: (args) => {
      const key = `${args.p_kind}:${args.p_entity}`
      const row = pushes.get(key) ??
        {
          status: 'pending',
          qboId: null,
          customer: null,
          attempts: 0,
          code: null,
          mismatch: false,
        }
      row.attempts++
      if (args.p_qbo_id) {
        Object.assign(row, {
          status: 'pushed',
          qboId: args.p_qbo_id,
          customer: args.p_qbo_customer_id,
          code: null,
          mismatch: args.p_amount_mismatch,
        })
      } else row.code = args.p_error_code as string
      pushes.set(key, row)
      if (args.p_kind === 'bill' && args.p_qbo_id) {
        billPushed = args.p_qbo_id as string
      }
      return { data: row.status }
    },
    qbo_bills_to_push_for_service: () => ({
      data: over.withBill && !billPushed
        ? [{
          invoice_id: PRO_INVOICE,
          professional_id: PRO,
          professional_name: 'Hélène Psy',
          number: 'HP-2026-09',
          issued_on: '2026-10-01',
          amount_cents: 345000,
          vendor_id: vendors[PRO] ?? null,
          expense_account_id: '9',
          title_name: 'Psychologue',
        }]
        : [],
    }),
    record_qbo_vendor_for_service: (args) => {
      vendors[args.p_professional as string] = args.p_qbo_vendor_id as string
      return { data: null }
    },
  }
  return {
    routes,
    events,
    pushes,
    links,
    vendors,
    madeItems,
    bill: () => billPushed,
  }
}

function setup(over: Parameters<typeof model>[0] = {}) {
  const m = model(over)
  const h = qboHarness({ connected: true, rpc: m.routes })
  return {
    h,
    m,
    pass: () =>
      pushOrg(h.deps)(ORG_ID, h.service.client, new AbortController().signal),
  }
}

Deno.test('qbo-push: paused (the default) sends nothing', () =>
  run(async () => {
    const { h, pass } = setup({ paused: true })
    assertEquals(await pass(), 'En pause')
    assertEquals(h.intuit.documents.length, 0)
    assertEquals(
      h.intuit.calls.filter((c) => c.path.includes('/v3/')).length,
      0,
    )
  }))

Deno.test('qbo-push: an invoice to the pair’s sub-customer, its lines by item and tax code; then its payment', () =>
  run(async () => {
    const { h, m, pass } = setup()
    // The invoice, then (in the same pass, once its invoice is in) the payment.
    assertEquals(await pass(), '2 envoyé(s), 0 en attente, 0 en échec')
    // The payer's parent, then the dossier's sub-customer under it.
    const [parent, sub] = [...h.intuit.customers.values()].slice(-2)
    assertEquals(parent.DisplayName, 'Léa Essai')
    assertEquals([sub.Job, sub.ParentRef?.value], [true, parent.Id])
    assertEquals(m.links, { payer: parent.Id, dossier: sub.Id })
    const invoice = h.intuit.documents.find((d) => d.entity === 'invoice')!
    assertEquals((invoice.body.CustomerRef as { value: string }).value, sub.Id)
    assertEquals(invoice.body.DocNumber, '2026-12')
    const lines = invoice.body.Line as {
      Amount: number
      SalesItemLineDetail: {
        ItemRef: { value: string }
        TaxCodeRef: { value: string }
      }
    }[]
    assertEquals(
      lines.map((l) => [l.Amount, l.SalesItemLineDetail.TaxCodeRef.value]),
      [[80, '4'], [0, '8']],
    )
    assertEquals(lines[0].SalesItemLineDetail.ItemRef.value, '201')
    // The file opening had no item: one made on its account (« Ventes »), kept.
    const item = h.intuit.documents.find((d) => d.entity === 'item')!
    assertEquals((item.body.IncomeAccountRef as { value: string }).value, '2')
    assertEquals(m.madeItems, [item.id])
    assertEquals(m.pushes.get(`invoice:${INVOICE}`)?.mismatch, false)
    // The payment, on that invoice, deposited by its mode.
    const payment = h.intuit.documents.find((d) => d.entity === 'payment')!
    assertEquals(
      (payment.body.DepositToAccountRef as { value: string }).value,
      '3',
    )
    assertEquals(
      (payment.body.Line as { LinkedTxn: { TxnId: string }[] }[])[0]
        .LinkedTxn[0].TxnId,
      invoice.id,
    )
    assertEquals(m.events.map((e) => e.processed), [true, true])
    // Never twice.
    assertEquals(await pass(), 'Rien à envoyer')
    assertEquals(
      h.intuit.documents.filter((d) => d.entity === 'invoice').length,
      1,
    )
  }))

Deno.test('qbo-push: a refund is a journal entry — the customer owes it again, the money leaves the deposit account', () =>
  run(async () => {
    const { h, m, pass } = setup({ withRefund: true })
    // The invoice, its payment, then the refund once the payment is in.
    assertEquals(await pass(), '3 envoyé(s), 0 en attente, 0 en échec')
    const payment = h.intuit.documents.find((d) => d.entity === 'payment')!
    const entry = h.intuit.documents.find((d) => d.entity === 'journalentry')!
    assertEquals(entry.body.TxnDate, '2026-10-15')
    assertEquals(entry.body.DocNumber, 'R-2026-12')
    const lines = entry.body.Line as {
      Amount: number
      JournalEntryLineDetail: {
        PostingType: string
        AccountRef: { value: string }
        Entity?: { Type: string; EntityRef: { value: string } }
      }
    }[]
    assertEquals(
      lines.map((l) => [
        l.JournalEntryLineDetail.PostingType,
        l.JournalEntryLineDetail.AccountRef.value,
        l.Amount,
      ]),
      [['Debit', '10', 25], ['Credit', '3', 25]],
    )
    // On the customer the payment was on.
    assertEquals(
      lines[0].JournalEntryLineDetail.Entity?.EntityRef.value,
      (payment.body.CustomerRef as { value: string }).value,
    )
    assertEquals(m.pushes.get(`refund:${REFUND}`)?.status, 'pushed')
    assertEquals(m.events.map((e) => e.processed), [true, true, true])
    assertEquals(await pass(), 'Rien à envoyer')
    assertEquals(
      h.intuit.documents.filter((d) => d.entity === 'journalentry').length,
      1,
    )
  }))

Deno.test('qbo-push: an answer lost after the create is not a second invoice (requestid)', () =>
  run(async () => {
    const { h, m } = setup()
    // The first pass makes the invoice, but its outcome is never recorded (the process died).
    const record = m.routes.record_qbo_push_for_service as (
      a: Record<string, unknown>,
    ) => FakeResult
    let lost = true
    m.routes.record_qbo_push_for_service = (args) => {
      if (lost && args.p_kind === 'invoice') {
        lost = false
        return { error: { code: 'XX000', message: 'connection lost' } }
      }
      return record(args)
    }
    const h2 = qboHarness({ connected: true, rpc: m.routes })
    const signal = new AbortController().signal
    await captureConsole('error', async () => {
      await pushOrg(h2.deps)(ORG_ID, h2.service.client, signal)
    })
    // Recorded as a failure (its code), the invoice made all the same: the next try sends the same
    // request id, and Intuit answers the first invoice.
    assertEquals(m.pushes.get(`invoice:${INVOICE}`)?.code, 'rpc_failed')
    await pushOrg(h2.deps)(ORG_ID, h2.service.client, signal)
    assertEquals(
      h2.intuit.documents.filter((d) => d.entity === 'invoice').length,
      1,
      'one invoice in QuickBooks',
    )
    assertEquals(m.pushes.get(`invoice:${INVOICE}`)?.status, 'pushed')
    assert(h.intuit.documents.length === 0)
  }))

Deno.test('qbo-push: a refusal is recorded with its code and tried later; a missing map line is named', () =>
  run(async () => {
    const { h, m, pass } = setup()
    h.intuit.failNext('POST /v3/company', 400, '6000', 20)
    await captureConsole('error', async () => {
      assertEquals(await pass(), '0 envoyé(s), 1 en attente, 1 en échec')
    })
    const row = m.pushes.get(`invoice:${INVOICE}`)!
    assertEquals([row.status, row.code, row.attempts], [
      'pending',
      'qbo_validation',
      1,
    ])
    assertEquals(m.events[0].code, 'qbo_validation')
    assertEquals(h.intuit.documents.length, 0)

    const noDeposit = setup({ depositMapped: false })
    await noDeposit.pass()
    await captureConsole('error', async () => {
      await noDeposit.pass()
    })
    assertEquals(
      noDeposit.m.pushes.get(`payment:${PAYMENT}`)?.code,
      'missing_map',
    )
  }))

Deno.test('qbo-push: a professional’s invoice is a Bill for her vendor, on her specialty’s account', () =>
  run(async () => {
    const { h, m, pass } = setup({ withBill: true })
    await pass()
    const vendor = h.intuit.documents.find((d) => d.entity === 'vendor')!
    assertEquals(vendor.body.DisplayName, 'Hélène Psy')
    assertEquals(m.vendors[PRO], vendor.id)
    const bill = h.intuit.documents.find((d) => d.entity === 'bill')!
    assertEquals((bill.body.VendorRef as { value: string }).value, vendor.id)
    const line = (bill.body.Line as {
      Amount: number
      AccountBasedExpenseLineDetail: { AccountRef: { value: string } }
    }[])[0]
    assertEquals([
      line.Amount,
      line.AccountBasedExpenseLineDetail.AccountRef.value,
    ], [3450, '9'])
    assertEquals(m.bill(), bill.id)
  }))

Deno.test('qbo-push: a token Intuit refuses fails the run (needs_reconnect), nothing pushed', () =>
  run(async () => {
    const { h, pass } = setup()
    h.intuit.revokeAll()
    h.intuit.expireAccess()
    h.state.connection!.expiresAt = '2026-10-13T11:00:00.000Z'
    await captureConsole('error', async () => {
      await assertRejects(pass, Error, 'needs_reconnect')
    })
    assertEquals(h.intuit.documents.length, 0)
  }))
