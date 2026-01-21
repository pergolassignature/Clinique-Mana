import type { Demande, DemandeListItem, DemandeStatus } from '../types'

// =============================================================================
// ID Generator
// =============================================================================

function generateDemandeId(year: number, num: number): string {
  return `DEM-${year}-${String(num).padStart(4, '0')}`
}

// =============================================================================
// Motif Labels (FR-CA display names)
// =============================================================================

const MOTIF_LABELS: Record<string, string> = {
  anxiety: 'Anxiété',
  stress: 'Stress',
  burnout: 'Épuisement',
  relationships: 'Relations',
  emotions: 'Émotions',
  parenting: 'Soutien parental',
  selfExploration: 'Questionnement',
  lifeTransition: 'Transition',
  workSupport: 'Travail',
  grief: 'Deuil',
  selfEsteem: 'Estime de soi',
  other: 'Autre',
}

// =============================================================================
// Mock Demandes (15 demandes with realistic FR-CA data)
// =============================================================================

export const MOCK_DEMANDES: Demande[] = [
  // 1. Individual - To Analyze - High urgency
  {
    id: generateDemandeId(2026, 47),
    status: 'toAnalyze',
    demandType: 'individual',
    selectedMotifs: ['anxiety', 'burnout'],
    motifDescription: 'Difficultés depuis plusieurs mois, impact sur le travail',
    otherMotifText: '',
    urgency: 'high',
    notes: 'Cliente semble très fatiguée, mentionne des difficultés de concentration',
    createdAt: '2026-01-18T10:30:00.000Z',
    participants: [
      {
        id: 'part-1',
        clientId: 'CLI-1234567',
        name: 'Marie-Claire Dubois',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-10' },
      },
    ],
  },
  // 2. Couple - To Analyze - Moderate urgency
  {
    id: generateDemandeId(2026, 46),
    status: 'toAnalyze',
    demandType: 'couple',
    selectedMotifs: ['relationships'],
    motifDescription: 'Communication difficile depuis quelques mois',
    otherMotifText: '',
    urgency: 'moderate',
    notes: 'Couple ensemble depuis 8 ans, première demande de suivi',
    createdAt: '2026-01-17T14:00:00.000Z',
    participants: [
      {
        id: 'part-2',
        clientId: 'CLI-1234568',
        name: 'Jean-Philippe Tremblay',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-15' },
      },
      {
        id: 'part-3',
        clientId: 'CLI-1234590',
        name: 'Caroline Tremblay',
        role: 'participant',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-15' },
      },
    ],
  },
  // 3. Individual - To Analyze - Low urgency
  {
    id: generateDemandeId(2026, 45),
    status: 'toAnalyze',
    demandType: 'individual',
    selectedMotifs: ['selfExploration', 'lifeTransition'],
    motifDescription: 'Questionnement sur orientation professionnelle',
    otherMotifText: '',
    urgency: 'low',
    notes: '',
    createdAt: '2026-01-16T09:00:00.000Z',
    participants: [
      {
        id: 'part-4',
        clientId: 'CLI-1234571',
        name: 'Élodie Bergeron',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-16' },
      },
    ],
  },
  // 4. Family - To Analyze - Moderate urgency
  {
    id: generateDemandeId(2026, 44),
    status: 'toAnalyze',
    demandType: 'family',
    selectedMotifs: ['parenting', 'relationships'],
    motifDescription: 'Difficultés avec adolescent de 15 ans',
    otherMotifText: '',
    urgency: 'moderate',
    notes: 'Famille de 4, adolescent présent lors de la première rencontre',
    createdAt: '2026-01-15T11:00:00.000Z',
    participants: [
      {
        id: 'part-5',
        clientId: 'CLI-1234576',
        name: 'Pierre-Luc Pelletier',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-14' },
      },
      {
        id: 'part-6',
        clientId: 'CLI-1234591',
        name: 'Nathalie Pelletier',
        role: 'participant',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-14' },
      },
      {
        id: 'part-7',
        clientId: 'CLI-1234577',
        name: 'Léa Pelletier',
        role: 'participant',
        consent: { status: 'missing' },
      },
    ],
  },
  // 5. Individual - To Analyze - High urgency
  {
    id: generateDemandeId(2026, 43),
    status: 'toAnalyze',
    demandType: 'individual',
    selectedMotifs: ['grief', 'emotions'],
    motifDescription: 'Perte récente d\'un proche',
    otherMotifText: '',
    urgency: 'high',
    notes: 'Décès il y a 3 semaines, client très affecté',
    createdAt: '2026-01-14T15:30:00.000Z',
    participants: [
      {
        id: 'part-8',
        clientId: 'CLI-1234572',
        name: 'François Lavoie',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-14' },
      },
    ],
  },
  // 6. Individual - Assigned - Moderate urgency
  {
    id: generateDemandeId(2026, 42),
    status: 'assigned',
    demandType: 'individual',
    selectedMotifs: ['stress', 'workSupport'],
    motifDescription: 'Stress lié au travail, nouveau poste de gestion',
    otherMotifText: '',
    urgency: 'moderate',
    notes: 'Assignée à Dre Marie Tremblay - première rencontre prévue le 22 janvier',
    createdAt: '2026-01-12T09:00:00.000Z',
    participants: [
      {
        id: 'part-9',
        clientId: 'CLI-1234569',
        name: 'Sophie Gagnon-Leclerc',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-11' },
      },
    ],
  },
  // 7. Couple - Assigned - Low urgency
  {
    id: generateDemandeId(2026, 41),
    status: 'assigned',
    demandType: 'couple',
    selectedMotifs: ['relationships', 'parenting'],
    motifDescription: 'Accompagnement suite à l\'arrivée du premier enfant',
    otherMotifText: '',
    urgency: 'low',
    notes: 'Assignée à Jean-Philippe Bouchard - suivi préventif',
    createdAt: '2026-01-10T14:00:00.000Z',
    participants: [
      {
        id: 'part-10',
        clientId: 'CLI-1234573',
        name: 'Maxime Roy',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-09' },
      },
      {
        id: 'part-11',
        clientId: 'CLI-1234592',
        name: 'Audrey Fournier',
        role: 'participant',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-09' },
      },
    ],
  },
  // 8. Individual - Assigned - High urgency
  {
    id: generateDemandeId(2026, 40),
    status: 'assigned',
    demandType: 'individual',
    selectedMotifs: ['anxiety', 'selfEsteem'],
    motifDescription: 'Crises d\'anxiété fréquentes',
    otherMotifText: '',
    urgency: 'high',
    notes: 'Assignée à Sophie Gagnon - suivi hebdomadaire recommandé',
    createdAt: '2026-01-08T10:00:00.000Z',
    participants: [
      {
        id: 'part-12',
        clientId: 'CLI-1234574',
        name: 'Alexandre Morin',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-07' },
      },
    ],
  },
  // 9. Family - Assigned - Moderate urgency
  {
    id: generateDemandeId(2026, 39),
    status: 'assigned',
    demandType: 'family',
    selectedMotifs: ['parenting', 'emotions'],
    motifDescription: 'Accompagnement familial suite à une séparation',
    otherMotifText: '',
    urgency: 'moderate',
    notes: 'Assignée à Dre Marie Tremblay',
    createdAt: '2026-01-05T11:30:00.000Z',
    participants: [
      {
        id: 'part-13',
        clientId: 'CLI-1234575',
        name: 'Isabelle Girard',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-04' },
      },
      {
        id: 'part-14',
        clientId: 'CLI-1234593',
        name: 'Thomas Girard',
        role: 'participant',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-01-10' },
      },
    ],
  },
  // 10. Individual - Assigned - Low urgency
  {
    id: generateDemandeId(2026, 38),
    status: 'assigned',
    demandType: 'individual',
    selectedMotifs: ['selfExploration'],
    motifDescription: 'Développement personnel',
    otherMotifText: '',
    urgency: 'low',
    notes: 'Assignée à Jean-Philippe Bouchard',
    createdAt: '2026-01-03T16:00:00.000Z',
    participants: [
      {
        id: 'part-15',
        clientId: 'CLI-1234578',
        name: 'Camille Beaulieu',
        role: 'principal',
        consent: { status: 'valid', version: '2.1', signedDate: '2026-01-02' },
      },
    ],
  },
  // 11. Individual - Closed
  {
    id: generateDemandeId(2025, 156),
    status: 'closed',
    demandType: 'individual',
    selectedMotifs: ['grief'],
    motifDescription: 'Deuil d\'un proche',
    otherMotifText: '',
    urgency: 'moderate',
    notes: 'Suivi complété, client référé pour suivi à long terme',
    createdAt: '2025-11-20T10:00:00.000Z',
    participants: [
      {
        id: 'part-16',
        clientId: 'CLI-1234570',
        name: 'Martin Côté',
        role: 'principal',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-11-15' },
      },
    ],
  },
  // 12. Couple - Closed
  {
    id: generateDemandeId(2025, 142),
    status: 'closed',
    demandType: 'couple',
    selectedMotifs: ['relationships'],
    motifDescription: 'Thérapie de couple - communication',
    otherMotifText: '',
    urgency: 'low',
    notes: 'Objectifs atteints après 8 séances',
    createdAt: '2025-09-15T09:30:00.000Z',
    participants: [
      {
        id: 'part-17',
        clientId: 'CLI-1234579',
        name: 'Vincent Lefebvre',
        role: 'principal',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-09-10' },
      },
      {
        id: 'part-18',
        clientId: 'CLI-1234594',
        name: 'Marie-Ève Lefebvre',
        role: 'participant',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-09-10' },
      },
    ],
  },
  // 13. Individual - Closed
  {
    id: generateDemandeId(2025, 128),
    status: 'closed',
    demandType: 'individual',
    selectedMotifs: ['burnout', 'workSupport'],
    motifDescription: 'Épuisement professionnel',
    otherMotifText: '',
    urgency: 'high',
    notes: 'Retour au travail réussi, suivi préventif recommandé dans 6 mois',
    createdAt: '2025-07-10T14:00:00.000Z',
    participants: [
      {
        id: 'part-19',
        clientId: 'CLI-1234580',
        name: 'Julie Marchand',
        role: 'principal',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-07-05' },
      },
    ],
  },
  // 14. Family - Closed
  {
    id: generateDemandeId(2025, 115),
    status: 'closed',
    demandType: 'family',
    selectedMotifs: ['parenting', 'relationships', 'emotions'],
    motifDescription: 'Accompagnement familial - adolescence',
    otherMotifText: '',
    urgency: 'moderate',
    notes: 'Dynamique familiale améliorée',
    createdAt: '2025-05-22T11:00:00.000Z',
    participants: [
      {
        id: 'part-20',
        clientId: 'CLI-1234581',
        name: 'Sylvain Nadeau',
        role: 'principal',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-05-20' },
      },
      {
        id: 'part-21',
        clientId: 'CLI-1234595',
        name: 'Christine Nadeau',
        role: 'participant',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-05-20' },
      },
      {
        id: 'part-22',
        clientId: 'CLI-1234596',
        name: 'Olivier Nadeau',
        role: 'participant',
        consent: { status: 'expired', version: '2.0', signedDate: '2025-05-20' },
      },
    ],
  },
  // 15. Individual - Closed
  {
    id: generateDemandeId(2025, 98),
    status: 'closed',
    demandType: 'individual',
    selectedMotifs: ['lifeTransition', 'selfEsteem'],
    motifDescription: 'Transition de vie - retraite',
    otherMotifText: '',
    urgency: 'low',
    notes: 'Adaptation réussie, fin de suivi',
    createdAt: '2025-03-08T10:30:00.000Z',
    participants: [
      {
        id: 'part-23',
        clientId: 'CLI-1234582',
        name: 'Robert Duchesne',
        role: 'principal',
        consent: { status: 'expired', version: '1.0', signedDate: '2025-03-05' },
      },
    ],
  },
]

// =============================================================================
// Transform to List Items
// =============================================================================

export function demandeToListItem(demande: Demande): DemandeListItem {
  const primaryParticipant = demande.participants.find(p => p.role === 'principal')

  return {
    id: demande.id,
    status: demande.status,
    demandType: demande.demandType,
    urgency: demande.urgency,
    createdAt: demande.createdAt,
    primaryClientName: primaryParticipant?.name || null,
    participantCount: demande.participants.length,
    motifLabels: demande.selectedMotifs.slice(0, 2).map(m => MOTIF_LABELS[m] || m),
    motifCount: demande.selectedMotifs.length,
  }
}

export const MOCK_DEMANDE_LIST_ITEMS: DemandeListItem[] = MOCK_DEMANDES.map(demandeToListItem)

// =============================================================================
// Status Counts (for filter badges)
// =============================================================================

export function getStatusCounts(): Record<DemandeStatus | 'all', number> {
  const counts: Record<DemandeStatus | 'all', number> = {
    toAnalyze: 0,
    assigned: 0,
    closed: 0,
    all: MOCK_DEMANDES.length,
  }
  MOCK_DEMANDES.forEach(d => {
    counts[d.status]++
  })
  return counts
}
