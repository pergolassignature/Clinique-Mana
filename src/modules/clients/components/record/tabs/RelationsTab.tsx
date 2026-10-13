import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, Pencil, Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { EmptyState } from '@/shared/components/EmptyState'
import { SaveButton } from '@/shared/components/SaveButton'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { ClientRelation, ClientSearchRow } from '../../../api/parse'
import { useClientSearch, useRemoveClientRelation, useSetClientRelation } from '../../../hooks/use-clients'
import { RELATION_RIGHTS, RELATION_TYPES, clientPath, type RelationRights, type RelationType } from '../../../lib/constants'
import { clientNumberLabel, fullName, relationTypeLabel, rightLabel } from '../../../lib/display'
import { useClientRecordData } from '../record-context'

const P = 'modules.clients.record.relations'

const NO_RIGHTS: RelationRights = { main_contact: false, manages_appointments: false, receives_communications: false, receives_invoices: false }

/**
 * « Proches » (plan C3.4, R-9): the people related to the client, each with what they are to her
 * and what they may do for her (the three rights and « contact principal »), and « Ajouter un
 * proche » (an existing file, found by name). Both parents of a child are two relations, each
 * with their own rights; an invoice goes to one payer among those who receive invoices (R-61).
 */
export function RelationsTab() {
  const { summary, canEdit } = useClientRecordData()
  const [editing, setEditing] = useState<ClientRelation | 'new' | null>(null)
  const [removing, setRemoving] = useState<ClientRelation | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const remove = useRemoveClientRelation()
  const relations = summary.relations
  return (
    <SettingsCard
      as="section"
      layout="card"
      title={t(`${P}.title`)}
      description={t(`${P}.description`)}
      footer={
        canEdit ? (
          <Button ref={addRef} type="button" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t(`${P}.add`)}
          </Button>
        ) : undefined
      }
    >
      {relations.length === 0 ? (
        <EmptyState title={t(`${P}.empty.title`)} body={t(`${P}.empty.body`)} inCard={false} />
      ) : (
        <Table aria-label={t(`${P}.table`)} scrollLabel={t(`${P}.table`)} scrollFocus="overflow">
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${P}.columns.person`)}</TableHead>
              <TableHead>{t(`${P}.columns.type`)}</TableHead>
              <TableHead>{t(`${P}.columns.rights`)}</TableHead>
              {canEdit && (
                <TableHead>
                  <span className="sr-only">{t(`${P}.columns.actions`)}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {relations.map((relation) => {
              const rights = RELATION_RIGHTS.filter((right) => relation.relatedRights[right])
              return (
                <TableRow key={relation.id}>
                  <TableCell className="font-medium">
                    <Link to={clientPath(relation.relatedId)} className="text-link underline-offset-2 hover:underline">
                      {relation.relatedName}
                    </Link>
                    <span className="block tabular text-xs text-muted-foreground">{clientNumberLabel(relation.relatedNumber)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{relationTypeLabel(relation.type)}</TableCell>
                  <TableCell>
                    {rights.length === 0 ? (
                      <span className="text-muted-foreground">{t(`${P}.noRights`)}</span>
                    ) : (
                      <span className="flex flex-wrap gap-x-3 gap-y-1">
                        {rights.map((right) => (
                          <Badge key={right} variant={right === 'main_contact' ? 'info' : 'secondary'}>
                            {rightLabel(right)}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="w-0 whitespace-nowrap text-right">
                      <Button type="button" variant="ghost" size="sm" aria-label={t(`${P}.editLabel`, { name: relation.relatedName })} onClick={() => setEditing(relation)}>
                        <Pencil aria-hidden className="sm:hidden" />
                        <span className="max-sm:sr-only">{t(`${P}.edit`)}</span>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" aria-label={t(`${P}.removeLabel`, { name: relation.relatedName })} onClick={() => setRemoving(relation)}>
                        <Trash2 aria-hidden className="sm:hidden" />
                        <span className="max-sm:sr-only">{t(`${P}.remove`)}</span>
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {editing !== null && <RelationDialog relation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !remove.isPending && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${P}.removeTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && t(`${P}.removeBody`, { name: removing.relatedName, client: fullName(summary.client) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              aria-disabled={remove.isPending || undefined}
              onClick={ignoreWhenInactive(remove.isPending, () =>
                removing && remove.mutate({ clientId: summary.client.id, relatedId: removing.relatedId }, { onSuccess: () => setRemoving(null) }),
              )}
              className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
            >
              {t(`${P}.remove`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}

/**
 * « Ajouter un proche » / « Modifier le proche »: the person (an existing file, found by name or
 * number), what she is to the client, what she may do for the client and the reverse.
 */
function RelationDialog({ relation, onClose }: { relation: ClientRelation | null; onClose: () => void }) {
  const { summary } = useClientRecordData()
  const client = summary.client
  const [related, setRelated] = useState<{ id: string; name: string } | null>(relation ? { id: relation.relatedId, name: relation.relatedName } : null)
  const [type, setType] = useState<RelationType | ''>(relation?.type ?? '')
  const [relatedRights, setRelatedRights] = useState<RelationRights>(relation?.relatedRights ?? NO_RIGHTS)
  const [clientRights, setClientRights] = useState<RelationRights>(relation?.clientRights ?? NO_RIGHTS)
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSetClientRelation({ onErrorMessage: (message) => setRefusal(message) })
  const [query, setQuery] = useState('')
  const search = useClientSearch(useDebouncedValue(query, 250))
  const results = (search.data ?? []).filter((row: ClientSearchRow) => row.id !== client.id && !summary.relations.some((r) => r.relatedId === row.id))
  const ready = related !== null && type !== ''

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(relation ? `${P}.dialog.editTitle` : `${P}.dialog.addTitle`)}</DialogTitle>
          <DialogDescription>{t(`${P}.dialog.description`, { client: fullName(client) })}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!ready) return
            setRefusal(null)
            save.mutate({ clientId: client.id, relatedId: related.id, type, relatedRights, clientRights }, { onSuccess: onClose })
          }}
        >
          {relation ? (
            <p className="text-sm">
              <span className="font-medium">{relation.relatedName}</span> · <span className="tabular">{clientNumberLabel(relation.relatedNumber)}</span>
            </p>
          ) : related ? (
            <p className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{related.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRelated(null)}>
                {t(`${P}.dialog.change`)}
              </Button>
            </p>
          ) : (
            <div className="space-y-2">
              <FormField label={t(`${P}.dialog.person`)} width="full" help={t(`${P}.dialog.personHelp`)}>
                {(field) => <Input {...field} type="search" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />}
              </FormField>
              {query.trim().length >= 2 && (
                <ul aria-label={t(`${P}.dialog.results`)} className="max-h-48 space-y-1 overflow-y-auto">
                  {results.length === 0 ? (
                    <li className="text-sm text-muted-foreground">{t(search.isFetching ? 'common.loading' : `${P}.dialog.noResult`)}</li>
                  ) : (
                    results.map((row) => (
                      <li key={row.id}>
                        <Button type="button" variant="ghost" className="h-auto w-full justify-start py-1.5 text-left" onClick={() => setRelated({ id: row.id, name: row.name })}>
                          <span>
                            <span className="font-medium">{row.name}</span> · <span className="tabular text-muted-foreground">{clientNumberLabel(row.clientNumber)}</span>
                          </span>
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )}
          <FormField label={t(`${P}.dialog.type`, { client: client.firstName })} width="md" required>
            {(field) => (
              <Select {...field} value={type} onChange={(event) => setType(event.target.value as RelationType)} placeholder={t(`${P}.dialog.choose`)}>
                {RELATION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {relationTypeLabel(value)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <RightsFieldset
            legend={t(`${P}.dialog.relatedRights`, { name: related?.name ?? t(`${P}.dialog.thisPerson`), client: client.firstName })}
            value={relatedRights}
            onChange={setRelatedRights}
          />
          <RightsFieldset
            legend={t(`${P}.dialog.clientRights`, { client: client.firstName, name: related?.name ?? t(`${P}.dialog.thisPerson`) })}
            value={clientRights}
            onChange={setClientRights}
          />
          {refusal && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden />
              <AlertDescription className="text-foreground">{refusal}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <SaveButton pending={save.isPending} disabled={!ready} label={t('common.save')} pendingLabel={t('common.saving')} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RightsFieldset({ legend, value, onChange }: { legend: string; value: RelationRights; onChange: (value: RelationRights) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {RELATION_RIGHTS.map((right) => (
        <CheckboxField key={right} label={rightLabel(right)} checked={value[right]} onCheckedChange={(checked) => onChange({ ...value, [right]: checked === true })} />
      ))}
    </fieldset>
  )
}
