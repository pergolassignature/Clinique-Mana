import { useId } from 'react'
import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/sheet'
import { Textarea } from '@/shared/ui/textarea'
import type { MotifCategory } from '../../api/parse'
import type { MotifCategoryIcon } from '../../lib/constants'
import { motifIconLabel } from '../../lib/display'
import { CategoryIcon } from '../CategoryIcon'
import { IconPicker } from './IconPicker'
import { ReferenceListCard, type ReferenceColumn, type ReferenceFormProps, type ReferenceListLabels } from './ReferenceListCard'

const C = 'modules.professionals.settings.motifs.categories'

const motifCount = (count: number) => (count === 1 ? t(`${C}.motifCount.one`) : t(`${C}.motifCount.other`, { count: String(count) }))

/** « Utilisé par » counts a category's active motifs; archiving one sends them under « Sans catégorie » until it is restored. */
const LABELS: Partial<ReferenceListLabels> = {
  add: t(`${C}.add`),
  createTitle: t(`${C}.createTitle`),
  editTitle: t(`${C}.editTitle`),
  usage: motifCount,
  usageNone: t(`${C}.motifCount.none`),
  archiveBody: (_name, count) =>
    count === 0 ? t(`${C}.archive.bodyNone`) : count === 1 ? t(`${C}.archive.bodyOne`) : t(`${C}.archive.bodyOther`, { count: String(count) }),
}

const COLUMNS: ReferenceColumn<'motif_categories'>[] = [
  {
    id: 'icon',
    header: t(`${C}.icon`),
    cell: (row) => (
      <span role="img" aria-label={motifIconLabel(row.icon)} className="inline-flex text-muted-foreground">
        <CategoryIcon icon={row.icon} className="size-4" />
      </span>
    ),
  },
  {
    id: 'description',
    header: t(`${C}.descriptionLabel`),
    cell: (row, { highlight }) =>
      row.description ? (
        <span className="text-muted-foreground">{highlight(row.description)}</span>
      ) : (
        <>
          <span aria-hidden className="text-subtle">
            —
          </span>
          <span className="sr-only">{t(`${C}.noDescription`)}</span>
        </>
      ),
    searchText: (row) => row.description ?? '',
    // Secondary at phone width: the dialog shows it, and the row keeps room for its actions.
    className: 'max-sm:hidden',
  },
]

/** Description (optional) and Icône: the picker changes the draft only, saved with « Enregistrer ». */
function CategoryFields({ form }: ReferenceFormProps<'motif_categories'>) {
  const { errors } = form.formState
  const iconLabelId = useId()
  const iconErrorId = useId()
  return (
    <>
      <FormField label={t(`${C}.descriptionLabel`)} help={t(`${C}.descriptionHelp`)} error={errors.description?.message}>
        {(field) => <Textarea {...field} {...form.register('description')} rows={2} maxLength={300} className="min-h-16" />}
      </FormField>
      <div className="space-y-1">
        <p id={iconLabelId} className="text-sm font-medium text-foreground">
          {t(`${C}.icon`)}
        </p>
        <Controller
          control={form.control}
          name="icon"
          render={({ field, fieldState }) => (
            <>
              <IconPicker
                ref={field.ref}
                labelledBy={iconLabelId}
                describedBy={fieldState.error ? iconErrorId : undefined}
                // The schema keeps the value one of the 20 icons.
                value={field.value as MotifCategoryIcon}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
              {fieldState.error && (
                <p id={iconErrorId} className="text-xs text-destructive">
                  {fieldState.error.message}
                </p>
              )}
            </>
          )}
        />
      </div>
    </>
  )
}

interface MotifCategoriesSheetProps {
  /** The catalogue's categories, archived ones included, in their order. */
  rows: readonly MotifCategory[]
  usage: ReadonlyMap<string, number>
  canEdit: boolean
}

/**
 * « Gérer les catégories » (« Voir les catégories » read-only) and its sheet: the motif categories
 * as a `ReferenceListCard` (reorderable: the order of the groups on the Motifs page and in the
 * record's motif picker), with their icon and description. The categories group motifs on screen
 * only. X out of the tab order (Sheet); Escape closes; focus returns to the button.
 */
export function MotifCategoriesSheet({ rows, usage, canEdit }: MotifCategoriesSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          {t(canEdit ? 'modules.professionals.settings.motifs.manageCategories' : 'modules.professionals.settings.motifs.viewCategories')}
        </Button>
      </SheetTrigger>
      {/* Wider than the default 480px: with « Monter / Descendre » (from md), the five columns
          need 519px, and « … » left the view in 485. */}
      <SheetContent className="sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{t(`${C}.title`)}</SheetTitle>
          <SheetDescription>{t(`${C}.description`)}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <ReferenceListCard
            kind="motif_categories"
            title={t(`${C}.title`)}
            headingHidden
            rows={rows}
            usage={usage}
            columns={COLUMNS}
            renderForm={(props) => <CategoryFields {...props} />}
            reorderable
            canEdit={canEdit}
            // The page under the sheet already has its teal « Ajouter un motif ».
            addVariant="outline"
            labels={LABELS}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
