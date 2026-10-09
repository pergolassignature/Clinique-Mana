import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ContractCard } from '../ContractCard'
import { SubmissionsCard } from '../SubmissionsCard'

const D = 'modules.professionals.record.documents'

/**
 * « Documents » (P4-13), minimal until 4c fills it: « Contrat de service » first (Task 4d.3, A5.1),
 * « Questionnaire et mises à jour », where a submission is reviewed (`REVIEW_TAB`, Task 4b.5), then
 * a placeholder for the documents themselves.
 */
export function DocumentsTab() {
  return (
    <div className="max-w-form space-y-4">
      <ContractCard />
      <SubmissionsCard />
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t(`${D}.files.title`)}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title={t(`${D}.files.emptyTitle`)} body={t(`${D}.files.emptyBody`)} />
        </CardContent>
      </Card>
    </div>
  )
}
