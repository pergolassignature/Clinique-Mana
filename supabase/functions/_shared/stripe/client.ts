/**
 * A small Stripe API client (Facturation FS): the calls the functions make,
 * form-encoded as Stripe wants, with an `Idempotency-Key` on every write that
 * must happen once. Answers are parsed with Zod (only the fields used). A key
 * is never logged, reported or echoed; neither is a card's number, which never
 * reaches the clinic anyway (Checkout collects it).
 *
 * Errors: `StripeError` with the HTTP status and Stripe's `code` /
 * `decline_code` (a card refusal is a 402 `card_error`); a network failure is
 * `network`. `isNotFound` tells a 404 (`resource_missing`) apart.
 */
import { z } from 'zod'

/** One Stripe API failure. */
export class StripeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly declineCode: string | null = null,
    readonly paymentIntentId: string | null = null,
  ) {
    super(code)
  }
}

/** Stripe's « no such object ». */
export const isNotFound = (error: unknown): boolean =>
  error instanceof StripeError &&
  (error.status === 404 || error.code === 'resource_missing')

type Scalar = string | number | boolean
/** Stripe's nested form parameters. */
export type Params = {
  [key: string]: Scalar | null | undefined | Params | Array<Params | Scalar>
}

/** `a[b][0][c]=…` form encoding (Stripe's nested parameters). */
export function formEncode(params: Params, prefix = ''): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(formEncode(item, `${name}[${i}]`))
        } else {parts.push(
            `${encodeURIComponent(`${name}[${i}]`)}=${
              encodeURIComponent(String(item))
            }`,
          )}
      })
    } else if (typeof value === 'object') {
      parts.push(formEncode(value, name))
    } else {
      parts.push(
        `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`,
      )
    }
  }
  return parts.filter((p) => p !== '').join('&')
}

const errorSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    decline_code: z.string().optional(),
    type: z.string().optional(),
    payment_intent: z.object({ id: z.string() }).passthrough().optional(),
  }).passthrough(),
}).passthrough()

const SAFE_CODE = /^[a-z0-9_]{1,64}$/

const customerSchema = z.object({
  id: z.string().regex(/^cus_[A-Za-z0-9]{1,64}$/),
}).passthrough()
const sessionSchema = z.object({
  id: z.string(),
  url: z.string().nullable().optional(),
}).passthrough()
const cardSchema = z.object({
  brand: z.string().optional(),
  last4: z.string().regex(/^[0-9]{4}$/),
  exp_month: z.number().int().min(1).max(12),
  exp_year: z.number().int().min(2000).max(2100),
}).passthrough()
const paymentMethodSchema = z.object({
  id: z.string().regex(/^pm_[A-Za-z0-9]{1,64}$/),
  customer: z.string().nullable().optional(),
  card: cardSchema.optional(),
}).passthrough()
const setupIntentSchema = z.object({
  id: z.string(),
  status: z.string(),
  customer: z.string().nullable().optional(),
  payment_method: z.union([z.string(), paymentMethodSchema]).nullable()
    .optional(),
}).passthrough()
const paymentIntentSchema = z.object({
  id: z.string().regex(/^pi_[A-Za-z0-9]{1,64}$/),
  status: z.string(),
  amount: z.number().int(),
  last_payment_error: z.object({
    code: z.string().optional(),
    decline_code: z.string().optional(),
  }).passthrough().nullable().optional(),
}).passthrough()

/** A card's display facts (never its number). */
export interface CardFacts {
  paymentMethodId: string
  customerId: string | null
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/** The PaymentIntent of a charge. */
export interface PaymentIntentResult {
  id: string
  status: string
  amount: number
  failureCode: string | null
}

/** Calls Stripe with the clinic's key. */
export class StripeApi {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly origin: string,
    private readonly key: string,
  ) {}

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    params: Params = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const body = method === 'GET' ? null : formEncode(params)
    const query = method === 'GET' && Object.keys(params).length > 0
      ? `?${formEncode(params)}`
      : ''
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      'Stripe-Version': '2024-06-20',
    }
    if (body !== null) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    let res: Response
    try {
      res = await this.fetchFn(`${this.origin}${path}${query}`, {
        method,
        headers,
        body,
      })
    } catch {
      throw new StripeError('network', 0)
    }
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const parsed = errorSchema.safeParse(json)
      const raw = parsed.success ? parsed.data.error : null
      const code = raw?.code && SAFE_CODE.test(raw.code)
        ? raw.code
        : res.status === 404
        ? 'resource_missing'
        : 'provider_error'
      const decline = raw?.decline_code && SAFE_CODE.test(raw.decline_code)
        ? raw.decline_code
        : null
      throw new StripeError(
        code,
        res.status,
        decline,
        raw?.payment_intent?.id ?? null,
      )
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new StripeError('provider_error', res.status)
    return parsed.data
  }

  /** A customer for a payer (idempotent per clinic and payer). */
  async createCustomer(
    input: { name: string; email: string; orgId: string; payerId: string },
  ): Promise<string> {
    const customer = await this.call('POST', '/v1/customers', customerSchema, {
      name: input.name,
      email: input.email,
      metadata: { org_id: input.orgId, payer_client_id: input.payerId },
    }, `customer:${input.orgId}:${input.payerId}`)
    return customer.id
  }

  /** A Checkout session: `setup` (save a card) or `payment` (one amount). Returns its URL. */
  async createCheckoutSession(
    params: Params,
  ): Promise<{ id: string; url: string | null }> {
    const session = await this.call(
      'POST',
      '/v1/checkout/sessions',
      sessionSchema,
      params,
    )
    return { id: session.id, url: session.url ?? null }
  }

  /** The card a setup intent saved. */
  async setupIntentCard(setupIntentId: string): Promise<CardFacts | null> {
    const intent = await this.call(
      'GET',
      `/v1/setup_intents/${encodeURIComponent(setupIntentId)}`,
      setupIntentSchema,
      {
        expand: ['payment_method'],
      },
    )
    if (intent.status !== 'succeeded' || !intent.payment_method) return null
    const method = typeof intent.payment_method === 'string'
      ? await this.call(
        'GET',
        `/v1/payment_methods/${encodeURIComponent(intent.payment_method)}`,
        paymentMethodSchema,
      )
      : intent.payment_method
    if (!method.card) return null
    return {
      paymentMethodId: method.id,
      customerId: intent.customer ?? method.customer ?? null,
      brand: (method.card.brand ?? 'card').toLowerCase().replace(/[^a-z_]/g, '')
        .slice(0, 20) || 'card',
      last4: method.card.last4,
      expMonth: method.card.exp_month,
      expYear: method.card.exp_year,
    }
  }

  /** Detaches a card from its customer (« Retirer la carte »); a card already gone is fine. */
  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    try {
      await this.call(
        'POST',
        `/v1/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`,
        z.object({}).passthrough(),
      )
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  /**
   * Charges a card on file, off session, once per key. A refusal is not an
   * error: the result says `failed` with Stripe's code.
   */
  async chargeCard(input: {
    amountCents: number
    customerId: string
    paymentMethodId: string
    description: string
    metadata: Record<string, string>
    idempotencyKey: string
  }): Promise<PaymentIntentResult> {
    try {
      const intent = await this.call(
        'POST',
        '/v1/payment_intents',
        paymentIntentSchema,
        {
          amount: input.amountCents,
          currency: 'cad',
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          off_session: true,
          confirm: true,
          description: input.description,
          metadata: input.metadata,
        },
        input.idempotencyKey,
      )
      const failed = intent.status !== 'succeeded' &&
        intent.status !== 'processing'
      const raw = intent.last_payment_error?.decline_code ??
        intent.last_payment_error?.code ?? null
      return {
        id: intent.id,
        status: intent.status,
        amount: intent.amount,
        failureCode: failed
          ? (raw && SAFE_CODE.test(raw)
            ? raw
            : intent.status === 'requires_action'
            ? 'authentication_required'
            : 'declined')
          : null,
      }
    } catch (error) {
      if (error instanceof StripeError && error.status === 402) {
        return {
          id: error.paymentIntentId ?? '',
          status: 'failed',
          amount: input.amountCents,
          failureCode: error.declineCode ??
            (error.code === 'provider_error' ? 'declined' : error.code),
        }
      }
      throw error
    }
  }
}
