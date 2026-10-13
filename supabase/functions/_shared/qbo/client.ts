/**
 * A thin QuickBooks Online API client over `fetch` (no SDK: ADR 0008). One
 * company (`/v3/company/<realm>/…`), one pinned `minorversion`, a bearer
 * token, a timeout and a cap on each answer's size. Intuit's error bodies
 * are read for one field (`Fault.Error[0].code`, a number), never kept,
 * logged or returned: a failure is a `QboError` whose `code` is ours.
 *
 * Retries: a 429, Intuit's throttle fault (3001) or a 5xx is tried again
 * twice (`Retry-After` honoured up to 30 s, else 1 s then 4 s). A 401 means
 * the access token is no longer good: the caller refreshes once and calls
 * again (`withFreshToken`, PS Hub had no 401 handling).
 *
 * Queries: `queryAll` pages with `STARTPOSITION` / `MAXRESULTS 1000` until a
 * short page (PS Hub read one page of items and dropped the rest). A value
 * placed in a query goes through `qboQuote` (PS Hub interpolated raw text).
 */
import { z } from 'zod'
import { QBO_MINOR_VERSION } from './env.ts'

export const QBO_TIMEOUT_MS = 20_000
const MAX_ANSWER_BYTES = 8 * 1024 * 1024
const RETRY_DELAYS_MS = [1_000, 4_000]
const MAX_RETRY_AFTER_MS = 30_000
export const QUERY_PAGE = 1_000
/** The most rows `queryAll` reads (a clinic has ~10 000 customers). */
const MAX_ROWS = 50_000

export type QboErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'duplicate_name'
  | 'stale_object'
  | 'validation'
  | 'rate_limited'
  | 'timeout'
  | 'unreachable'
  | 'provider_error'
  | 'unusable_answer'
  | 'too_large'

export class QboError extends Error {
  constructor(
    readonly code: QboErrorCode,
    readonly status?: number,
    /** Intuit's fault code (digits only), when there was one. */
    readonly faultCode?: string,
  ) {
    super(code)
    this.name = 'QboError'
  }
}

/** A value inside single quotes in a QuickBooks query (backslash and quote escaped). */
export function qboQuote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export interface QboClientOptions {
  fetch: typeof fetch
  /** The API origin of the company's environment (`qboOrigins(env).api(…)`). */
  origin: string
  realmId: string
  accessToken: string
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function isAbort(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
}

async function readText(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw new QboError('too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(bytes)
}

const faultSchema = z.looseObject({
  Fault: z.looseObject({
    Error: z.array(
      z.looseObject({ code: z.union([z.string(), z.number()]).optional() }),
    ).optional(),
    type: z.string().optional(),
  }).optional(),
  fault: z.looseObject({
    error: z.array(
      z.looseObject({ code: z.union([z.string(), z.number()]).optional() }),
    ).optional(),
  }).optional(),
})

/** Intuit's fault code of an error body (digits only), or undefined. */
function faultCode(text: string): string | undefined {
  try {
    const parsed = faultSchema.safeParse(JSON.parse(text))
    if (!parsed.success) return undefined
    const raw = parsed.data.Fault?.Error?.[0]?.code ??
      parsed.data.fault?.error?.[0]?.code
    const code = raw === undefined ? '' : String(raw)
    return /^[0-9]{1,8}$/.test(code) ? code : undefined
  } catch {
    return undefined
  }
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('Retry-After')
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : null
}

export const accountSchema = z.looseObject({
  Id: z.string(),
  Name: z.string(),
  FullyQualifiedName: z.string().optional(),
  AcctNum: z.string().optional(),
  AccountType: z.string(),
  AccountSubType: z.string().optional(),
  Classification: z.string().optional(),
  Active: z.boolean().optional(),
})
export type QboAccount = z.infer<typeof accountSchema>

const phoneSchema = z.looseObject({ FreeFormNumber: z.string().optional() })
  .optional()
export const customerSchema = z.looseObject({
  Id: z.string(),
  SyncToken: z.string().optional(),
  DisplayName: z.string().optional(),
  GivenName: z.string().optional(),
  FamilyName: z.string().optional(),
  CompanyName: z.string().optional(),
  PrimaryEmailAddr: z.looseObject({ Address: z.string().optional() })
    .optional(),
  PrimaryPhone: phoneSchema,
  Mobile: phoneSchema,
  AlternatePhone: phoneSchema,
  Job: z.boolean().optional(),
  ParentRef: z.looseObject({ value: z.string() }).optional(),
  BillWithParent: z.boolean().optional(),
  Active: z.boolean().optional(),
})
export type QboCustomer = z.infer<typeof customerSchema>

export const itemSchema = z.looseObject({
  Id: z.string(),
  Name: z.string(),
  Sku: z.string().optional(),
  Type: z.string().optional(),
  IncomeAccountRef: z.looseObject({ value: z.string() }).optional(),
  Active: z.boolean().optional(),
})
export type QboItem = z.infer<typeof itemSchema>

export const taxCodeSchema = z.looseObject({
  Id: z.string(),
  Name: z.string(),
  Taxable: z.boolean().optional(),
  Active: z.boolean().optional(),
})
export type QboTaxCode = z.infer<typeof taxCodeSchema>

/** The entities the push creates, and the key Intuit answers each under. */
export type QboEntity =
  | 'invoice'
  | 'creditmemo'
  | 'payment'
  | 'vendor'
  | 'bill'
  | 'item'
  | 'journalentry'
const ENTITY_KEYS: Record<QboEntity, string> = {
  invoice: 'Invoice',
  creditmemo: 'CreditMemo',
  payment: 'Payment',
  vendor: 'Vendor',
  bill: 'Bill',
  item: 'Item',
  journalentry: 'JournalEntry',
}
const createdSchema = z.looseObject({
  Id: z.string().regex(/^[0-9]{1,32}$/),
  TotalAmt: z.number().optional(),
})

const companyInfoSchema = z.looseObject({
  CompanyInfo: z.looseObject({
    CompanyName: z.string().optional(),
    LegalName: z.string().optional(),
  }),
})

/** The QuickBooks API of one company. */
export class QboClient {
  readonly #opts: QboClientOptions

  constructor(opts: QboClientOptions) {
    this.#opts = opts
  }

  /** One request with retries; the parsed JSON. */
  async #call<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    options: {
      query?: Record<string, string>
      body?: unknown
      /**
       * Intuit's `requestid` (a create): the same id again answers the first
       * create instead of making a second document, so a retry is safe.
       */
      requestId?: string
    } = {},
  ): Promise<z.output<S>> {
    const url = new URL(
      `${this.#opts.origin}/v3/company/${
        encodeURIComponent(this.#opts.realmId)
      }/${path}`,
    )
    url.searchParams.set('minorversion', QBO_MINOR_VERSION)
    if (options.requestId) url.searchParams.set('requestid', options.requestId)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value)
    }
    const sleep = this.#opts.sleep ?? defaultSleep
    for (let attempt = 0;; attempt++) {
      let res: Response
      try {
        const signals = [AbortSignal.timeout(QBO_TIMEOUT_MS)]
        if (this.#opts.signal) signals.push(this.#opts.signal)
        res = await this.#opts.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.#opts.accessToken}`,
            Accept: 'application/json',
            ...(options.body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          body: options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
          redirect: 'error',
          signal: AbortSignal.any(signals),
        })
      } catch (error) {
        if (this.#opts.signal?.aborted) throw new QboError('timeout')
        throw new QboError(isAbort(error) ? 'timeout' : 'unreachable')
      }
      let text: string
      try {
        text = await readText(res, MAX_ANSWER_BYTES)
      } catch (error) {
        if (error instanceof QboError) throw error
        throw new QboError('unusable_answer')
      }
      if (res.ok) {
        let json: unknown
        try {
          json = text === '' ? null : JSON.parse(text)
        } catch {
          throw new QboError('unusable_answer')
        }
        const parsed = schema.safeParse(json)
        if (!parsed.success) throw new QboError('unusable_answer')
        return parsed.data
      }
      const fault = faultCode(text)
      const throttled = res.status === 429 || fault === '3001'
      if (
        (throttled || res.status >= 500) && attempt < RETRY_DELAYS_MS.length
      ) {
        await sleep(retryAfterMs(res) ?? RETRY_DELAYS_MS[attempt])
        continue
      }
      if (throttled) throw new QboError('rate_limited', res.status, fault)
      switch (res.status) {
        case 400:
          throw new QboError(
            fault === '6240'
              ? 'duplicate_name'
              : fault === '5010'
              ? 'stale_object'
              : 'validation',
            400,
            fault,
          )
        case 401:
          throw new QboError('unauthorized', 401, fault)
        case 403:
          throw new QboError('forbidden', 403, fault)
        case 404:
          throw new QboError('not_found', 404, fault)
        default:
          throw new QboError('provider_error', res.status, fault)
      }
    }
  }

  /** The company's name (`companyinfo`): a token for another realm fails here. */
  async companyName(): Promise<string | null> {
    const answer = await this.#call(
      'GET',
      `companyinfo/${encodeURIComponent(this.#opts.realmId)}`,
      companyInfoSchema,
    )
    return answer.CompanyInfo.CompanyName?.trim() ||
      answer.CompanyInfo.LegalName?.trim() || null
  }

  /**
   * Every row of `select * from <entity> [where …]`, page by page. `where` is
   * built by the caller from constants or `qboQuote`d values only.
   */
  async queryAll<S extends z.ZodType>(
    entity: 'Account' | 'Customer' | 'Item' | 'TaxCode',
    where: string,
    schema: S,
  ): Promise<z.output<S>[]> {
    const rows: z.output<S>[] = []
    const pageSchema = z.looseObject({
      QueryResponse: z.looseObject({
        [entity]: z.array(z.unknown()).optional(),
      }),
    })
    for (let start = 1;; start += QUERY_PAGE) {
      const query = `select * from ${entity}${
        where ? ` where ${where}` : ''
      } startposition ${start} maxresults ${QUERY_PAGE}`
      const page = await this.#call('GET', 'query', pageSchema, {
        query: { query },
      })
      const items = (page.QueryResponse[entity] as unknown[] | undefined) ?? []
      for (const item of items) {
        const parsed = schema.safeParse(item)
        if (!parsed.success) throw new QboError('unusable_answer')
        rows.push(parsed.data)
      }
      if (items.length < QUERY_PAGE) return rows
      if (rows.length >= MAX_ROWS) throw new QboError('too_large')
    }
  }

  /** Every account, active or not (the map shows the active ones). */
  accounts(): Promise<QboAccount[]> {
    return this.queryAll('Account', 'Active in (true, false)', accountSchema)
  }

  /** Every customer, active or not (a matched inactive one is still not to be duplicated). */
  customers(): Promise<QboCustomer[]> {
    return this.queryAll('Customer', 'Active in (true, false)', customerSchema)
  }

  /** Creates a customer (the push's, `customers.ts`); the created row. */
  async createCustomer(
    payload: Record<string, unknown>,
    requestId?: string,
  ): Promise<QboCustomer> {
    const answer = await this.#call(
      'POST',
      'customer',
      z.looseObject({ Customer: customerSchema }),
      { body: payload, requestId },
    )
    return answer.Customer
  }

  /** Every item, active or not (a service code's item, GOrendezvous's). */
  items(): Promise<QboItem[]> {
    return this.queryAll('Item', 'Active in (true, false)', itemSchema)
  }

  /** Every tax code (the map's « taxable » and « exempt »). */
  taxCodes(): Promise<QboTaxCode[]> {
    return this.queryAll('TaxCode', '', taxCodeSchema)
  }

  /**
   * Creates one document of the push (CM: FQ part 2) — `invoice`,
   * `creditmemo`, `payment`, `vendor`, `bill`, `item` — with its
   * `requestid`; the created entity's id and, for a sale, its total.
   */
  async create(
    entity: QboEntity,
    payload: Record<string, unknown>,
    requestId: string,
  ): Promise<{ id: string; totalAmt: number | null }> {
    const key = ENTITY_KEYS[entity]
    const answer = await this.#call(
      'POST',
      entity,
      z.looseObject({ [key]: createdSchema }),
      { body: payload, requestId },
    )
    const created = answer[key] as z.infer<typeof createdSchema>
    return { id: created.Id, totalAmt: created.TotalAmt ?? null }
  }
}
