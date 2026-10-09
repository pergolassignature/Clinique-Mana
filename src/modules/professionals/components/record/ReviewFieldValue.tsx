import type { ReactNode } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import { t } from '@/i18n'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { formatClinicDateShort, formatDateOnly } from '@/shared/lib/timezone'
import type { CatalogView } from '../../lib/catalog-view'
import { clienteleLabel, professionLine } from '../../lib/display'
import type { Gender, SubmissionField } from '../../lib/constants'
import { summarizeMotifs } from '../../lib/motif-summary'
import { clienteleDiff, clienteleRefs, idList, idsDiff, isLongText, plainValueText, type SetField } from '../../lib/submission-review'
import { submittedProfessions } from '../../schemas/questionnaire'
import { useImageRetry } from '../use-image-retry'
import { CategoryNames, Disclosure, type NamedGroup } from './MotifsSummary'

const V = 'modules.professionals.submission.values'

/** How the record's ids are named: the cached catalogue, and the professional's gender for the titles (P4-342). */
export interface ValueContext {
  catalog: CatalogView
  gender: Gender | null
}

const NotIndicated = () => <span className="text-muted-foreground">{t(`${V}.notIndicated`)}</span>

const text = (value: unknown, key: string): string | null => {
  const v = (value as Record<string, unknown> | null)?.[key]
  return typeof v === 'string' && v !== '' ? v : null
}

/** The titles as lines: « Psychologue · OPQ 12345 (principal) ». */
function ProfessionsValue({ value, ctx }: { value: unknown; ctx: ValueContext }) {
  const rows = submittedProfessions({ professions: value })
  if (rows.length === 0) return <NotIndicated />
  return (
    <ul>
      {rows.map((p) => (
        <li key={p.title_id}>
          {professionLine({ titleId: p.title_id, licenceNumber: p.licence_number }, ctx.catalog, ctx.gender) || t(`${V}.unknown`)}
          {rows.length > 1 && p.is_primary && <span className="text-muted-foreground"> {t(`${V}.primary`)}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * The consent, in words, as the Documents tab says it (P4-505): « Signé électroniquement le …
 * (Documenso). » for a signature through Documenso, « Consentement papier au dossier, téléversé le
 * … » for a paper one; no end date (P4-504). Nothing: « Aucun consentement au dossier. » on the
 * record, « Pas encore signé. » in the answer.
 */
function ConsentValue({ value, side }: { value: unknown; side: 'current' | 'submitted' }) {
  const source = text(value, 'source')
  const signedAt = text(value, 'signed_at')
  const uploadedAt = text(value, 'uploaded_at')
  if (source === 'signature' && signedAt) return <>{t(`${V}.consentSignedElectronically`, { date: formatClinicDateShort(signedAt) })}</>
  if (source === 'document' && uploadedAt) return <>{t(`${V}.consentPaper`, { date: formatClinicDateShort(uploadedAt) })}</>
  return <span className="text-muted-foreground">{t(side === 'current' ? `${V}.consentNone` : `${V}.consentUnsigned`)}</span>
}

/** One side (« Actuel » or « Proposé ») of a plain field, the titles or the consent. */
export function SideValue({ field, value, side, ctx }: { field: SubmissionField; value: unknown; side: 'current' | 'submitted'; ctx: ValueContext }) {
  if (field === 'professions') return <ProfessionsValue value={value} ctx={ctx} />
  if (field === 'consent') return <ConsentValue value={value} side={side} />
  const words = plainValueText(field, value)
  if (words === null) return <NotIndicated />
  return isLongText(field) ? <span className="whitespace-pre-line">{words}</span> : <>{words}</>
}

// --- Sets: added and removed, by name ------------------------------------------------------------


/** Motifs by category (P4-249), as the record names them; the count beside a category is left out. */
function motifGroups(ids: readonly string[], catalog: CatalogView): NamedGroup[] {
  return summarizeMotifs(ids, catalog).groups.map((g) => ({ key: g.key, name: g.name, icon: g.icon, items: g.motifs }))
}

/** A flat list of names (languages, clientèles) as one unnamed group, archived ones marked. */
function namedList(ids: readonly string[], name: (id: string) => { name: string; archived: boolean }): NamedGroup[] {
  return ids.length === 0 ? [] : [{ key: 'items', name: null, items: ids.map((id) => ({ id, ...name(id) })) }]
}

function SetPart({ title, groups }: { title: string; groups: NamedGroup[] }) {
  if (groups.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <CategoryNames groups={groups} />
    </div>
  )
}

/**
 * A set's change in names, never ids or counts alone: « Ajoutés (2) », « Retirés (1) », the ★
 * changes of the clientèles kept, and the ones kept folded (« Inchangés (12) »).
 */
export function SetChange({ field, current, submitted, ctx }: { field: SetField; current: unknown; submitted: unknown; ctx: ValueContext }) {
  const { catalog } = ctx
  const unknown = { name: t(`${V}.unknown`), archived: false }
  const language = (id: string) => {
    const row = catalog.byId.languages.get(id)
    return row ? { name: row.name, archived: !row.isActive } : unknown
  }
  const clientele = (specialized: ReadonlySet<string>) => (id: string) => {
    const row = catalog.byId.clienteles.get(id)
    if (!row) return unknown
    const name = clienteleLabel(row)
    return { name: specialized.has(id) ? `${name} ${t(`${V}.specialized`)}` : name, archived: !row.isActive }
  }
  let parts: { key: string; title: string; groups: NamedGroup[] }[]
  let kept: NamedGroup[]
  if (field === 'motif_ids') {
    const diff = idsDiff(current, submitted)
    parts = [
      { key: 'added', title: t(`${V}.added`, { count: String(diff.added.length) }), groups: motifGroups(diff.added, catalog) },
      { key: 'removed', title: t(`${V}.removed`, { count: String(diff.removed.length) }), groups: motifGroups(diff.removed, catalog) },
    ]
    kept = motifGroups(diff.kept, catalog)
  } else if (field === 'language_ids') {
    const diff = idsDiff(current, submitted)
    parts = [
      { key: 'added', title: t(`${V}.added`, { count: String(diff.added.length) }), groups: namedList(diff.added, language) },
      { key: 'removed', title: t(`${V}.removed`, { count: String(diff.removed.length) }), groups: namedList(diff.removed, language) },
    ]
    kept = namedList(diff.kept, language)
  } else {
    const diff = clienteleDiff(current, submitted)
    const plainName = clientele(new Set())
    parts = [
      { key: 'added', title: t(`${V}.added`, { count: String(diff.added.length) }), groups: namedList(diff.added, clientele(diff.specialized)) },
      { key: 'removed', title: t(`${V}.removed`, { count: String(diff.removed.length) }), groups: namedList(diff.removed, plainName) },
      { key: 'starred', title: t(`${V}.starred`), groups: namedList(diff.starred, plainName) },
      { key: 'unstarred', title: t(`${V}.unstarred`), groups: namedList(diff.unstarred, plainName) },
    ]
    kept = namedList(diff.kept, clientele(diff.specialized))
  }
  const keptCount = kept.reduce((n, g) => n + g.items.length, 0)
  return (
    <div className="space-y-3">
      {parts.map((part) => (
        <SetPart key={part.key} title={part.title} groups={part.groups} />
      ))}
      {keptCount > 0 && (
        <Disclosure label={<span className="text-xs text-muted-foreground">{t(`${V}.kept`, { count: String(keptCount) })}</span>}>
          <CategoryNames groups={kept} />
        </Disclosure>
      )}
    </div>
  )
}

/** A set's value on its own (an unchanged field): every name, the motifs by category. */
export function SetValue({ field, value, ctx }: { field: SetField; value: unknown; ctx: ValueContext }) {
  const { catalog } = ctx
  if (field === 'motif_ids') {
    const groups = motifGroups(idList(value), catalog)
    return groups.length === 0 ? <NotIndicated /> : <CategoryNames groups={groups} />
  }
  const names =
    field === 'clienteles'
      ? clienteleRefs(value).map(({ id, specialized }) => {
          const row = catalog.byId.clienteles.get(id)
          const name = row ? clienteleLabel(row) : t(`${V}.unknown`)
          return specialized ? `${name} ${t(`${V}.specialized`)}` : name
        })
      : idList(value).map((id) => catalog.byId.languages.get(id)?.name ?? t(`${V}.unknown`))
  return names.length === 0 ? <NotIndicated /> : <>{names.join(' · ')}</>
}

// --- Files ---------------------------------------------------------------------------------------

/**
 * The staged photo or insurance (readable by `professionals.review`, P4-177): the photo shown, the
 * insurance with its expiry (a date-only value) and « Ouvrir le fichier ». The record holds no
 * file before 4c, so there is nothing to put beside it.
 */
export function FileProposal({ field, value }: { field: 'photo' | 'insurance'; value: unknown }) {
  const fileId = text(value, 'file_id')
  const preview = useSignedFileUrl(fileId, { refresh: field === 'insurance' })
  const image = useImageRetry(fileId, preview.data?.url, preview.refetch)
  if (!fileId) return <NotIndicated />
  if (field === 'photo') {
    return (
      <div className="flex items-center gap-3">
        {preview.data && !image.dead ? (
          <img src={preview.data.url} alt={t(`${V}.photoAlt`)} onError={image.onError} className="size-16 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <div aria-hidden className="size-16 shrink-0 rounded-full bg-muted" />
        )}
        <p>{preview.isError || image.dead ? t(`${V}.fileUnavailable`) : t(`${V}.photoSent`)}</p>
      </div>
    )
  }
  const expiry = text(value, 'expires_on')
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <FileText aria-hidden className="size-4 shrink-0 text-subtle" />
      <span>{expiry ? t(`${V}.insuranceSent`, { date: formatDateOnly(expiry) }) : t(`${V}.insuranceSentUndated`)}</span>
      {preview.data && (
        <a href={preview.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link underline-offset-2 hover:underline">
          {t(`${V}.openFile`)}
          <ExternalLink aria-hidden className="size-3.5 shrink-0" />
          {/* The link opens a new tab: said to screen readers, shown by the icon. */}
          <span className="sr-only"> {t(`${V}.newTab`)}</span>
        </a>
      )}
      {preview.isError && <span className="text-muted-foreground">{t(`${V}.fileUnavailable`)}</span>}
    </div>
  )
}

/** Two labelled columns from `sm`, one under the other on a phone. */
export function SideBySide({ current, submitted }: { current: ReactNode; submitted: ReactNode }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{t(`${V}.current`)}</dt>
        <dd className="mt-0.5 break-words text-sm text-foreground">{current}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-foreground">{t(`${V}.proposed`)}</dt>
        <dd className="mt-0.5 break-words text-sm text-foreground">{submitted}</dd>
      </div>
    </dl>
  )
}
