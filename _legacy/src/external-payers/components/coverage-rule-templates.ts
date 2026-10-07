import type { PAECoverageRule } from '../types'

export interface CoverageRuleTemplate {
  id: string
  label: string
  description: string
  rules: PAECoverageRule[]
}

export const COVERAGE_RULE_TEMPLATES: CoverageRuleTemplate[] = [
  {
    id: 'free_3_then_50_50',
    label: '3 rendez-vous gratuits puis 50/50',
    description: 'Les 3 premiers rendez-vous sont entierement couverts, puis le cout est partage 50/50',
    rules: [
      { type: 'free_appointments', order: 1, appointment_count: 3 },
      { type: 'shared_cost', order: 2, from_appointment: 4, pae_percentage: 50 },
    ],
  },
  {
    id: 'free_4_plus_evaluation',
    label: '4 rendez-vous + frais dossier + 1 evaluation + 1 suivi',
    description: '4 rendez-vous gratuits avec evaluation et suivi inclus',
    rules: [
      { type: 'free_appointments', order: 1, appointment_count: 4 },
      { type: 'included_services', order: 2, services: ['evaluation', 'suivi'] },
    ],
  },
  {
    id: 'free_3_then_fixed_50',
    label: '3 rendez-vous gratuits puis client paie 50$',
    description: 'Les 3 premiers rendez-vous sont gratuits, puis le client paie 50$ par seance',
    rules: [
      { type: 'free_appointments', order: 1, appointment_count: 3 },
      { type: 'fixed_client_amount', order: 2, from_appointment: 4, client_amount_cents: 5000 },
    ],
  },
  {
    id: 'free_6_full',
    label: '6 rendez-vous entierement couverts',
    description: 'Les 6 premiers rendez-vous sont entierement pris en charge',
    rules: [
      { type: 'free_appointments', order: 1, appointment_count: 6 },
    ],
  },
  {
    id: 'shared_70_30',
    label: '70% PAE / 30% client des le debut',
    description: 'Partage des couts 70/30 des le premier rendez-vous',
    rules: [
      { type: 'shared_cost', order: 1, from_appointment: 1, pae_percentage: 70 },
    ],
  },
]
