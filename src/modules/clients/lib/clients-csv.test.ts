import { beforeAll, describe, expect, it } from 'vitest'
import { setClinicTimezone } from '@/shared/lib/timezone'
import type { ClientListRow } from '../api/parse'
import { clientsCsv } from './clients-csv'

const row = (over: Partial<ClientListRow> = {}): ClientListRow => ({
  id: 'c1',
  clientNumber: 12,
  firstName: 'Alice',
  lastName: 'Essai',
  birthday: '1990-04-02',
  email: 'alice@example.test',
  mobile: null,
  primaryProfessionalId: 'p1',
  isArchived: false,
  tagIds: ['t1', 'gone'],
  rateVariant: null,
  taxExempt: false,
  isBanned: false,
  fileIncomplete: true,
  specialAgreement: false,
  lastVisitAt: '2026-10-01T14:00:00Z',
  cursor: { last: 'essai', first: 'alice', id: 'c1', visit: null },
  ...over,
})

beforeAll(() => setClinicTimezone('America/Toronto'))

const lines = (content: string) => content.replace(/^\uFEFF/, '').split('\r\n')

describe('clientsCsv (L7)', () => {
  it('the files as the list shows them, the names by name, the date in the file name', () => {
    const file = clientsCsv(
      [row(), row({ id: 'c2', clientNumber: 13, firstName: '=Bruno', lastName: 'Essai', birthday: null, email: null, isArchived: true, tagIds: [], fileIncomplete: false, primaryProfessionalId: null, lastVisitAt: null })],
      { professionals: [{ id: 'p1', name: 'Pro Un' }], tags: [{ id: 't1', name: 'Couple' }] },
      '2026-10-14',
    )
    expect(file.fileName).toBe('clients-2026-10-14.csv')
    const [header, alice, bruno] = lines(file.content)
    expect(header).toBe('N° de dossier;Nom;Prénom;Date de naissance;Courriel;Cellulaire;Professionnel principal;Dernier rendez-vous;Indications;Étiquettes;État')
    expect(alice).toBe('CLI-000012;Essai;Alice;1990-04-02;alice@example.test;;Pro Un;2026-10-01;Dossier incomplet;Couple;Actif')
    // A name a spreadsheet would read as a formula is guarded.
    expect(bruno).toBe("CLI-000013;Essai;'=Bruno;;;;;;;;Archivé")
  })
})
