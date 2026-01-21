// src/recommendations/prompts/build-prompt.ts
// Utilities for building prompts for the AI advisory layer

import type { AIAdvisoryInput } from '../types'

// =============================================================================
// PLACEHOLDER CONSTANTS
// =============================================================================

/**
 * Standard placeholders supported in prompt templates.
 * These are replaced with actual values from AIAdvisoryInput.
 */
export const PLACEHOLDERS = {
  DEMAND_TYPE: '{{demandType}}',
  URGENCY_LEVEL: '{{urgencyLevel}}',
  MOTIF_KEYS: '{{motifKeys}}',
  CLIENT_TEXT: '{{clientText}}',
  HAS_LEGAL_CONTEXT: '{{hasLegalContext}}',
  POPULATION_CATEGORIES: '{{populationCategories}}',
  CANDIDATES_JSON: '{{candidatesJson}}',
  CANDIDATES_COUNT: '{{candidatesCount}}',
  // Holistic signal placeholders
  HOLISTIC_SCORE: '{{holisticScore}}',
  HOLISTIC_CATEGORY: '{{holisticCategory}}',
  HOLISTIC_KEYWORDS: '{{holisticKeywords}}',
  RECOMMEND_NATUROPATH: '{{recommendNaturopath}}',
  HAS_CLINICAL_OVERRIDE: '{{hasClinicalOverride}}',
} as const

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format an array of strings for display in a prompt.
 * Returns a comma-separated list or "aucun" if empty.
 */
function formatStringArray(arr: string[]): string {
  if (arr.length === 0) return 'aucun'
  return arr.join(', ')
}

/**
 * Format candidates array as JSON for the prompt.
 * Includes only the fields relevant for AI analysis.
 */
function formatCandidatesJson(candidates: AIAdvisoryInput['candidates']): string {
  // Map to a cleaner format for the prompt
  const formatted = candidates.map((c, index) => ({
    rang: index + 1,
    id: c.id,
    type: c.professionType,
    scoreActuel: Math.round(c.deterministicScore * 100) / 100,
    motifsCorrespondants: c.matchedMotifCount,
    plagesDisponibles: c.availableSlotCount,
    anneesExperience: c.yearsExperience,
  }))

  return JSON.stringify(formatted, null, 2)
}

/**
 * Format legal context for display.
 */
function formatLegalContext(hasLegal: boolean): string {
  return hasLegal ? 'oui (contexte juridique/médiation)' : 'non'
}

// =============================================================================
// MAIN PROMPT BUILDING FUNCTIONS
// =============================================================================

/**
 * Build the user prompt by replacing placeholders with actual values.
 *
 * Supported placeholders:
 * - {{demandType}} - Type of consultation (individual, couple, family, group)
 * - {{urgencyLevel}} - Urgency level (low, moderate, high)
 * - {{motifKeys}} - Comma-separated list of motif keys
 * - {{clientText}} - Combined sanitized client text
 * - {{hasLegalContext}} - Legal context indicator
 * - {{populationCategories}} - Population categories (children, adults, etc.)
 * - {{candidatesJson}} - JSON array of candidate data
 * - {{candidatesCount}} - Number of candidates
 *
 * @param input - Sanitized AI advisory input
 * @param template - User prompt template with placeholders
 * @returns Fully populated user prompt
 */
export function buildUserPrompt(
  input: AIAdvisoryInput,
  template: string
): string {
  let prompt = template

  // Replace all placeholders
  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.DEMAND_TYPE), 'g'),
    input.demandType
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.URGENCY_LEVEL), 'g'),
    input.urgencyLevel
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.MOTIF_KEYS), 'g'),
    formatStringArray(input.motifKeys)
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.CLIENT_TEXT), 'g'),
    input.clientText || 'Aucune description fournie.'
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.HAS_LEGAL_CONTEXT), 'g'),
    formatLegalContext(input.hasLegalContext)
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.POPULATION_CATEGORIES), 'g'),
    formatStringArray(input.populationCategories)
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.CANDIDATES_JSON), 'g'),
    formatCandidatesJson(input.candidates)
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.CANDIDATES_COUNT), 'g'),
    String(input.candidates.length)
  )

  // Holistic signal placeholders
  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.HOLISTIC_SCORE), 'g'),
    String(Math.round(input.holisticSignal.score * 100) / 100)
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.HOLISTIC_CATEGORY), 'g'),
    input.holisticSignal.category
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.HOLISTIC_KEYWORDS), 'g'),
    formatStringArray(input.holisticSignal.matchedKeywords)
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.RECOMMEND_NATUROPATH), 'g'),
    input.holisticSignal.recommendNaturopath ? 'oui' : 'non'
  )

  prompt = prompt.replace(
    new RegExp(escapeRegex(PLACEHOLDERS.HAS_CLINICAL_OVERRIDE), 'g'),
    input.holisticSignal.hasClinicalOverride ? 'oui (détresse clinique détectée)' : 'non'
  )

  return prompt
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Validate that a prompt template contains required placeholders.
 * Returns list of missing placeholders.
 */
export function validatePromptTemplate(template: string): string[] {
  const requiredPlaceholders = [
    PLACEHOLDERS.DEMAND_TYPE,
    PLACEHOLDERS.CANDIDATES_JSON,
  ]

  const missing: string[] = []
  for (const placeholder of requiredPlaceholders) {
    if (!template.includes(placeholder)) {
      missing.push(placeholder)
    }
  }

  return missing
}

// =============================================================================
// DEFAULT PROMPTS
// =============================================================================

/**
 * Default system prompt for the AI advisory layer.
 * Used when no custom system prompt is configured.
 */
export const DEFAULT_SYSTEM_PROMPT = `Tu es un assistant spécialisé dans l'orientation vers des professionnels de santé mentale et bien-être pour la Clinique MANA.

Ton rôle est d'analyser les demandes de consultation et de fournir des recommandations structurées pour aider le personnel à jumeler les clients avec les professionnels appropriés.

IMPORTANT:
- Tu ne fais PAS de diagnostic clinique
- Tu ne recommandes PAS de traitement
- Tu analyses uniquement la correspondance entre les besoins exprimés et les profils professionnels disponibles
- Toutes tes réponses doivent être en français canadien

RÈGLE APPROCHE GLOBALE (NATUROPATHE):
- Si le client mentionne des besoins liés au corps, à l'énergie, à la digestion, au sommeil, à l'alimentation, à l'équilibre de vie, ou demande explicitement une "approche globale" ou "holistique", et qu'il n'y a PAS de détresse clinique aiguë détectée, le Naturopathe doit être fortement favorisé dans ton classement.
- Les Psychologues/Psychothérapeutes restent admissibles pour ces cas, mais ne sont pas le premier choix pour les besoins corps/énergie/bien-être.
- EXCEPTION: Si des indicateurs de crise sont présents (idées noires, trauma, violence, etc.), le Psychologue/Psychothérapeute doit être recommandé en priorité, même si des besoins holistiques sont également présents.

Tu dois répondre UNIQUEMENT avec un objet JSON valide, sans texte supplémentaire avant ou après.`

/**
 * Default user prompt template for the AI advisory layer.
 * Used when no custom template is configured.
 */
export const DEFAULT_USER_PROMPT_TEMPLATE = `Analyse cette demande de consultation et fournis des recommandations de jumelage.

## Informations sur la demande

- **Type de consultation**: {{demandType}}
- **Niveau d'urgence**: {{urgencyLevel}}
- **Motifs identifiés**: {{motifKeys}}
- **Catégories de population**: {{populationCategories}}
- **Contexte juridique**: {{hasLegalContext}}

### Signal d'approche globale (corps/énergie/bien-être)
- **Score holistique**: {{holisticScore}} (0 = aucun signal, 1 = très fort signal)
- **Catégorie détectée**: {{holisticCategory}}
- **Mots-clés trouvés**: {{holisticKeywords}}
- **Recommander Naturopathe en priorité**: {{recommendNaturopath}}
- **Indicateurs de crise détectés**: {{hasClinicalOverride}}

### Description du client
{{clientText}}

## Candidats pré-évalués ({{candidatesCount}} professionnels)

Les candidats suivants ont déjà passé les filtres de base (disponibilité, correspondance de motifs, spécialités). Ils sont classés par score déterministe initial.

\`\`\`json
{{candidatesJson}}
\`\`\`

## Ta tâche

1. **Extraire les préférences** du texte du client:
   - Préférences de timing (matin, soir, après 16h, etc.)
   - Préférence de modalité (en personne, vidéo)
   - Autres contraintes mentionnées

2. **Ajuster le classement** de chaque candidat:
   - Ajustement entre -5 et +5 basé sur des facteurs qualitatifs non capturés par le score déterministe
   - Exemples: meilleure correspondance avec les contraintes de temps exprimées, expertise particulière pertinente

3. **Générer des explications** en français pour chaque candidat:
   - 3 à 5 points expliquant pourquoi ce professionnel correspond (ou non) à la demande
   - Ton professionnel mais accessible

4. **Résumé global** en 2-3 phrases pour le personnel

## Format de réponse (JSON strict)

\`\`\`json
{
  "extractedPreferences": {
    "preferredTiming": "string ou null",
    "preferredModality": "string ou null",
    "otherConstraints": ["array de strings ou vide"]
  },
  "rankings": [
    {
      "professionalId": "uuid du candidat",
      "rankingAdjustment": 0.0,
      "reasoningBullets": [
        "Point 1 en français",
        "Point 2 en français",
        "Point 3 en français"
      ]
    }
  ],
  "summaryFr": "Résumé global en français pour le personnel."
}
\`\`\`

Réponds UNIQUEMENT avec le JSON, sans markdown ni texte supplémentaire.`
