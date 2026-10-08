/**
 * Reference fiche for the renderer tests and bench (plan Tasks 3.29–3.30): two
 * Letter pages with a 600×200 PNG logo (with alpha) and a 400×400 JPEG photo,
 * passed as assets (`logo.png`, `photo.jpg` in this folder). Test data only.
 */
import type { Block, PdfDocument } from '../model.ts'

const p = (text: string, label?: string): Block => ({
  type: 'paragraph',
  runs: label ? [{ text: `${label} : `, bold: true }, { text }] : [{ text }],
})
const h2 = (text: string): Block => ({ type: 'heading', level: 2, text })
const ul = (...items: string[]): Block => ({
  type: 'list',
  ordered: false,
  items: items.map((text) => [{ text }]),
})

/** The reference fiche (2 pages, no signing fields). */
export const referenceFiche: PdfDocument = {
  title: 'Fiche du professionnel',
  footer: { text: 'Clinique MANA · Fiche du professionnel' },
  blocks: [
    { type: 'image', assetKey: 'logo', width: 180 },
    { type: 'heading', level: 1, text: 'Geneviève Lévesque-Bérubé' },
    { type: 'image', assetKey: 'photo', width: 120 },
    p('Psychothérapeute', 'Titre'),
    p('Ordre des psychologues du Québec, permis nº 12345-67', 'Ordre'),
    p('Français, anglais', 'Langues'),
    p('Adultes, couples, adolescents (14 ans et plus)', 'Clientèle'),
    h2('Approche'),
    p(
      'Geneviève accompagne les personnes qui traversent une période de changement : transition de carrière, séparation, deuil ou fatigue profonde. Son approche est chaleureuse et concrète; elle s’appuie sur la thérapie d’acceptation et d’engagement et sur l’approche centrée sur les émotions.',
    ),
    p(
      'Elle accorde une grande place au rythme de chaque personne et à ce qu’elle souhaite changer. Les rencontres se tiennent en ligne, en soirée deux fois par semaine.',
    ),
    h2('Motifs de consultation'),
    ul(
      'Anxiété et inquiétudes au quotidien',
      'Épuisement et équilibre travail-famille',
      'Deuil et pertes',
      'Relations de couple et communication',
      'Estime de soi et affirmation',
      'Transitions de vie (déménagement, retraite, parentalité)',
    ),
    { type: 'pageBreak' },
    h2('Formation'),
    ul(
      'Maîtrise en psychologie — Université de Montréal (2012)',
      'Formation en thérapie d’acceptation et d’engagement, niveaux 1 et 2',
      'Formation en thérapie de couple centrée sur les émotions (EFT)',
      'Supervision clinique continue depuis 2015',
    ),
    h2('Services offerts'),
    {
      type: 'table',
      columns: [
        { label: 'Service', width: 60 },
        { label: 'Durée', width: 20 },
        { label: 'Modalité', width: 20 },
      ],
      rows: [
        ['Consultation individuelle', '50 min', 'En ligne'],
        ['Consultation de couple', '80 min', 'En ligne'],
        ['Suivi téléphonique bref', '25 min', 'Téléphone'],
        ['Groupe « Mieux-être »', '120 min', 'En ligne'],
      ],
    },
    h2('Disponibilités'),
    p('Mardi et jeudi, de 17 h à 21 h; samedi, de 9 h à 12 h.'),
    p(
      'Les renseignements de cette fiche servent à l’orientation des demandes. Ils ne constituent ni une évaluation ni un avis professionnel.',
    ),
  ],
}
