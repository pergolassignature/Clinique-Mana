import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/**
 * The questionnaire's own wording, reworded by the clinic (P4-562). A step's title and
 * description are the app's (`modules.professionals.questionnaire.steps.<step>.*`) until the
 * clinic replaces one in Paramètres → Professionnels → « Questionnaire »; a row holds only what
 * was replaced, so the app's text keeps being improved where nothing was said.
 *
 * Everyone who reads the module's lists reads these, the professional filling her questionnaire
 * included — she holds `professionals.self` and nothing else.
 */

export const UNEXPECTED_SHAPE = 'professionals: unexpected questionnaire text shape'

const textsSchema = z.record(
  z.string(),
  z.object({ title: z.string().nullable(), description: z.string().nullable() }),
)
/** `{ languages: { title, description } }`; a step that was never reworded is absent. */
export type QuestionnaireSectionTexts = z.output<typeof textsSchema>

export async function fetchQuestionnaireSectionTexts(): Promise<QuestionnaireSectionTexts> {
  const { data, error } = await supabase.rpc('get_questionnaire_section_texts')
  if (error) throw error
  const parsed = textsSchema.safeParse(data)
  if (!parsed.success) throw new Error(UNEXPECTED_SHAPE)
  return parsed.data
}

/** Stores one step's wording; a blank title and description give the app's text back. */
export async function saveQuestionnaireSectionText(section: string, title: string, description: string): Promise<void> {
  const { error } = await supabase.rpc('set_questionnaire_section_text', {
    p_section: section,
    p_title: title,
    p_description: description,
  })
  if (error) throw error
}
