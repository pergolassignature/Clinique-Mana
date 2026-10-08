import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { parseRpc } from './parse'
import { sqlArgs } from './sql-args'

/**
 * A professional's private data (4a.17, `professionals.private`): masks and plain numbers from
 * `get_professional_private`, one save per card with an optimistic check (P4-148), the audited
 * reveal and the removal of an encrypted field. A revealed value is returned to the caller only:
 * never cached (`useRevealedPrivateValue` keeps it in component state), never logged.
 */

/** The encrypted fields: revealed one at a time, removed with `clearProfessionalPrivateField`. */
export const PRIVATE_FIELDS = ['sin', 'bank_account'] as const
export type PrivateField = (typeof PRIVATE_FIELDS)[number]

/** Always one row (nulls when nothing is stored, P4-140); `updated_at` null means no row yet. */
const privatePayload = z
  .tuple([
    z.object({
      sin_last3: z.string().nullable(),
      business_number: z.string().nullable(),
      gst_number: z.string().nullable(),
      qst_number: z.string().nullable(),
      bank_institution: z.string().nullable(),
      bank_transit: z.string().nullable(),
      bank_account_last4: z.string().nullable(),
      updated_at: z.string().nullable(),
      updated_by_name: z.string().nullable(),
    }),
  ])
  .transform(([r]) => ({
    sinLast3: r.sin_last3,
    businessNumber: r.business_number,
    gstNumber: r.gst_number,
    qstNumber: r.qst_number,
    bankInstitution: r.bank_institution,
    bankTransit: r.bank_transit,
    bankAccountLast4: r.bank_account_last4,
    /**
     * The row's version, passed back unchanged as `p_expected_updated_at` by every card save (a
     * JavaScript `Date` would drop the microseconds; the RPC compares to the millisecond anyway).
     */
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name,
  }))
export type ProfessionalPrivate = z.output<typeof privatePayload>

/** The masked private data of a professional of the caller's clinic. */
export async function fetchProfessionalPrivate(id: string): Promise<ProfessionalPrivate> {
  const { data, error } = await supabase.rpc('get_professional_private', { p_id: id })
  if (error) throw error
  return parseRpc(privatePayload, data)
}

/**
 * The clear SIN or account number (null when nothing is stored). Each call writes an audit row
 * (`read`). Keep the result in component state only.
 */
export async function revealProfessionalPrivate(id: string, field: PrivateField): Promise<string | null> {
  const { data, error } = await supabase.rpc('reveal_professional_private', { p_id: id, p_field: field })
  if (error) throw error
  // Typed `string` by the generator; SQL returns null when nothing is stored.
  return (data as string | null) ?? null
}

/** The row's new `updated_at` a card save returns (null when there is still no row). */
const savedAt = z.string().nullable()

export interface TaxNumbersInput {
  businessNumber: string | null
  gstNumber: string | null
  qstNumber: string | null
}

/** « Fiscalité »: the three numbers as given (null clears). `expectedUpdatedAt`: what the card read. */
export async function setProfessionalTaxNumbers(id: string, input: TaxNumbersInput, expectedUpdatedAt: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    'set_professional_tax_numbers',
    sqlArgs<'set_professional_tax_numbers'>({
      p_id: id,
      p_business_number: input.businessNumber,
      p_gst_number: input.gstNumber,
      p_qst_number: input.qstNumber,
      p_expected_updated_at: expectedUpdatedAt,
    }),
  )
  if (error) throw error
  return parseRpc(savedAt, data)
}

export interface BankInput {
  institution: string | null
  transit: string | null
  /** Digits only; null keeps the stored account. */
  account: string | null
}

/** « Banque »: institution and transit as given (null clears), the account encrypted (null keeps it). */
export async function setProfessionalBank(id: string, input: BankInput, expectedUpdatedAt: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    'set_professional_bank',
    sqlArgs<'set_professional_bank'>({
      p_id: id,
      p_institution: input.institution,
      p_transit: input.transit,
      p_account: input.account,
      p_expected_updated_at: expectedUpdatedAt,
    }),
  )
  if (error) throw error
  return parseRpc(savedAt, data)
}

/** « NAS »: a full SIN (digits only), refused while the clinic does not collect it. */
export async function setProfessionalSin(id: string, sin: string, expectedUpdatedAt: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    'set_professional_sin',
    sqlArgs<'set_professional_sin'>({ p_id: id, p_sin: sin, p_expected_updated_at: expectedUpdatedAt }),
  )
  if (error) throw error
  return parseRpc(savedAt, data)
}

/** « Retirer »: removes the SIN or the account (and its mask). Nothing stored: no-op. */
export async function clearProfessionalPrivateField(id: string, field: PrivateField): Promise<void> {
  const { error } = await supabase.rpc('clear_professional_private_field', { p_id: id, p_field: field })
  if (error) throw error
}
