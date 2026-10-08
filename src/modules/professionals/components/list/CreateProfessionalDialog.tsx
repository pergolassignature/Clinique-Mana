import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, Plus } from 'lucide-react'
import { t } from '@/i18n'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { NewProfessional } from '../../api/record'
import { useProfessionalsCatalog } from '../../hooks/use-catalog'
import { professionalCatalogKeys } from '../../hooks/keys'
import { useCreateProfessional } from '../../hooks/use-professional-mutations'
import { titleOrder, type CatalogView } from '../../lib/catalog-view'
import { recordPath } from '../../lib/constants'
import { CREATE_PROFESSIONAL_DEFAULTS, createErrorField, createProfessionalSchema, type CreateProfessionalValues } from '../../schemas/create'

const C = 'modules.professionals.create'

/**
 * « + Ajouter » (professionals.manage, the page's one teal action) and « Ajouter un professionnel »
 * (design §5.2, P4-35): Prénom, Nom, Courriel, Profession (active titles), and « N° de permis »
 * (the order's own label) when the title belongs to an order. Created as « À inviter »; then the
 * record opens. While creating, the dialog stays open; a refusal shows under the field its HINT
 * names, when that field is on screen, else above the buttons.
 */
export function CreateProfessionalDialog() {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const firstName = useRef<HTMLInputElement | null>(null)

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('modules.professionals.list.add')}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          if (!firstName.current) return
          event.preventDefault()
          firstName.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${C}.heading`)}</DialogTitle>
          <DialogDescription>{t(`${C}.description`)}</DialogDescription>
        </DialogHeader>
        <CreateForm firstNameRef={firstName} onPendingChange={setPending} onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

interface CreateFormProps {
  firstNameRef: RefObject<HTMLInputElement | null>
  onPendingChange: (pending: boolean) => void
  onCreated: () => void
}

/** The titles come from the cached catalogue (the list page has it already). */
function CreateForm(props: CreateFormProps) {
  const catalog = useProfessionalsCatalog()
  if (catalog.data) return <CreateFormFields {...props} catalog={catalog.data} />
  if (catalog.isError) {
    return <LoadError message={t(`${C}.catalogError`)} onRetry={() => void catalog.refetch()} retrying={catalog.isFetching} />
  }
  return <Loading />
}

function CreateFormFields({ catalog, firstNameRef, onPendingChange, onCreated }: CreateFormProps & { catalog: CatalogView }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const schema = useMemo(() => createProfessionalSchema(catalog), [catalog])
  const form = useForm<CreateProfessionalValues, unknown, NewProfessional>({ resolver: zodResolver(schema), defaultValues: CREATE_PROFESSIONAL_DEFAULTS })
  const { errors, isDirty } = form.formState
  const create = useCreateProfessional({
    onErrorMessage: (message, error) => {
      const field = createErrorField(error)
      if (field === 'licenceNumber' && !titleOrder(catalog, form.getValues('titleId') || null)) {
        // The title gained an order since the catalogue was read: no licence field to put it under.
        // The refetched catalogue brings the field.
        form.setError('root.server', { message: t(`${C}.licenceNowRequired`) })
        void queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.catalog() })
      } else if (field) {
        form.setError(field, { message }, { shouldFocus: true })
        // « Ce titre est archivé. »: the refetched catalogue stops offering it.
        if (field === 'titleId') void queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.catalog() })
      } else {
        form.setError('root.server', { message })
      }
    },
  })
  const titleId = useWatch({ control: form.control, name: 'titleId' })
  const order = titleOrder(catalog, titleId || null)
  const titles = catalog.titles.filter((title) => title.isActive)
  const { ref: registerFirstName, ...firstNameField } = form.register('firstName')
  // When the titles arrive after the dialog opened, Prénom still gets the focus.
  useEffect(() => firstNameRef.current?.focus(), [firstNameRef])

  const submit = form.handleSubmit(async (values) => {
    onPendingChange(true)
    try {
      const id = await create.mutateAsync(values)
      onCreated()
      navigate(recordPath(id))
    } catch {
      // Shown under its field or above the buttons (onErrorMessage).
    } finally {
      onPendingChange(false)
    }
  })

  const pending = create.isPending
  const alert = errors.root?.server?.message
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-3.5" aria-busy={pending || undefined}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <FormField label={t(`${C}.firstName`)} required error={errors.firstName?.message}>
          {(field) => (
            <Input
              {...field}
              {...firstNameField}
              ref={(element) => {
                registerFirstName(element)
                firstNameRef.current = element
              }}
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField label={t(`${C}.lastName`)} required error={errors.lastName?.message}>
          {(field) => <Input {...field} {...form.register('lastName')} autoComplete="off" />}
        </FormField>
      </div>
      <FormField label={t(`${C}.email`)} required help={t(`${C}.emailHelp`)} error={errors.email?.message}>
        {(field) => <Input {...field} {...form.register('email')} type="email" autoComplete="off" />}
      </FormField>
      <FormField label={t(`${C}.profession`)} error={errors.titleId?.message}>
        {(field) => (
          <Select
            {...field}
            {...form.register('titleId', {
              // The licence field goes with a title that needs none: nothing hidden is sent.
              onChange: (event: { target: { value: string } }) => {
                if (!titleOrder(catalog, event.target.value || null)) form.setValue('licenceNumber', '')
                form.clearErrors('licenceNumber')
              },
            })}
          >
            <option value="">{t(`${C}.professionNone`)}</option>
            {titles.map((title) => (
              <option key={title.id} value={title.id}>
                {title.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {order && (
        <FormField label={order.licenceLabel} required help={t(`${C}.licenceHelp`, { order: order.acronym })} error={errors.licenceNumber?.message}>
          {(field) => <Input {...field} {...form.register('licenceNumber')} autoComplete="off" className="tabular" />}
        </FormField>
      )}
      {alert && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{alert}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <SaveButton
          pending={pending}
          disabled={!isDirty}
          variant={isDirty || pending ? 'default' : 'outline'}
          label={t(`${C}.submit`)}
          pendingLabel={t(`${C}.submitting`)}
        />
      </DialogFooter>
    </form>
  )
}
