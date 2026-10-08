import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/**
 * The clinic's bank details as `get_bank_details` returns them: masked (the last 4 digits of the
 * account only). `updated_at` is an instant (timestamptz). The generated types say `string` for
 * every column; the email is optional and the author's name comes from a left join, so both may be null.
 */
const bankDetailsSchema = z.object({
  institution_number: z.string(),
  transit_number: z.string(),
  account_last4: z.string(),
  etransfer_email: z.string().nullable(),
  updated_at: z.string(),
  updated_by_name: z.string().nullable(),
})
export type BankDetails = z.infer<typeof bankDetailsSchema>

/** The org's masked bank details, or null when none are stored. Needs `settings.bank_manage` (else `42501`). */
export async function fetchBankDetails(): Promise<BankDetails | null> {
  const { data, error } = await supabase.rpc('get_bank_details')
  if (error) throw error
  const row = data?.[0]
  return row ? bankDetailsSchema.parse(row) : null
}

/**
 * The full account number (null when nothing is stored). Each call writes an audit row (`read`).
 * Never put the result in the React Query cache: keep it in component state (`useRevealedAccountNumber`).
 */
export async function revealAccountNumber(): Promise<string | null> {
  const { data, error } = await supabase.rpc('reveal_bank_account_number')
  if (error) throw error
  // Typed `string` by the generator, but SQL returns null when nothing is stored.
  return (data as string | null) ?? null
}

export interface BankDetailsInput {
  institution: string
  transit: string
  /** Digits only; null keeps the stored account (editing the transit alone). */
  account: string | null
  etransferEmail: string | null
}

/**
 * Creates or replaces the bank details. A refusal the user can fix (a number's format, no account
 * on the first save) is a French `P0001`; `bankDetailsSchema` mirrors those rules.
 */
export async function setBankDetails({ institution, transit, account, etransferEmail }: BankDetailsInput): Promise<void> {
  const { error } = await supabase.rpc('set_bank_details', {
    p_institution_number: institution,
    p_transit_number: transit,
    // The generator types every argument as `string`; SQL takes null (keep the account, no email).
    p_account_number: account as string,
    p_etransfer_email: etransferEmail as string,
  })
  if (error) throw error
}
