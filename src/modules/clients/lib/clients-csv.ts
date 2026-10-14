import { t } from '@/i18n'
import { buildCsv, type CsvCell } from '@/shared/lib/csv'
import type { ClientListRow } from '../api/parse'
import { clientNumberLabel, phoneLabel, rateVariantLabel } from './display'

const L = 'modules.clients.list'
const C = `${L}.csv`

/**
 * The clients list as a CSV (parity audit L7): the files the list's filters select, with what the
 * list shows (number, names, birthday, contact, primary professional, indications, tags, state).
 * Never a note, an address or a health detail.
 */
export function clientsCsv(
  rows: readonly ClientListRow[],
  names: { professionals?: readonly { id: string; name: string }[]; tags?: readonly { id: string; name: string }[] },
  today: string,
): { fileName: string; content: string } {
  const pro = (id: string | null) => (id ? (names.professionals?.find((p) => p.id === id)?.name ?? '') : '')
  const tag = (id: string) => names.tags?.find((x) => x.id === id)?.name
  const header = [
    t(`${C}.number`),
    t(`${C}.lastName`),
    t(`${C}.firstName`),
    t(`${C}.birthday`),
    t(`${C}.email`),
    t(`${C}.mobile`),
    t(`${C}.professional`),
    t(`${C}.flags`),
    t(`${C}.tags`),
    t(`${C}.state`),
  ]
  const body: CsvCell[][] = rows.map((r) => [
    clientNumberLabel(r.clientNumber),
    r.lastName,
    r.firstName,
    r.birthday,
    r.email,
    r.mobile ? phoneLabel(r.mobile) : null,
    pro(r.primaryProfessionalId),
    [
      r.isBanned && t(`${L}.flags.banned`),
      r.fileIncomplete && t(`${L}.flags.incomplete`),
      r.specialAgreement && t(`${L}.flags.agreement`),
      r.taxExempt && t(`${L}.flags.taxExempt`),
      r.rateVariant && rateVariantLabel(r.rateVariant),
    ]
      .filter(Boolean)
      .join(', '),
    r.tagIds
      .map(tag)
      .filter((n): n is string => Boolean(n))
      .join(', '),
    r.isArchived ? t(`${C}.archived`) : t(`${C}.active`),
  ])
  return { fileName: t(`${C}.fileName`, { date: today }), content: buildCsv(header, body) }
}
