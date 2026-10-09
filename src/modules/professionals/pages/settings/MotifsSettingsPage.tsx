import { useMemo, useState } from 'react'
import { Controller, useWatch } from 'react-hook-form'
import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { SwitchField } from '@/shared/components/SwitchField'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { StatusDot } from '@/shared/ui/status-dot'
import { usageKey } from '../../api/catalog'
import type { Motif, MotifCategory } from '../../api/parse'
import { MotifCategoriesSheet } from '../../components/settings/MotifCategoriesSheet'
import {
  ReferenceListCard,
  type ReferenceColumn,
  type ReferenceFormProps,
  type ReferenceGroup,
  type ReferenceListLabels,
} from '../../components/settings/ReferenceListCard'
import { ReferenceSettingsPage, type ReferenceSettingsData } from '../../components/settings/ReferenceSettingsPage'
import { OTHER_MOTIF_GROUP, type CatalogView } from '../../lib/catalog-view'

const M = 'modules.professionals.settings.motifs'

const VIEWS = ['byCategory', 'alphabetical'] as const
type MotifView = (typeof VIEWS)[number]
const VIEW_OPTIONS = VIEWS.map((value) => ({ value, label: t(`${M}.view.${value}`) }))

/** The category filter's « Toutes les catégories ». */
const ALL_CATEGORIES = ''

const LABELS: Partial<ReferenceListLabels> = {
  add: t(`${M}.add`),
  createTitle: t(`${M}.createTitle`),
  editTitle: t(`${M}.editTitle`),
  archiveBody: (_name, count) =>
    count === 0 ? t(`${M}.archive.bodyNone`) : count === 1 ? t(`${M}.archive.bodyOne`) : t(`${M}.archive.bodyOther`, { count: String(count) }),
}

const collator = new Intl.Collator('fr-CA', { sensitivity: 'base', numeric: true })

/** The motif's active category, or null: no category, or an archived one, shows under « Sans catégorie ». */
const activeCategory = (catalog: CatalogView, row: Motif): MotifCategory | null => {
  const category = row.categoryId === null ? undefined : catalog.byId.motifCategories.get(row.categoryId)
  return category?.isActive ? category : null
}

/** The motif's group: its active category in the categories' order, else « Sans catégorie », last. */
function motifGroup(catalog: CatalogView, row: Motif): ReferenceGroup {
  const category = activeCategory(catalog, row)
  return category
    ? { id: category.id, label: category.name, order: category.sortOrder }
    : { id: OTHER_MOTIF_GROUP, label: t('modules.professionals.otherCategory'), order: Infinity }
}

// --- Columns -------------------------------------------------------------------------------------

/**
 * « Réservé »: dot + « Professions réglementées » (as a Badge, but the words may wrap: on one line
 * the column pushed « … » out of view at 375px), or « — » (« Non réservé » to screen readers).
 */
const RESTRICTED_COLUMN: ReferenceColumn<'motifs'> = {
  id: 'restricted',
  header: t(`${M}.restricted`),
  cell: (row) =>
    row.isRestricted ? (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <StatusDot tone="info" />
        <span>{t(`${M}.restrictedCell`)}</span>
      </span>
    ) : (
      <>
        <span aria-hidden className="text-subtle">
          —
        </span>
        <span className="sr-only">{t(`${M}.notRestricted`)}</span>
      </>
    ),
}

/** « Catégorie » (A–Z only: grouped, the group says it). An archived one is marked; none reads « Sans catégorie », muted. */
function categoryColumn(catalog: CatalogView): ReferenceColumn<'motifs'> {
  const category = (row: Motif) => (row.categoryId === null ? undefined : catalog.byId.motifCategories.get(row.categoryId))
  return {
    id: 'category',
    header: t(`${M}.category`),
    cell: (row, { highlight }) => {
      const found = category(row)
      if (!found) return <span className="text-subtle">{t('modules.professionals.otherCategory')}</span>
      return highlight(found.isActive ? found.name : t(`${M}.archivedCategory`, { name: found.name }))
    },
    searchText: (row) => category(row)?.name ?? '',
    // Wide screens only (the dialog shows it): at 768px with the sidebar open, the content is
    // 458px wide and the four columns needed 511px, pushing « … » out of view.
    className: 'max-lg:hidden',
  }
}

// --- Dialog --------------------------------------------------------------------------------------

/**
 * Catégorie (« Sans catégorie » first, sent as null; active categories, plus the archived one the motif
 * already has, marked, so a rename keeps it) and the « Réservé » switch. A motif that becomes
 * restricted while professionals have it: the note says what they will need before saving.
 */
function MotifFields({ form, row, catalog, usage }: ReferenceFormProps<'motifs'> & ReferenceSettingsData) {
  const { errors } = form.formState
  const categories = catalog.motifCategories.filter((category) => category.isActive || category.id === row?.categoryId)
  const isRestricted = useWatch({ control: form.control, name: 'isRestricted' })
  const holders = row === null ? 0 : (usage.get(usageKey('motifs', row.id)) ?? 0)
  const becomesRestricted = row !== null && !row.isRestricted && isRestricted && holders > 0
  return (
    <>
      <FormField label={t(`${M}.category`)} help={t(`${M}.categoryHelp`)} error={errors.categoryId?.message}>
        {(field) => (
          <Select {...field} {...form.register('categoryId')}>
            <option value="">{t(`${M}.categoryNone`)}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.isActive ? category.name : t(`${M}.archivedCategory`, { name: category.name })}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <div>
        <Controller
          control={form.control}
          name="isRestricted"
          render={({ field, fieldState }) => (
            <SwitchField
              ref={field.ref}
              label={t(`${M}.restrictedLabel`)}
              help={t(`${M}.restrictedHelp`)}
              error={fieldState.error?.message}
              checked={field.value}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        {/* Polite: heard when the switch turns on, without moving focus. */}
        <div aria-live="polite" className="[&:not(:empty)]:mt-2">
          {becomesRestricted && (
            <Alert>
              <Info aria-hidden />
              <AlertDescription className="text-foreground">{t(`${M}.restrictedNote`)}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </>
  )
}

// --- List ----------------------------------------------------------------------------------------

/**
 * The motifs, « Par catégorie » (group rows in the categories' order, « Sans catégorie » last; reorder
 * within a group) or « Liste A–Z » (by name, with a Catégorie column; no reorder), narrowed by a
 * category (which « Ajouter » then starts with).
 */
function MotifsList(data: ReferenceSettingsData) {
  const { catalog, usage, canEdit } = data
  const [view, setView] = useState<MotifView>('byCategory')
  const [filterValue, setFilterValue] = useState(ALL_CATEGORIES)

  const activeCategories = catalog.motifCategories.filter((category) => category.isActive)
  // A category archived meanwhile (in the sheet) is no longer offered: back to every category.
  const filter = filterValue === OTHER_MOTIF_GROUP || activeCategories.some((c) => c.id === filterValue) ? filterValue : ALL_CATEGORIES

  const alphabetical = view === 'alphabetical'
  const rows = useMemo(
    () => (alphabetical ? [...catalog.motifs].sort((a, b) => collator.compare(a.name, b.name)) : catalog.motifs),
    [alphabetical, catalog.motifs],
  )
  const columns = useMemo(() => (alphabetical ? [categoryColumn(catalog), RESTRICTED_COLUMN] : [RESTRICTED_COLUMN]), [alphabetical, catalog])

  const toolbar = (
    <>
      <SegmentedToggle label={t(`${M}.view.label`)} options={VIEW_OPTIONS} value={view} onChange={setView} />
      <Select
        aria-label={t(`${M}.categoryFilter.label`)}
        value={filter}
        onChange={(event) => setFilterValue(event.target.value)}
        className="w-full sm:w-[220px]"
      >
        <option value={ALL_CATEGORIES}>{t(`${M}.categoryFilter.all`)}</option>
        {activeCategories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
        <option value={OTHER_MOTIF_GROUP}>{t('modules.professionals.otherCategory')}</option>
      </Select>
    </>
  )

  return (
    <ReferenceListCard
      kind="motifs"
      title={t(`${M}.title`)}
      headingHidden
      rows={rows}
      usage={usage}
      columns={columns}
      renderForm={(props) => <MotifFields {...props} {...data} />}
      createDefaults={filter === ALL_CATEGORIES ? undefined : { categoryId: filter === OTHER_MOTIF_GROUP ? '' : filter }}
      toolbar={toolbar}
      filterRow={filter === ALL_CATEGORIES ? undefined : (row) => motifGroup(catalog, row).id === filter}
      groupBy={alphabetical ? undefined : (row) => motifGroup(catalog, row)}
      reorderable={!alphabetical}
      canEdit={canEdit}
      labels={LABELS}
    />
  )
}

// --- Page ----------------------------------------------------------------------------------------

/**
 * Paramètres → Motifs: what people come for, as orientation tags (never a diagnosis; P4-51). One
 * list, so « Ajouter un motif » is the page's teal button; « Gérer les catégories » (outline, in
 * the header) opens the categories in a sheet. A motif « Réservé aux professions réglementées »
 * can be chosen only by a professional with a title from an order (P4-16, `set_professional_motifs`).
 */
export function MotifsSettingsPage() {
  return (
    <ReferenceSettingsPage
      title={t(`${M}.title`)}
      description={t(`${M}.description`)}
      actions={({ catalog, usage, canEdit }) => <MotifCategoriesSheet rows={catalog.motifCategories} usage={usage} canEdit={canEdit} />}
    >
      {(data) => <MotifsList {...data} />}
    </ReferenceSettingsPage>
  )
}
