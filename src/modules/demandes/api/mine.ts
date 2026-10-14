import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/*
 * « Mes demandes » (R-80): the requests matched to the professional, whole (`my_demandes`,
 * demandes.self: her own while « Jumelée »; never the contact, the source, the counselor or the
 * internal note), with the names of Professionnels' published catalogues (`motifs_catalog`,
 * `clienteles_catalog`, `profession_titles_catalog`: active rows, which professionals.self reads).
 */

/** The rows read per catalogue (each holds a few dozen). */
const LIST_MAX = 500

const nullableString = z.string().nullable()
const textArray = z.array(z.string()).nullable().transform((v) => v ?? [])

const myDemandeSchema = z.object({
  id: z.string(),
  reference: z.string(),
  received_at: z.string(),
  matched_at: nullableString,
  beneficiary: nullableString,
  previous_therapy: z.boolean().nullable(),
  language: z.string(),
  modality: z.string(),
  availability_periods: textArray,
  availability_days: z.array(z.number().int()).nullable().transform((v) => v ?? []),
  preferred_pro_gender: z.string(),
  profession_title_id: nullableString,
  clientele_id: nullableString,
  concerns: nullableString,
  payer_kind: z.string(),
  insurer: nullableString,
  motif_ids: textArray,
  participants: z
    .array(z.object({ client_id: nullableString, display_name: nullableString, relationship: nullableString, is_primary: z.boolean() }))
    .nullable()
    .transform((v) => v ?? []),
  is_urgent: z.boolean().nullable().transform((v) => v ?? false),
  motif_other: nullableString,
  availability_other: nullableString,
  has_issues: z.boolean().nullable(),
  issues: textArray,
  issues_comment: nullableString,
  previous_professionals: textArray,
  previous_comment: nullableString,
  has_legal_context: z.boolean().nullable(),
  legal_context: textArray,
  legal_detail: nullableString,
})
export type MyDemande = z.infer<typeof myDemandeSchema>

const motifSchema = z.object({
  id: z.string(),
  name: z.string(),
  sort_order: z.number().nullable(),
  category_name: nullableString,
  category_sort_order: z.number().nullable(),
})
export type CatalogueMotif = z.infer<typeof motifSchema>
const nameSchema = z.object({ id: z.string(), name: z.string() })

export interface MyDemandes {
  demandes: MyDemande[]
  motifs: CatalogueMotif[]
  clienteles: Map<string, string>
  titles: Map<string, string>
}

/** Her matched requests, the most recently matched first, with the catalogues' names. */
export async function fetchMyDemandes(): Promise<MyDemandes> {
  const [demandes, motifs, clienteles, titles] = await Promise.all([
    supabase.from('my_demandes').select('*').order('matched_at', { ascending: false, nullsFirst: false }).order('received_at').limit(LIST_MAX),
    supabase.from('motifs_catalog').select('id, name, sort_order, category_name, category_sort_order').limit(LIST_MAX),
    supabase.from('clienteles_catalog').select('id, name').limit(LIST_MAX),
    supabase.from('profession_titles_catalog').select('id, name').limit(LIST_MAX),
  ])
  for (const result of [demandes, motifs, clienteles, titles]) if (result.error) throw result.error
  const names = (rows: unknown) => new Map(z.array(nameSchema).parse(rows).map((r) => [r.id, r.name]))
  return {
    demandes: z.array(myDemandeSchema).parse(demandes.data),
    motifs: z.array(motifSchema).parse(motifs.data),
    clienteles: names(clienteles.data),
    titles: names(titles.data),
  }
}
