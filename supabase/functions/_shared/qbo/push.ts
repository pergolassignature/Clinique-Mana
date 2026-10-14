/**
 * The push to QuickBooks (plan §8, FQ part 2; FQ-6 … FQ-10): one pass of the
 * job `billing.qbo_push` for one clinic. F2's outbox (`billing_sync_events`,
 * oldest first) gives what to send; `prepare_qbo_push_for_service` says, per
 * event, whether it is done, waits (its invoice first, a backoff), lacks a
 * line of the map, or what to push; `record_qbo_push_for_service` keeps the
 * outcome. Then the professionals' bills (FPay). A refund (F3) is a
 * JournalEntry (FQ-11): debit Accounts Receivable for the payment's customer,
 * credit the account the payment was deposited to.
 *
 * Idempotent: a document already pushed is only closed in the outbox; every
 * create carries a `requestid` derived from the entity (`requestIdFor`), so an
 * answer lost in transit returns the first document instead of a second one.
 * Nothing at all is sent while the clinic's switch is « En pause » (the
 * default, FQ-6). A refusal of the mapped data (Intuit's 400) or of the
 * network is recorded with its code and tried again later (5 min, 10 …
 * 12 h; failed after 8); a token Intuit refuses stops the pass
 * (`ReconnectNeeded`, the connection marked by `qboCredentials`).
 *
 * Reports name ids and codes only: never a name, an amount or Intuit's body.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { type QboClient, QboError } from './client.ts'
import type { OAuthApp } from './credentials.ts'
import {
  cleanName,
  ensureBillingCustomer,
  ensureOrganisationCustomer,
  type LinkStore,
  type QboPerson,
  requestIdFor,
} from './customers.ts'
import { type SyncContext, withFreshToken } from './sync.ts'

/** Events read per pass; bills per pass. */
const EVENTS_PER_PASS = 50
const BILLS_PER_PASS = 20

export interface PushResult {
  status: 'paused' | 'not_connected' | 'ok' | 'partial'
  pushed: number
  waiting: number
  failed: number
  /** The first failure's code (`qbo_validation`, `missing_map`…), for the run's detail. */
  firstError?: string
}

const personSchema = z.object({
  client_id: z.string(),
  client_number: z.number(),
  first_name: z.string(),
  last_name: z.string(),
})

const lineSchema = z.object({
  id: z.string(),
  line_type: z.string(),
  service_code: z.string().nullable(),
  quantity: z.union([z.number(), z.string()]).nullable(),
  unit_price_cents: z.number().nullable(),
  subtotal_cents: z.number(),
  total_cents: z.number(),
  taxable: z.boolean(),
  description: z.string(),
  item_id: z.string().nullable(),
  item_name: z.string(),
  income_account_id: z.string().nullable(),
})
export type PushLine = z.infer<typeof lineSchema>

const invoiceSchema = z.looseObject({
  id: z.string(),
  number: z.string().nullable(),
  issued_on: z.string().nullable(),
  due_on: z.string().nullable(),
  total_cents: z.number(),
  credit_note: z.object({
    id: z.string(),
    number: z.string(),
    issued_on: z.string(),
    total_cents: z.number(),
  }).nullable().optional(),
})

const paymentSchema = z.looseObject({
  id: z.string(),
  amount_cents: z.number(),
  paid_on: z.string(),
  mode_code: z.string(),
  external_ref: z.string().nullable().optional(),
})

const refundSchema = z.looseObject({
  id: z.string(),
  payment_id: z.string(),
  invoice_number: z.string().nullable(),
  amount_cents: z.number(),
  refunded_on: z.string(),
})

const prepareSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('done'),
    qbo_id: z.string().nullable().optional(),
  }),
  z.object({ action: z.literal('wait'), reason: z.string() }),
  z.object({ action: z.literal('gone') }),
  z.object({ action: z.literal('unsupported') }),
  z.object({ action: z.literal('missing_map'), keys: z.array(z.string()) }),
  z.object({
    action: z.literal('push'),
    push_kind: z.enum(['invoice', 'credit_memo', 'payment', 'refund']),
    invoice: invoiceSchema,
    lines: z.array(lineSchema),
    payment: paymentSchema.nullable(),
    invoice_qbo_id: z.string().nullable(),
    invoice_customer_id: z.string().nullable(),
    payer: personSchema.nullable(),
    dossier: personSchema.nullable(),
    payer_customer_id: z.string().nullable(),
    dossier_customer_id: z.string().nullable(),
    tax_taxable: z.string().nullable(),
    tax_exempt: z.string().nullable(),
    deposit_account_id: z.string().nullable(),
    // FQ-13: a third-party payer's invoice (IVAC, a PAE).
    organisation: z.object({
      id: z.string(),
      kind: z.string().nullable(),
      name: z.string(),
      reference: z.string().nullable(),
    })
      .nullable().optional(),
    organisation_customer_id: z.string().nullable().optional(),
    organisation_matched: z.boolean().nullable().optional(),
    organisation_dossier_customer_id: z.string().nullable().optional(),
    refund: refundSchema.nullable().optional(),
    receivable_account_id: z.string().nullable().optional(),
  }),
])
export type Prepared = Extract<
  z.infer<typeof prepareSchema>,
  { action: 'push' }
>

const eventSchema = z.array(z.object({
  id: z.number(),
  kind: z.string(),
  invoice_id: z.string(),
  entity_id: z.string(),
}))

const billSchema = z.array(z.object({
  invoice_id: z.string(),
  professional_id: z.string(),
  professional_name: z.string().nullable(),
  number: z.string(),
  issued_on: z.string(),
  amount_cents: z.number(),
  vendor_id: z.string().nullable(),
  expense_account_id: z.string().nullable(),
  title_name: z.string().nullable(),
  /** How many times its Bill was forgotten (BI-27): a re-push needs a new requestid. */
  generation: z.number().int().min(0).optional(),
}))

/** A failure of the push with our code (never Intuit's text). */
class PushFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const money = (cents: number) => Math.round(cents) / 100

/**
 * A Bill's `requestid`: the invoice's, as before, until its Bill is forgotten
 * (« Bill annulé dans QuickBooks », BI-27); then one per generation, since
 * Intuit answers a repeated requestid with the first (deleted) Bill.
 */
export function billRequestId(
  invoiceId: string,
  generation: number,
): Promise<string> {
  return generation > 0
    ? requestIdFor('bill', invoiceId, `g${generation}`)
    : requestIdFor('bill', invoiceId)
}

async function rpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.rpc(fn, args)
  if (result.error) throw new PushFailure('rpc_failed')
  return result.data
}

const toPerson = (p: z.infer<typeof personSchema>): QboPerson => ({
  clientId: p.client_id,
  clientNumber: p.client_number,
  firstName: p.first_name,
  lastName: p.last_name,
})

/** The sale lines of an Invoice or a CreditMemo (QuickBooks computes the taxes from the codes). */
export function saleLines(
  lines: PushLine[],
  items: Map<string, string>,
  tax: { taxable: string; exempt: string },
): Record<string, unknown>[] {
  return lines.map((l) => {
    const qty = Number(l.quantity ?? 1) || 1
    const unit = l.unit_price_cents ?? Math.round(l.subtotal_cents / qty)
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: money(l.subtotal_cents),
      Description: l.description.slice(0, 4000),
      SalesItemLineDetail: {
        ItemRef: { value: items.get(l.id) },
        Qty: qty,
        UnitPrice: money(unit),
        TaxCodeRef: { value: l.taxable ? tax.taxable : tax.exempt },
      },
    }
  })
}

/** Intuit's DocNumber: 21 characters at most. */
const docNumber = (value: string | null | undefined) =>
  value ? value.slice(0, 21) : undefined

/** One pass for one clinic; see the module comment. */
export async function runQboPush(
  ctx: SyncContext,
  app: OAuthApp,
): Promise<PushResult> {
  const state = z.object({
    connection_id: z.string(),
    status: z.string(),
    paused: z.boolean(),
    module_enabled: z.boolean(),
  }).nullable().safeParse(
    await rpc(ctx.client, 'qbo_push_state_for_service', {
      p_org_id: ctx.orgId,
    }),
  )
  const result: PushResult = {
    status: 'ok',
    pushed: 0,
    waiting: 0,
    failed: 0,
  }
  if (!state.success || state.data === null) {
    return { ...result, status: 'not_connected' }
  }
  if (state.data.paused) return { ...result, status: 'paused' }
  if (!state.data.module_enabled || state.data.status !== 'connected') {
    return { ...result, status: 'not_connected' }
  }

  const events = eventSchema.safeParse(
    await rpc(ctx.client, 'billing_sync_events_for_service', {
      p_org_id: ctx.orgId,
      p_limit: EVENTS_PER_PASS,
    }),
  )
  const bills = billSchema.safeParse(
    await rpc(ctx.client, 'qbo_bills_to_push_for_service', {
      p_org_id: ctx.orgId,
      p_limit: BILLS_PER_PASS,
    }),
  )
  if (!events.success || !bills.success) throw new PushFailure('unusable_rows')
  if (events.data.length === 0 && bills.data.length === 0) return result

  const fail = (code: string) => {
    result.failed++
    result.firstError ??= code
  }
  const finishEvent = (id: number, code: string | null) =>
    rpc(ctx.client, 'finish_billing_sync_event_for_service', {
      p_org_id: ctx.orgId,
      p_id: id,
      p_error_code: code,
    })
  const record = (
    kind: string,
    entity: string,
    invoice: string | null,
    eventId: number | null,
    outcome:
      | { qboId: string; customerId?: string | null; mismatch?: boolean }
      | {
        error: string
      },
  ) =>
    rpc(ctx.client, 'record_qbo_push_for_service', {
      p_org_id: ctx.orgId,
      p_kind: kind,
      p_entity: entity,
      p_invoice: invoice,
      p_event_id: eventId,
      p_qbo_id: 'qboId' in outcome ? outcome.qboId : null,
      p_qbo_customer_id: 'qboId' in outcome ? outcome.customerId ?? null : null,
      p_error_code: 'error' in outcome ? outcome.error : null,
      p_amount_mismatch: 'qboId' in outcome ? outcome.mismatch ?? false : false,
    })

  await withFreshToken(ctx, app, async (qbo) => {
    for (const event of events.data) {
      if (ctx.signal?.aborted || Date.now() > ctx.softDeadline) break
      const raw = await rpc(ctx.client, 'prepare_qbo_push_for_service', {
        p_org_id: ctx.orgId,
        p_kind: event.kind,
        p_entity: event.entity_id,
        p_invoice: event.invoice_id,
      })
      const parsed = prepareSchema.safeParse(raw)
      if (!parsed.success) {
        fail('unusable_prepare')
        continue
      }
      const prep = parsed.data
      switch (prep.action) {
        case 'done':
        case 'gone':
          await finishEvent(event.id, null)
          continue
        case 'wait':
          result.waiting++
          continue
        case 'unsupported':
          await finishEvent(event.id, 'not_supported')
          result.waiting++
          continue
        case 'missing_map': {
          const kind = event.kind === 'payment_recorded'
            ? 'payment'
            : event.kind === 'payment_refunded'
            ? 'refund'
            : event.kind === 'invoice_credited'
            ? 'credit_memo'
            : 'invoice'
          await record(kind, event.entity_id, event.invoice_id, event.id, {
            error: 'missing_map',
          })
          await finishEvent(event.id, 'missing_map')
          fail('missing_map')
          continue
        }
      }
      try {
        const outcome = await pushOne(qbo, ctx.client, ctx.orgId, prep, event)
        await record(
          prep.push_kind,
          event.entity_id,
          event.invoice_id,
          event.id,
          outcome,
        )
        await finishEvent(event.id, null)
        result.pushed++
      } catch (error) {
        if (isReconnect(error)) throw error
        const code = errorCode(error)
        await record(
          prep.push_kind,
          event.entity_id,
          event.invoice_id,
          event.id,
          {
            error: code,
          },
        )
        await finishEvent(event.id, code)
        fail(code)
      }
    }

    for (const bill of bills.data) {
      if (ctx.signal?.aborted || Date.now() > ctx.softDeadline) break
      if (!bill.expense_account_id) {
        await record('bill', bill.invoice_id, null, null, {
          error: 'missing_map',
        })
        fail('missing_map')
        continue
      }
      try {
        const vendorId = bill.vendor_id ??
          await ensureVendor(qbo, ctx.client, ctx.orgId, bill)
        const created = await qbo.create('bill', {
          VendorRef: { value: vendorId },
          TxnDate: bill.issued_on,
          DocNumber: docNumber(bill.number),
          Line: [{
            DetailType: 'AccountBasedExpenseLineDetail',
            Amount: money(bill.amount_cents),
            Description: cleanName(
              `Paie des professionnels${
                bill.title_name ? ` · ${bill.title_name}` : ''
              }`,
            ),
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: bill.expense_account_id },
            },
          }],
        }, await billRequestId(bill.invoice_id, bill.generation ?? 0))
        await record('bill', bill.invoice_id, null, null, { qboId: created.id })
        result.pushed++
      } catch (error) {
        if (isReconnect(error)) throw error
        const code = errorCode(error)
        await record('bill', bill.invoice_id, null, null, { error: code })
        fail(code)
      }
    }
  })
  if (result.failed > 0) result.status = 'partial'
  return result
}

const isReconnect = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'ReconnectNeeded' || error.name === 'NotConnected')

function errorCode(error: unknown): string {
  if (error instanceof PushFailure) return error.code
  if (error instanceof QboError) return `qbo_${error.code}`
  return 'push_failed'
}

/** One outbox document (an Invoice, a CreditMemo, a Payment, a refund's JournalEntry); its QuickBooks id. */
async function pushOne(
  qbo: QboClient,
  client: SupabaseClient,
  orgId: string,
  prep: Prepared,
  event: { kind: string; entity_id: string },
): Promise<{ qboId: string; customerId: string | null; mismatch: boolean }> {
  if (prep.push_kind === 'refund') {
    const refund = prep.refund
    if (
      !refund || !prep.invoice_customer_id || !prep.deposit_account_id ||
      !prep.receivable_account_id
    ) {
      throw new PushFailure('refund_incomplete')
    }
    const amount = money(refund.amount_cents)
    const text = cleanName(
      `Remboursement${
        refund.invoice_number ? ` · facture ${refund.invoice_number}` : ''
      }`,
    )
    const created = await qbo.create('journalentry', {
      TxnDate: refund.refunded_on,
      ...(refund.invoice_number
        ? { DocNumber: docNumber(`R-${refund.invoice_number}`) }
        : {}),
      PrivateNote: text,
      Line: [
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: amount,
          Description: text,
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: { value: prep.receivable_account_id },
            Entity: {
              Type: 'Customer',
              EntityRef: { value: prep.invoice_customer_id },
            },
          },
        },
        {
          DetailType: 'JournalEntryLineDetail',
          Amount: amount,
          Description: text,
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: { value: prep.deposit_account_id },
          },
        },
      ],
    }, await requestIdFor('refund', event.entity_id))
    return {
      qboId: created.id,
      customerId: prep.invoice_customer_id,
      mismatch: false,
    }
  }

  if (prep.push_kind === 'payment') {
    const payment = prep.payment
    if (
      !payment || !prep.invoice_qbo_id || !prep.invoice_customer_id ||
      !prep.deposit_account_id
    ) {
      throw new PushFailure('payment_incomplete')
    }
    const created = await qbo.create('payment', {
      CustomerRef: { value: prep.invoice_customer_id },
      TotalAmt: money(payment.amount_cents),
      TxnDate: payment.paid_on,
      DepositToAccountRef: { value: prep.deposit_account_id },
      ...(payment.external_ref
        ? { PaymentRefNum: payment.external_ref.slice(0, 21) }
        : {}),
      Line: [{
        Amount: money(payment.amount_cents),
        LinkedTxn: [{ TxnId: prep.invoice_qbo_id, TxnType: 'Invoice' }],
      }],
    }, await requestIdFor('payment', event.entity_id))
    return {
      qboId: created.id,
      customerId: prep.invoice_customer_id,
      mismatch: false,
    }
  }

  if (!prep.tax_taxable || !prep.tax_exempt) {
    throw new PushFailure('missing_map')
  }
  // The customer: the invoice's (a credit memo goes to the same), else the pair's, made on first use.
  let customerId = prep.push_kind === 'credit_memo'
    ? prep.invoice_customer_id
    : null
  const organisation = prep.organisation ?? null
  if (!customerId && organisation) {
    // FQ-13: the organisation is the parent, the dossier its sub-customer.
    if (!prep.dossier) throw new PushFailure('client_gone')
    customerId = (await ensureOrganisationCustomer(qbo, {
      record: async (link) => {
        await rpc(client, 'record_qbo_organisation_link_for_service', {
          p_org_id: orgId,
          p_kind: link.kind,
          p_organisation: link.organisationId,
          p_client: link.clientId ?? null,
          p_qbo_customer_id: link.qboCustomerId,
          p_source: link.source,
        })
      },
    }, {
      id: organisation.id,
      name: organisation.name,
      customerId: prep.organisation_customer_id ?? null,
      matched: prep.organisation_matched ?? false,
      dossierCustomerId: prep.organisation_dossier_customer_id ?? null,
    }, toPerson(prep.dossier))).customerId
  }
  if (!customerId) {
    if (!prep.payer || !prep.dossier) throw new PushFailure('client_gone')
    const store: LinkStore = {
      payer: () => Promise.resolve(prep.payer_customer_id),
      dossier: () => Promise.resolve(prep.dossier_customer_id),
      record: async (link) => {
        await rpc(client, 'record_qbo_link_for_service', {
          p_org_id: orgId,
          p_kind: link.kind,
          p_payer: link.payerClientId,
          p_client: link.clientId ?? null,
          p_qbo_customer_id: link.qboCustomerId,
        })
      },
    }
    customerId = (await ensureBillingCustomer(
      qbo,
      store,
      toPerson(prep.payer),
      toPerson(prep.dossier),
    )).customerId
  }

  // Each line's item: the company's, else made once on the account of its kind.
  const items = new Map<string, string>()
  for (const line of prep.lines) {
    if (line.item_id) {
      items.set(line.id, line.item_id)
      continue
    }
    if (!line.income_account_id) throw new PushFailure('missing_map')
    const key = line.service_code ?? `kind:${line.line_type}`
    const created = await qbo.create('item', {
      Name: cleanName(line.item_name),
      ...(line.service_code ? { Sku: line.service_code } : {}),
      Type: 'Service',
      IncomeAccountRef: { value: line.income_account_id },
    }, await requestIdFor('item', key))
    await rpc(client, 'record_qbo_item_for_service', {
      p_org_id: orgId,
      p_qbo_id: created.id,
      p_name: cleanName(line.item_name),
      p_sku: line.service_code,
      p_income_account_id: line.income_account_id,
    })
    items.set(line.id, created.id)
    // The other lines of the same code reuse it.
    for (const other of prep.lines) {
      if (
        !other.item_id &&
        (other.service_code ?? `kind:${other.line_type}`) === key
      ) items.set(other.id, created.id)
    }
  }
  const lines = saleLines(prep.lines, items, {
    taxable: prep.tax_taxable,
    exempt: prep.tax_exempt,
  })
  // The payer's reference (its file number) on the document the payer reads.
  const memo = organisation?.reference
    ? {
      CustomerMemo: {
        value: `Référence : ${organisation.reference}`.replace(
          /[\r\n\t]+/g,
          ' ',
        )
          .slice(0, 1000),
      },
    }
    : {}

  if (prep.push_kind === 'credit_memo') {
    const note = prep.invoice.credit_note
    if (!note) throw new PushFailure('credit_note_gone')
    const created = await qbo.create('creditmemo', {
      CustomerRef: { value: customerId },
      DocNumber: docNumber(note.number),
      TxnDate: note.issued_on,
      GlobalTaxCalculation: 'TaxExcluded',
      ...memo,
      Line: lines,
    }, await requestIdFor('credit_memo', event.entity_id))
    return {
      qboId: created.id,
      customerId,
      mismatch: created.totalAmt !== null &&
        Math.abs(created.totalAmt - money(note.total_cents)) > 0.005,
    }
  }
  const created = await qbo.create('invoice', {
    CustomerRef: { value: customerId },
    DocNumber: docNumber(prep.invoice.number),
    ...(prep.invoice.issued_on ? { TxnDate: prep.invoice.issued_on } : {}),
    ...(prep.invoice.due_on ? { DueDate: prep.invoice.due_on } : {}),
    GlobalTaxCalculation: 'TaxExcluded',
    ...memo,
    Line: lines,
  }, await requestIdFor('invoice', event.entity_id))
  return {
    qboId: created.id,
    customerId,
    mismatch: created.totalAmt !== null &&
      Math.abs(created.totalAmt - money(prep.invoice.total_cents)) > 0.005,
  }
}

/** A professional's vendor: made on her first bill (a taken name: « (professionnel·le) »). */
async function ensureVendor(
  qbo: QboClient,
  client: SupabaseClient,
  orgId: string,
  bill: z.infer<typeof billSchema>[number],
): Promise<string> {
  const base = cleanName(bill.professional_name ?? 'Professionnel·le')
  const names = [base, cleanName(`${base} (professionnel·le)`)]
  for (let i = 0; i < names.length; i++) {
    try {
      const created = await qbo.create(
        'vendor',
        { DisplayName: names[i] },
        await requestIdFor('vendor', bill.professional_id, String(i)),
      )
      await rpc(client, 'record_qbo_vendor_for_service', {
        p_org_id: orgId,
        p_professional: bill.professional_id,
        p_qbo_vendor_id: created.id,
      })
      return created.id
    } catch (error) {
      if (
        error instanceof QboError && error.code === 'duplicate_name' &&
        i < names.length - 1
      ) continue
      throw error
    }
  }
  throw new QboError('duplicate_name')
}
