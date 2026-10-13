import { beforeAll, describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { cancellationsReport, followUpReport, invoiceReport, paymentReport, serviceReport } from '../test/fixtures'
import { cancellationsCsv, followUpCsv, kindLabel, periodError, presetPeriod, reasonLabel, revenueCsv, serviceLabel } from './reports'

beforeAll(() => setClinicTimezone('America/Toronto'))

const lines = (csv: string) => csv.replace('\uFEFF', '').trimEnd().split('\r\n')
const SEPT = { from: '2026-09-01', to: '2026-09-30' }

describe('the period (RP-5)', () => {
  it('quick choices from the clinic’s today', () => {
    expect(presetPeriod('thisMonth', '2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(presetPeriod('lastMonth', '2026-01-14')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetPeriod('thisMonth', '2026-12-03')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(presetPeriod('thisYear', '2026-10-13')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(presetPeriod('lastYear', '2026-10-13')).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('refused as the database refuses it', () => {
    expect(periodError(SEPT)).toBeNull()
    expect(periodError({ from: '2024-01-01', to: '2024-12-31' })).toBeNull()
    expect(periodError({ from: '2026-09-30', to: '2026-09-01' })).toBe(t('modules.reports.period.invalid'))
    expect(periodError({ from: '', to: '2026-09-01' })).toBe(t('modules.reports.period.invalid'))
    expect(periodError({ from: '2025-01-01', to: '2026-01-03' })).toBe(t('modules.reports.period.tooLong'))
  })
})

describe('labels', () => {
  it('a service, else its line type; a reason; a kind', () => {
    expect(serviceLabel({ service_code: 10150, service_name: 'Consultation', line_type: null })).toBe('10150 · Consultation')
    expect(serviceLabel({ service_code: null, service_name: null, line_type: 'adjustment' })).toBe('Ajustement')
    expect(reasonLabel({ kind: 'absent', reason_name: null })).toBe('Absence')
    expect(kindLabel({ kind: 'cancelled', late: true })).toBe('Annulé à moins de 24 h')
  })
})

describe('the CSV exports (RP-6)', () => {
  it('by invoice: its columns, the amounts with a comma, a name guarded against formulas', () => {
    const file = revenueCsv(invoiceReport, SEPT)
    expect(file.fileName).toBe('revenus-par-facture-2026-09-01-au-2026-09-30.csv')
    const [header, row] = lines(file.content)
    expect(header).toBe('Date;Facture;N° de dossier;Client;Payeur;Professionnel;Sous-total;TPS;TVQ;Total;Payé;Solde')
    expect(row).toBe("2026-09-05;2026-1;12;'=Alice Essai;;Pro Un;175,00;0,00;0,00;175,00;100,00;75,00")
  })

  it('by service and by payment', () => {
    expect(lines(revenueCsv(serviceReport, SEPT).content)[1]).toBe(
      '2026-09-05;2026-1;12;Alice Essai;Pro Un;10150;Consultation individuelle 50 min;Consultation;1;175,00;175,00;0,00;0,00;175,00',
    )
    expect(lines(revenueCsv(paymentReport, SEPT).content)[1]).toBe("2026-09-06;2026-1;12;Alice Essai;;Virement Interac;100,00;'-ref")
  })

  it('the cancellations and the clients to call back, in clinic time', () => {
    const c = lines(cancellationsCsv(cancellationsReport, SEPT).content)
    expect(c[1]).toBe('2026-09-08 10:00;12;Alice Essai;Pro Un;Consultation individuelle 50 min;Annulé à moins de 24 h;Plus requis;2026-09-08 06:00;Aucun rendez-vous après')
    expect(c[2]).toBe('2026-09-09 10:00;13;Bruno Essai;Pro Un;Consultation individuelle 50 min;Absent;;;2026-10-20 10:00')
    const f = followUpCsv(followUpReport, SEPT)
    expect(f.fileName).toBe('clients-a-relancer-2026-09-01-au-2026-09-30.csv')
    expect(lines(f.content)[1]).toBe('2026-09-08 10:00;12;Alice Essai;Annulé à moins de 24 h;Plus requis;Pro Un;Consultation individuelle 50 min;2')
  })
})
