/**
 * The prompts of « Rédiger avec l'IA » (CM4): PS Hub's (`ai-rewrite-email/prompts.ts`), taken as
 * is where it fits a dispatch clinic, with three changes (CM-19): no CRM context (names, addresses
 * and numbers are replaced by placeholders and tokens before the call, `mask.ts`), the
 * placeholders the model must keep, and nothing clinical. Pure.
 */

export type DraftMode = 'write' | 'reply' | 'refine'

export interface PromptInput {
  mode: DraftMode
  /** The instruction typed (masked). */
  instruction: string
  /** The draft in the editor, as text (masked); empty when there is none. */
  draft: string
  /** The message replied to, as text (masked; the last 3 000 characters are kept). */
  original: string
  /** The subject field is empty: the model starts with « Objet: ». */
  subjectEmpty: boolean
  /** A file's person is known: the model may greet with {{person.first_name}}. */
  personKnown: boolean
}

export const ORIGINAL_MAX = 3_000
export const HISTORY_MAX = 20

/** The system prompt. */
export function buildSystemPrompt(
  input: Pick<PromptInput, 'mode' | 'subjectEmpty' | 'personKnown'>,
): string {
  let prompt =
    `Tu es un assistant de rédaction de courriels pour une clinique québécoise de psychothérapie. La clinique reçoit chaque demande et jumelle le client avec un professionnel ; les courriels sont écrits par l'équipe de la clinique (conseillères, adjointe).

Objectif: produire le genre de réécriture qu'un bon ChatGPT ferait: clair, naturel, exact, et prêt à envoyer.

Règles de qualité:
- Garde l'intention de l'utilisateur comme source principale. Si un brouillon existe, améliore ce brouillon; ne change pas le sujet, les engagements, les noms, les dates, les montants ni la prochaine étape sauf si l'instruction le demande clairement.
- N'ajoute pas de faits que le brouillon ou le message original ne donnent pas.
- Écris en français du Québec par défaut, vouvoiement, ton professionnel simple. Pas de ton corporatif, pas de chaleur forcée, pas de longue introduction.
- Évite les formules automatiques et irritantes: « je voulais simplement », « je tiens à », « n'hésitez pas à », « dès que vous avez eu la chance de », « veuillez trouver ci-joint », « je me permets de ».
- Préfère les verbes directs et les phrases courtes. Si une version courte suffit, reste court.
- Réponds uniquement avec le texte final du courriel, sans explication, sans guillemets, sans markdown.

Confidentialité:
- Les noms, adresses courriel et numéros sont remplacés par des variables entre {{ }} et des repères entre [[ ]]. Recopie-les exactement tels quels, aux bons endroits; n'en invente pas d'autres et n'écris jamais un nom ou un numéro à leur place.
- N'écris jamais d'information clinique: aucun diagnostic, symptôme, motif de consultation détaillé, contenu de séance ni avis professionnel. Si l'instruction en demande, reste général (« votre demande », « votre rendez-vous »).`
  prompt += input.personKnown
    ? `\n- Pour nommer la personne à qui l'on écrit, utilise {{person.first_name}} (et {{person.last_name}} au besoin).`
    : `\n- Le nom de la personne à qui l'on écrit n'est pas connu: salue sans nom (« Bonjour, »).`
  if (input.mode === 'refine') return prompt
  prompt += input.subjectEmpty
    ? `\n- Commence par une ligne "Objet: [ligne sujet concise, 60 caractères max, en français]", puis une ligne vide, puis le corps du courriel.`
    : `\n- N'écris pas de ligne "Objet:"; l'utilisateur a déjà rempli l'objet du courriel.`
  prompt +=
    `\n- Inclus une salutation si le courriel commence une réponse ou un nouveau message. Garde la fermeture minimale et naturelle. Ne mets pas de signature avec nom, titre, téléphone ou coordonnées; l'application l'ajoute séparément.`
  return prompt
}

/** The user's turn. */
export function buildUserTurn(input: PromptInput): string {
  if (input.mode === 'refine') return `Raffinement: ${input.instruction}`
  const parts: string[] = []
  const original = input.original.trim()
  if (original) {
    const clipped = original.length > ORIGINAL_MAX
      ? original.slice(-ORIGINAL_MAX)
      : original
    parts.push(
      `Message original auquel l'utilisateur réagit (contexte seulement; ne pas le citer ni le répéter):\n---\n${clipped}\n---`,
    )
  }
  if (input.draft.trim()) {
    parts.push(
      `Brouillon actuel de l'utilisateur (source principale; améliore-le selon l'instruction):\n---\n${input.draft.trim()}\n---`,
    )
  }
  const subjectLine = input.subjectEmpty
    ? `Inclure une ligne "Objet:" au début, comme demandé dans les règles système.`
    : `Ne pas inclure de ligne "Objet:".`
  parts.push(
    `Rédige le texte final du courriel selon l'instruction suivante. ${subjectLine}\n\nInstruction: ${input.instruction}`,
  )
  return parts.join('\n\n')
}

/** « Générer une réponse » (PS Hub's preset). */
export const REPLY_INSTRUCTION =
  'Rédige une réponse appropriée et professionnelle.'

/** A leading « Objet: … » line split from the body (PS Hub's `splitSubjectAndBody`). */
export function splitSubjectAndBody(
  text: string,
): { subject: string | null; body: string } {
  const match = /^\s*objet\s*:\s*(.+?)\s*(?:\r?\n|$)/i.exec(text)
  if (!match) return { subject: null, body: text.trim() }
  return {
    subject: match[1]!.trim().slice(0, 250),
    body: text.slice(match[0].length).trim(),
  }
}
