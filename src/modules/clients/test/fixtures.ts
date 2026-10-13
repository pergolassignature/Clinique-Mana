import type { ClientsReference } from '../api/clients'
import type { Client, ClientListRow, ClientSummary } from '../api/parse'

/** Fictional files for the module's tests (never a real person). */
export const CIDS = {
  alice: '00000000-0000-4000-8000-000000000a01',
  lea: '00000000-0000-4000-8000-000000000a02',
  marc: '00000000-0000-4000-8000-000000000a03',
  pro: '00000000-0000-4000-8000-000000000b01',
  source: '00000000-0000-4000-8000-000000000c01',
  tag: '00000000-0000-4000-8000-000000000d01',
} as const

export const REFERENCE: ClientsReference = {
  referralSources: [{ id: CIDS.source, name: 'Google', active: true }],
  tags: [{ id: CIDS.tag, name: 'Atelier', active: true }],
  professionals: [{ id: CIDS.pro, name: 'Félix Gauthier', active: true }],
}

export function clientFixture(overrides: Partial<Client> = {}): Client {
  return {
    id: CIDS.alice,
    clientNumber: 1,
    firstName: 'Alice',
    lastName: 'Tremblay',
    birthFirstName: null,
    pronouns: 'elle',
    sex: 'female',
    birthday: '1990-03-04',
    email: 'alice@exemple.test',
    mobile: '+15145550101',
    home: null,
    work: null,
    workExt: null,
    language: 'fr',
    timeZone: null,
    remindersBySms: true,
    remindersByEmail: true,
    addressLine1: '12 rue des Essais',
    addressLine2: null,
    city: 'Montréal',
    province: 'QC',
    postalCode: 'H2X 1A1',
    country: 'CA',
    referralSourceId: CIDS.source,
    referredBy: null,
    customField: null,
    primaryProfessionalId: CIDS.pro,
    rateVariant: 'student',
    taxExempt: false,
    isBanned: false,
    fileIncomplete: false,
    specialAgreement: false,
    sharedCustody: false,
    externalRef: null,
    archivedAt: null,
    mergedIntoId: null,
    anonymizedAt: null,
    createdAt: '2026-10-12T15:00:00Z',
    updatedAt: '2026-10-12T15:00:00Z',
    ...overrides,
  }
}

export function summaryFixture(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return {
    client: clientFixture(),
    adminNotes: 'Préfère les soirs.',
    specialAgreementNote: null,
    relations: [
      {
        id: 'r1',
        relatedId: CIDS.marc,
        relatedNumber: 3,
        relatedName: 'Marc Tremblay',
        relatedArchived: false,
        type: 'spouse',
        relatedRights: { main_contact: true, manages_appointments: false, receives_communications: true, receives_invoices: true },
        clientRights: { main_contact: false, manages_appointments: false, receives_communications: false, receives_invoices: false },
      },
    ],
    insurances: [],
    payers: [],
    tags: [{ id: CIDS.tag, name: 'Atelier' }],
    professionals: [{ professionalId: CIDS.pro, reason: 'primary', firstLinkedAt: '2026-10-12T15:00:00Z', lastLinkedAt: '2026-10-12T15:00:00Z' }],
    ...overrides,
  }
}

export function listRowFixture(overrides: Partial<ClientListRow> = {}): ClientListRow {
  return {
    id: CIDS.alice,
    clientNumber: 1,
    firstName: 'Alice',
    lastName: 'Tremblay',
    birthday: '1990-03-04',
    email: 'alice@exemple.test',
    mobile: '+15145550101',
    primaryProfessionalId: CIDS.pro,
    isArchived: false,
    tagIds: [CIDS.tag],
    rateVariant: 'student',
    taxExempt: false,
    isBanned: false,
    fileIncomplete: false,
    specialAgreement: false,
    cursor: { last: 'tremblay', first: 'alice', id: CIDS.alice },
    ...overrides,
  }
}
