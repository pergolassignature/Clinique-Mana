import { useWatch } from 'react-hook-form'
import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { ProfessionalOrder, ProfessionCategory, ProfessionTitle } from '../../api/parse'
import {
  ReferenceListCard,
  type ReferenceColumn,
  type ReferenceFormProps,
  type ReferenceListLabels,
} from '../../components/settings/ReferenceListCard'
import { ReferenceSettingsPage } from '../../components/settings/ReferenceSettingsPage'
import type { CatalogView } from '../../lib/catalog-view'

const P = 'modules.professionals.settings.professions'

// --- Parents (orders, categories): « Utilisé par » counts their active titles -------------------

const titleCount = (count: number) => (count === 1 ? t(`${P}.titleCount.one`) : t(`${P}.titleCount.other`, { count: String(count) }))

/** An order or a category is archived only once none of its titles is active (the RPC refuses otherwise). */
const PARENT_LABELS = {
  orders: {
    add: t(`${P}.orders.add`),
    createTitle: t(`${P}.orders.createTitle`),
    editTitle: t(`${P}.orders.editTitle`),
    usage: titleCount,
    usageNone: t(`${P}.titleCount.none`),
    archiveBody: (_name, count) =>
      count === 0
        ? t(`${P}.orders.archive.bodyNone`)
        : count === 1
          ? t(`${P}.orders.archive.bodyOne`)
          : t(`${P}.orders.archive.bodyOther`, { count: String(count) }),
  },
  categories: {
    add: t(`${P}.categories.add`),
    createTitle: t(`${P}.categories.createTitle`),
    editTitle: t(`${P}.categories.editTitle`),
    usage: titleCount,
    usageNone: t(`${P}.titleCount.none`),
    archiveBody: (_name, count) =>
      count === 0
        ? t(`${P}.categories.archive.bodyNone`)
        : count === 1
          ? t(`${P}.categories.archive.bodyOne`)
          : t(`${P}.categories.archive.bodyOther`, { count: String(count) }),
  },
} satisfies Record<string, Partial<ReferenceListLabels>>

const TITLE_LABELS: Partial<ReferenceListLabels> = {
  add: t(`${P}.titles.add`),
  createTitle: t(`${P}.titles.createTitle`),
  editTitle: t(`${P}.titles.editTitle`),
  archiveBody: (_name, count) =>
    count === 0
      ? t(`${P}.titles.archive.bodyNone`)
      : count === 1
        ? t(`${P}.titles.archive.bodyOne`)
        : t(`${P}.titles.archive.bodyOther`, { count: String(count) }),
}

// --- Ordres professionnels -----------------------------------------------------------------------

const ORDER_COLUMNS: ReferenceColumn<'professional_orders'>[] = [
  { id: 'acronym', header: t(`${P}.orders.acronym`), cell: (row, { highlight }) => highlight(row.acronym), searchText: (row) => row.acronym },
  // Secondary at phone width: the dialog shows it, and the row keeps room for its actions.
  { id: 'licence-label', header: t(`${P}.orders.licenceLabel`), cell: (row) => row.licenceLabel, className: 'max-sm:hidden' },
]

/** « Libellé du permis » starts filled: the database would store this one for an empty label anyway. */
const ORDER_DEFAULTS = { licenceLabel: t(`${P}.orders.licenceLabelDefault`) }

/** Upper-cases an input as it is typed, keeping the caret where it was. */
function upperCaseInPlace(input: HTMLInputElement) {
  const upper = input.value.toUpperCase()
  if (upper === input.value) return
  const { selectionStart, selectionEnd } = input
  input.value = upper
  input.setSelectionRange(selectionStart, selectionEnd)
}

/** Sigle (upper-cased as typed), « Libellé du permis », « Format du permis » (checked like the database reads it). */
function OrderFields({ form }: ReferenceFormProps<'professional_orders'>) {
  const { errors } = form.formState
  const acronym = form.register('acronym')
  return (
    <>
      <FormField label={t(`${P}.orders.acronym`)} required help={t(`${P}.orders.acronymHelp`)} error={errors.acronym?.message}>
        {(field) => (
          <Input
            {...field}
            {...acronym}
            onChange={(event) => {
              upperCaseInPlace(event.target)
              void acronym.onChange(event)
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={10}
            className="max-w-[160px]"
          />
        )}
      </FormField>
      <FormField label={t(`${P}.orders.licenceLabel`)} help={t(`${P}.orders.licenceLabelHelp`)} error={errors.licenceLabel?.message}>
        {(field) => <Input {...field} {...form.register('licenceLabel')} autoComplete="off" maxLength={60} />}
      </FormField>
      <FormField label={t(`${P}.orders.licencePattern`)} help={t(`${P}.orders.licencePatternHelp`)} error={errors.licencePattern?.message}>
        {(field) => (
          <Input
            {...field}
            {...form.register('licencePattern')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={200}
            className="font-mono text-xs"
          />
        )}
      </FormField>
    </>
  )
}

// --- Titres --------------------------------------------------------------------------------------

/** A category as a title shows it: « (archivée) » when it is. */
const categoryText = (category: ProfessionCategory) => (category.isActive ? category.name : t(`${P}.titles.archivedCategory`, { name: category.name }))
/** An order in the title's row: its acronym, « (archivé) » when it is. */
const orderCellText = (order: ProfessionalOrder) => (order.isActive ? order.acronym : t(`${P}.titles.archivedOrder`, { name: order.acronym }))
/** An order in the title dialog: its name and acronym, « (archivé) » when it is. */
const orderOptionText = (order: ProfessionalOrder) => {
  const text = t(`${P}.titles.orderOption`, { name: order.name, acronym: order.acronym })
  return order.isActive ? text : t(`${P}.titles.archivedOrder`, { name: text })
}

function titleColumns(catalog: CatalogView): ReferenceColumn<'profession_titles'>[] {
  const category = (row: ProfessionTitle) => catalog.byId.categories.get(row.categoryId)
  const order = (row: ProfessionTitle) => (row.orderId === null ? undefined : catalog.byId.orders.get(row.orderId))
  return [
    {
      id: 'category',
      header: t(`${P}.titles.category`),
      cell: (row, { highlight }) => {
        const found = category(row)
        return found ? highlight(categoryText(found)) : null
      },
      searchText: (row) => category(row)?.name ?? '',
      // Secondary at phone width (the dialog shows it): the order, short, stays with the actions.
      className: 'max-sm:hidden',
    },
    {
      id: 'order',
      header: t(`${P}.titles.order`),
      cell: (row, { highlight }) => {
        const found = order(row)
        if (found) return highlight(orderCellText(found))
        return (
          <>
            <span aria-hidden className="text-subtle">
              —
            </span>
            <span className="sr-only">{t(`${P}.titles.noOrderLabel`)}</span>
          </>
        )
      },
      searchText: (row) => {
        const found = order(row)
        return found ? `${found.acronym} ${found.name}` : ''
      },
    },
  ]
}

/**
 * Catégorie* and Ordre (« Aucun ordre » first, sent as null). Only active rows are offered; the
 * archived category or order a title already has stays shown, marked, so saving a rename keeps it
 * (the RPC accepts a row keeping its archived parent). A title that gains an order makes its
 * professionals' licence number required: the note says so before saving.
 */
function TitleFields({ form, row, catalog }: ReferenceFormProps<'profession_titles'> & { catalog: CatalogView }) {
  const { errors } = form.formState
  const categories = catalog.categories.filter((category) => category.isActive || category.id === row?.categoryId)
  const orders = catalog.orders.filter((order) => order.isActive || order.id === row?.orderId)
  const orderId = useWatch({ control: form.control, name: 'orderId' })
  const gainsOrder = row !== null && row.orderId === null && orderId !== ''
  return (
    <>
      <FormField label={t(`${P}.titles.category`)} required error={errors.categoryId?.message}>
        {(field) => (
          <Select {...field} {...form.register('categoryId')} placeholder={t(`${P}.titles.categoryPlaceholder`)}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryText(category)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <div>
        <FormField label={t(`${P}.titles.order`)} help={t(`${P}.titles.orderHelp`)} error={errors.orderId?.message}>
          {(field) => (
            <Select {...field} {...form.register('orderId')}>
              <option value="">{t(`${P}.titles.noOrder`)}</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {orderOptionText(order)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {/* Polite: heard when the order changes, without moving focus. */}
        <div aria-live="polite" className="[&:not(:empty)]:mt-2">
          {gainsOrder && (
            <Alert>
              <Info aria-hidden />
              <AlertDescription className="text-foreground">{t(`${P}.titles.licenceNote`)}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </>
  )
}

// --- Page ----------------------------------------------------------------------------------------

/**
 * Paramètres → Professions et ordres: three lists on one page (each « Ajouter » outline, so the
 * page has no teal button at rest).
 * - Ordres professionnels: sigle, « Libellé du permis » (the licence number's name on a record),
 *   « Format du permis ». « Utilisé par » counts their active titles.
 * - Catégories: name only (Services et tarifs prices by category); same count.
 * - Titres: their category and order (« — » without one: no licence required); « Utilisé par »
 *   counts professionals.
 * The database refuses archiving a parent with active titles, and restoring a title before its
 * category and order: the confirmation shows its message.
 */
export function ProfessionsSettingsPage() {
  return (
    <ReferenceSettingsPage title={t(`${P}.title`)} description={t(`${P}.description`)}>
      {({ catalog, usage, canEdit }) => (
        <>
          <ReferenceListCard
            kind="professional_orders"
            title={t(`${P}.orders.title`)}
            description={t(`${P}.orders.description`)}
            rows={catalog.orders}
            usage={usage}
            columns={ORDER_COLUMNS}
            renderForm={(props) => <OrderFields {...props} />}
            createDefaults={ORDER_DEFAULTS}
            canEdit={canEdit}
            addVariant="outline"
            labels={PARENT_LABELS.orders}
          />
          <ReferenceListCard
            kind="profession_categories"
            title={t(`${P}.categories.title`)}
            description={t(`${P}.categories.description`)}
            rows={catalog.categories}
            usage={usage}
            canEdit={canEdit}
            addVariant="outline"
            labels={PARENT_LABELS.categories}
          />
          <ReferenceListCard
            kind="profession_titles"
            title={t(`${P}.titles.title`)}
            description={t(`${P}.titles.description`)}
            rows={catalog.titles}
            usage={usage}
            columns={titleColumns(catalog)}
            renderForm={(props) => <TitleFields {...props} catalog={catalog} />}
            canEdit={canEdit}
            addVariant="outline"
            labels={TITLE_LABELS}
          />
        </>
      )}
    </ReferenceSettingsPage>
  )
}
