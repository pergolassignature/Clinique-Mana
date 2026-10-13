/**
 * The customers the push bills (R-30, roadmap §2.6 bis; FQ-5): the payer is
 * a parent customer, each (payer, dossier) pair a sub-customer « facturé
 * avec le parent » (`Job`, `ParentRef`, `BillWithParent`), never re-parented
 * (QuickBooks would move the history). A customer GOrendezvous made and the
 * mapping linked (`qbo_links`, source `matched`) is the payer's parent: it
 * is never created again.
 *
 * Written now, called by the push once invoices exist (F1): nothing in this
 * part of FQ creates anything in QuickBooks (FQ-4). The links are read and
 * written through `LinkStore`, which the push backs with its service RPCs.
 *
 * Names: QuickBooks wants a display name unique across its customers (and
 * vendors, employees), without « : » (its hierarchy separator). The parent
 * is « Prénom Nom », then « Prénom Nom (N° 1234) » when taken; the
 * sub-customer « N° 1234 · Prénom N. », then with « (payé par N° 5678) »
 * when the same dossier already has a sub-customer under another payer
 * (separated parents). PS Hub fell back to a name-only reference that let
 * QuickBooks guess the customer; here a second refusal is an error.
 */
import { type QboClient, QboError } from './client.ts'

/** A client as the push names it. */
export interface QboPerson {
  clientId: string
  clientNumber: number
  firstName: string
  lastName: string
  email?: string | null
}

export interface LinkStore {
  /** The payer's parent customer, or null. */
  payer(payerClientId: string): Promise<string | null>
  /** The (payer, dossier) sub-customer, or null. */
  dossier(payerClientId: string, clientId: string): Promise<string | null>
  record(
    link: {
      kind: 'payer' | 'dossier'
      payerClientId: string
      clientId?: string
      qboCustomerId: string
    },
  ): Promise<void>
}

/** A display name QuickBooks accepts: no « : », tabs or line breaks, at most 100 characters. */
export function cleanName(value: string): string {
  return value.replace(/[:\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(
    0,
    100,
  )
}

export function parentNames(p: QboPerson): string[] {
  const name = cleanName(`${p.firstName} ${p.lastName}`)
  return [name, cleanName(`${name} (N° ${p.clientNumber})`)]
}

export function dossierNames(payer: QboPerson, dossier: QboPerson): string[] {
  const initial = dossier.lastName.trim().charAt(0).toLocaleUpperCase('fr-CA')
  const base = cleanName(
    `N° ${dossier.clientNumber} · ${dossier.firstName}${
      initial ? ` ${initial}.` : ''
    }`,
  )
  return [base, cleanName(`${base} (payé par N° ${payer.clientNumber})`)]
}

/**
 * Intuit's `requestid` for one create: 32 hex characters derived from what
 * it is (a payer, a pair, a document) and the attempt's name rank, so a
 * request repeated after a lost answer gets the first answer back.
 */
export async function requestIdFor(...parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(parts.join('|')),
  )
  return [...new Uint8Array(digest).slice(0, 16)].map((b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

/** Creates with the first name free; a taken name tries the next; the last refusal throws. */
async function createWithNames(
  qbo: QboClient,
  names: string[],
  payload: (name: string) => Record<string, unknown>,
  key: string,
) {
  for (let i = 0; i < names.length; i++) {
    try {
      return await qbo.createCustomer(
        payload(names[i]),
        await requestIdFor(key, String(i)),
      )
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

/** The payer's parent customer id: the linked one, else created and linked. */
export async function ensurePayer(
  qbo: QboClient,
  store: LinkStore,
  payer: QboPerson,
): Promise<string> {
  const linked = await store.payer(payer.clientId)
  if (linked) return linked
  const created = await createWithNames(qbo, parentNames(payer), (name) => ({
    DisplayName: name,
    GivenName: cleanName(payer.firstName).slice(0, 100),
    FamilyName: cleanName(payer.lastName).slice(0, 100),
    ...(payer.email ? { PrimaryEmailAddr: { Address: payer.email } } : {}),
  }), `payer:${payer.clientId}`)
  await store.record({
    kind: 'payer',
    payerClientId: payer.clientId,
    qboCustomerId: created.Id,
  })
  return created.Id
}

/**
 * The customer an invoice of `dossier` paid by `payer` goes to: the pair's
 * sub-customer under the payer's parent, a client paying for herself
 * included (one sub-customer per pair, R-30, FQ-5: the parent's history —
 * GOrendezvous's invoices — stays on the parent, the new ones roll up).
 */
export async function ensureBillingCustomer(
  qbo: QboClient,
  store: LinkStore,
  payer: QboPerson,
  dossier: QboPerson,
): Promise<{ customerId: string; parentId: string }> {
  const parentId = await ensurePayer(qbo, store, payer)
  const linked = await store.dossier(payer.clientId, dossier.clientId)
  if (linked) return { customerId: linked, parentId }
  const created = await createWithNames(
    qbo,
    dossierNames(payer, dossier),
    (name) => ({
      DisplayName: name,
      GivenName: cleanName(dossier.firstName).slice(0, 100),
      FamilyName: cleanName(dossier.lastName).slice(0, 100),
      Job: true,
      ParentRef: { value: parentId },
      BillWithParent: true,
    }),
    `dossier:${payer.clientId}:${dossier.clientId}`,
  )
  await store.record({
    kind: 'dossier',
    payerClientId: payer.clientId,
    clientId: dossier.clientId,
    qboCustomerId: created.Id,
  })
  return { customerId: created.Id, parentId }
}
