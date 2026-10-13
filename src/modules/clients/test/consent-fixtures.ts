import type { ClientConsentStatus, ConsentRule, ConsentSettings, ConsentTemplate, ConsentToObtain, ConsentType } from '../api/consents'

/** Synthetic consent data for the module's tests (no real client). */

export const TYPES: ConsentType[] = [
  {
    key: 'general',
    name: 'Consentement général',
    nameEn: 'General consent',
    clauses: [{ key: 'accord', kind: 'agree', text_fr: 'J’accepte.', text_en: 'I agree.' }],
    isActive: true,
  },
  { key: 'waitlist', name: 'Liste d’attente', nameEn: 'Waitlist', clauses: [], isActive: true },
  { key: 'eap', name: 'PAE', nameEn: 'EAP', clauses: [], isActive: false },
]

export const TEMPLATES: ConsentTemplate[] = [
  {
    id: 'tg-fr',
    consentKey: 'general',
    language: 'fr',
    title: 'Consentement général',
    published: { id: 'vg1', version: 1, publishedAt: '2026-10-01T14:00:00Z' },
    draft: { id: 'vg2', version: 2, placeholder: false },
  },
  { id: 'tg-en', consentKey: 'general', language: 'en', title: 'General consent', published: null, draft: { id: 'vge1', version: 1, placeholder: false } },
  { id: 'tw-fr', consentKey: 'waitlist', language: 'fr', title: 'Liste d’attente', published: null, draft: { id: 'vw1', version: 1, placeholder: false } },
  { id: 'tw-en', consentKey: 'waitlist', language: 'en', title: 'Waitlist', published: null, draft: { id: 'vwe1', version: 1, placeholder: true } },
]

export const RULES: ConsentRule[] = [
  { id: 'r1', consentKey: 'general', triggerKind: 'general', target: null, frequency: 'once', isActive: false },
  { id: 'r2', consentKey: 'waitlist', triggerKind: 'situation', target: 'liste d’attente', frequency: 'once', isActive: false },
]

export const SETTINGS: ConsentSettings = { dueDays: 1, reminderDays: 7, preAppointmentHours: 48, retentionPolicy: null, retentionYears: null }

export const statusOf = (over: Partial<ClientConsentStatus> & Pick<ClientConsentStatus, 'consentKey' | 'state'>): ClientConsentStatus => ({
  versionLabel: null,
  signedAt: null,
  requestId: null,
  dueAt: null,
  lastSentAt: null,
  consentId: null,
  withdrawnAt: null,
  fileId: null,
  source: null,
  copySentAt: null,
  inForce: false,
  ...over,
})

export const toObtain = (over: Partial<ConsentToObtain> = {}): ConsentToObtain => ({
  requestId: 'q1',
  clientId: 'c1',
  clientName: 'Camille Test',
  consentKey: 'general',
  consentName: 'Consentement général',
  language: 'fr',
  dueAt: '2026-10-20T04:00:00Z',
  isOverdue: false,
  createdAt: '2026-10-10T14:00:00Z',
  lastSentAt: '2026-10-10T14:00:00Z',
  remindedAt: null,
  answered: false,
  signingStatus: null,
  ...over,
})
