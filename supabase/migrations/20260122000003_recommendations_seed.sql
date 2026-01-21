-- Migration: recommendations_seed
-- Module: recommendations
-- Gate: 2 - Seed Data
-- Created: 2026-01-22
--
-- Seeds the default recommendation configuration.
-- Prompts are in FR-CA. Do not modify without careful review.
--
-- IMPORTANT: AI is advisory only - it analyzes pre-computed scores
-- and provides contextual reasoning, not decisions.

-- =============================================================================
-- DEFAULT RECOMMENDATION CONFIG
-- =============================================================================

insert into public.recommendation_configs (
  key,
  name_fr,
  description_fr,
  system_prompt,
  user_prompt_template,
  weight_motif_match,
  weight_specialty_match,
  weight_availability,
  weight_profession_fit,
  weight_experience,
  require_availability_within_days,
  require_motif_overlap,
  require_population_match,
  availability_max_hours,
  experience_max_years,
  is_active
) values (
  'default',
  'Configuration standard',
  'Configuration par défaut pour le jumelage client-professionnel',

  -- ==========================================================================
  -- SYSTEM PROMPT (FR-CA)
  -- ==========================================================================
  E'Tu es un conseiller en jumelage pour Clinique MANA, une clinique de santé mentale au Québec.

RÔLE
Tu assistes l''équipe administrative en analysant les demandes de consultation et les profils des professionnels. Tu ne prends aucune décision - tu fournis des observations et du contexte pour éclairer le jugement humain.

TÂCHES
1. Analyser le texte de la demande pour extraire les préférences implicites (horaire, modalité, urgence perçue)
2. Examiner les scores pré-calculés pour chaque candidat
3. Proposer des ajustements de classement basés sur des facteurs contextuels non captés par les scores
4. Générer 3 à 5 points explicatifs par professionnel, en français québécois

RÈGLES
- Reste factuel et neutre - évite le langage clinique ou diagnostique
- Ne mentionne jamais de noms de clients ou d''informations personnelles identifiables
- Tes ajustements de classement doivent rester entre -5 et +5
- Explique toujours le raisonnement derrière chaque ajustement
- Utilise un ton professionnel mais accessible

FORMAT DE SORTIE
Réponds uniquement avec un objet JSON valide:
{
  "extractedPreferences": {
    "timing": "string ou null (ex: soirs, fins de semaine, urgent)",
    "modality": "string ou null (ex: en personne, téléconsultation, hybride)",
    "otherFactors": ["array de facteurs contextuels relevés"]
  },
  "rankings": [
    {
      "professionalId": "uuid",
      "adjustment": number (-5 à +5),
      "reasoningBullets": ["3-5 points en français"]
    }
  ],
  "summaryFr": "2-3 phrases résumant les recommandations principales"
}',

  -- ==========================================================================
  -- USER PROMPT TEMPLATE
  -- Placeholders: {{demandType}}, {{urgencyLevel}}, {{motifKeys}}, {{clientText}},
  --               {{hasLegalContext}}, {{populationType}}, {{candidates}}
  -- ==========================================================================
  E'## Contexte de la demande

**Type de demande:** {{demandType}}
**Niveau d''urgence:** {{urgencyLevel}}
**Motifs identifiés:** {{motifKeys}}
**Population:** {{populationType}}
**Contexte légal:** {{hasLegalContext}}

### Message du client (texte anonymisé)
{{clientText}}

---

## Candidats avec scores pré-calculés

{{candidates}}

---

## Instructions

Analyse cette demande et les candidats proposés. Pour chaque candidat:

1. Examine si les scores reflètent bien l''adéquation avec les besoins exprimés
2. Identifie les facteurs contextuels qui pourraient justifier un ajustement
3. Formule 3-5 points explicatifs en français québécois

Retourne ta réponse en JSON selon le format spécifié dans les instructions système.',

  -- Scoring weights (must sum to 100)
  30, -- weight_motif_match
  25, -- weight_specialty_match
  20, -- weight_availability
  15, -- weight_profession_fit
  10, -- weight_experience

  -- Hard constraints
  14,   -- require_availability_within_days
  true, -- require_motif_overlap
  true, -- require_population_match

  -- Normalization bounds
  40, -- availability_max_hours
  20, -- experience_max_years

  true -- is_active
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  weight_motif_match = excluded.weight_motif_match,
  weight_specialty_match = excluded.weight_specialty_match,
  weight_availability = excluded.weight_availability,
  weight_profession_fit = excluded.weight_profession_fit,
  weight_experience = excluded.weight_experience,
  require_availability_within_days = excluded.require_availability_within_days,
  require_motif_overlap = excluded.require_motif_overlap,
  require_population_match = excluded.require_population_match,
  availability_max_hours = excluded.availability_max_hours,
  experience_max_years = excluded.experience_max_years,
  is_active = excluded.is_active,
  updated_at = now();
