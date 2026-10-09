import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, MessageSquareText } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatTaxNumber } from '@/shared/lib/format'
import { formatClinicDateFull } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import type { ProfessionalRecord } from '../../api/parse'
import type { MySubmission } from '../../api/self'
import { ProfileSectionSummary, type ProfileSection } from '../../components/questionnaire/SectionSummary'
import { UpdateProfileDialog } from '../../components/self/UpdateProfileDialog'
import { useProfessionalsCatalog } from '../../hooks/use-catalog'
import { useMyProfessionalRecord } from '../../hooks/use-my-profile'
import { useMyProfessionalPrivate, useMySubmission } from '../../hooks/use-my-submission'
import type { CatalogView } from '../../lib/catalog-view'
import { fullName, primaryProfession } from '../../lib/display'
import { profileAction, QUESTIONNAIRE_PATH, recordSectionValues } from '../../lib/my-profile'
import { sectionLabel } from '../../lib/onboarding'
import { titleLabel } from '../../lib/title-label'

const P = 'modules.professionals.myProfile'

/** « Mes documents » (Task 4c.6). */
const MY_DOCUMENTS_PATH = '/mes-documents'

/**
 * « Mon profil » (`/mon-profil`, `professionals.self`, Task 4b.5): the professional's own file,
 * read-only, in the questionnaire's words: coordonnées, titles, public profile, matching profile
 * (motifs by name, by category), tax and bank data as masks only, and a link to « Mes documents » (4c.6).
 * Nothing written for the clinic: no compensation, no retention, and the clinic's notes on her row
 * (deactivation note, activation reason) are not displayed, although the record carries them: she
 * may read them (Loi 25, P4-373), the page stays calm. The only note shown is the one the clinic
 * wrote to her when it sent her profile back. Four requests in one tick: her
 * record, her open questionnaire, the catalogue and the masks (read by their card from the same
 * query, so the card never starts a second round trip).
 */
export function MyProfilePage() {
  usePageTitle(t(`${P}.pageTitle`))
  const record = useMyProfessionalRecord()
  const submission = useMySubmission()
  const catalog = useProfessionalsCatalog()
  // The masks start with the page; the card shows their own loading or failure.
  useMyProfessionalPrivate(true)
  const queries = [record, submission, catalog]
  if (queries.some((q) => q.isPending)) return <Loading />
  const failed = queries.filter((q) => q.isError && q.data === undefined)
  if (failed.length > 0) {
    return (
      <LoadError
        message={moduleErrorMessage(failed[0]?.error, t(`${P}.loadError`), 'professionals')}
        retrying={failed.some((q) => q.isFetching)}
        onRetry={() => failed.forEach((q) => void q.refetch())}
      />
    )
  }
  if (!record.data) {
    return (
      <div className="mx-auto max-w-form space-y-2">
        <PageHeader level={1} title={t(`${P}.pageTitle`)} />
        <EmptyState title={t(`${P}.noFile.title`)} body={t(`${P}.noFile.body`)} />
      </div>
    )
  }
  return <MyProfile record={record.data} submission={submission.data ?? null} catalog={catalog.data as CatalogView} />
}

function MyProfile({ record, submission, catalog }: { record: ProfessionalRecord; submission: MySubmission | null; catalog: CatalogView }) {
  const { professional } = record
  const values = recordSectionValues(record)
  const primary = primaryProfession(record)
  const title = primary ? catalog.byId.titles.get(primary.titleId) : undefined
  const summary = (section: ProfileSection) => <ProfileSectionSummary section={section} values={values[section]} catalog={catalog} gender={professional.gender} />
  return (
    <div className="mx-auto max-w-form space-y-5">
      <PageHeader
        level={1}
        title={t(`${P}.pageTitle`)}
        description={[fullName(professional), title ? titleLabel(title, professional.gender) : null].filter(Boolean).join(' · ')}
      />
      <QuestionnaireCard record={record} submission={submission} />
      <ProfileCard title={t(`${P}.cards.contact`)}>
        <dl className="mb-1.5 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{t('modules.professionals.questionnaire.personal.name')}</dt>
          <dd className="min-w-0 break-words text-foreground">{fullName(professional)}</dd>
          <dt className="text-muted-foreground">{t('modules.professionals.questionnaire.personal.loginEmail')}</dt>
          <dd className="min-w-0 break-words text-foreground">{professional.email}</dd>
        </dl>
        {summary('personal')}
      </ProfileCard>
      <ProfileCard title={sectionLabel('professional')}>{summary('professional')}</ProfileCard>
      <ProfileCard title={t(`${P}.cards.public`)} description={t(`${P}.cards.publicHelp`)}>
        {summary('portrait')}
      </ProfileCard>
      <ProfileCard title={t(`${P}.cards.matching`)} description={t(`${P}.cards.matchingHelp`)}>
        <div className="space-y-4">
          {/* Subsections of the card (its title is an h3): h4, named by their heading alone. */}
          {(['languages', 'clienteles', 'motifs', 'availability'] as const).map((section) => (
            <div key={section} className="space-y-1.5">
              <h4 className="text-sm font-semibold text-foreground">{sectionLabel(section)}</h4>
              {summary(section)}
            </div>
          ))}
        </div>
      </ProfileCard>
      <TaxBankCard />
      <ProfileCard title={t(`${P}.cards.documents`)}>
        <p className="text-sm text-muted-foreground">{t(`${P}.documents.body`)}</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to={MY_DOCUMENTS_PATH}>{t(`${P}.documents.link`)}</Link>
        </Button>
      </ProfileCard>
    </div>
  )
}

function ProfileCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * Where the professional's questionnaire stands, and the one thing to do: continue an open draft
 * (with the clinic's note when it sent the profile back), wait for the review of what was sent, or
 * « Mettre mon profil à jour ». An inactive file offers nothing (P4-303) and says whom to ask.
 */
function QuestionnaireCard({ record, submission }: { record: ProfessionalRecord; submission: MySubmission | null }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const action = profileAction(record.professional.status, submission)
  const Q = `${P}.questionnaire` as const
  const kind = submission?.kind ?? 'update'
  if (action === 'inactive') {
    return (
      <Alert variant="warning" role="status">
        <CircleAlert aria-hidden />
        <AlertDescription className="text-foreground">{t(`${Q}.inactive`)}</AlertDescription>
      </Alert>
    )
  }
  if (action === 'continue' && submission?.decisionNote) {
    return (
      <Alert variant="warning">
        <MessageSquareText aria-hidden />
        <AlertTitle>{t(`${Q}.returned.title`)}</AlertTitle>
        <AlertDescription>
          <p className="whitespace-pre-line text-foreground">{submission.decisionNote}</p>
          <Button asChild size="sm" className="mt-3">
            <Link to={QUESTIONNAIRE_PATH}>{t(`${Q}.returned.action`)}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t(`${Q}.title`)}</CardTitle>
        <CardDescription>
          {action === 'continue'
            ? t(`${Q}.continue.${kind}`)
            : action === 'sent'
              ? submission?.submittedAt
                ? t(`${Q}.sent.${kind}`, { date: formatClinicDateFull(submission.submittedAt) })
                : t(`${Q}.sentUndated.${kind}`)
              : t(`${Q}.update.body`)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {action === 'update' ? (
          <Button ref={button} type="button" size="sm" onClick={() => setOpen(true)}>
            {t(`${Q}.update.action`)}
          </Button>
        ) : (
          <Button asChild size="sm" variant={action === 'sent' ? 'outline' : 'default'}>
            <Link to={QUESTIONNAIRE_PATH}>{t(action === 'sent' ? `${Q}.sent.action` : `${Q}.continue.action`)}</Link>
          </Button>
        )}
        {open && (
          <UpdateProfileDialog
            onClose={() => setOpen(false)}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              button.current?.focus()
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * « Fiscalité et banque », masks only (`get_my_professional_private`, never a reveal): the account's
 * last four digits and the SIN's last three; never shown in full, here or anywhere.
 */
function TaxBankCard() {
  const query = useMyProfessionalPrivate(true)
  const data = query.data
  const L = 'modules.professionals.questionnaire'
  const rows: { label: string; value: string | null }[] = data
    ? [
        { label: t(`${L}.taxBank.institution`), value: data.bankInstitution },
        { label: t(`${L}.taxBank.transit`), value: data.bankTransit },
        { label: t(`${L}.taxBank.account`), value: data.bankAccountLast4 && t(`${P}.masks.account`, { last4: data.bankAccountLast4 }) },
        { label: t(`${L}.taxBank.businessNumber`), value: data.businessNumber },
        { label: t(`${L}.taxBank.gstNumber`), value: data.gstNumber && formatTaxNumber(data.gstNumber) },
        { label: t(`${L}.taxBank.qstNumber`), value: data.qstNumber && formatTaxNumber(data.qstNumber) },
        ...(data.sinLast3 ? [{ label: t(`${L}.taxBank.sin`), value: t(`${P}.masks.sin`, { last3: data.sinLast3 }) }] : []),
      ]
    : []
  return (
    <ProfileCard title={sectionLabel('tax_bank')} description={t(`${P}.cards.taxBankHelp`)}>
      {query.isPending ? (
        <Loading />
      ) : !data ? (
        <LoadError message={t(`${P}.taxBankError`)} retrying={query.isFetching} onRetry={() => void query.refetch()} />
      ) : (
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-foreground">{row.value ?? <span className="text-muted-foreground">{t(`${P}.notIndicated`)}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
    </ProfileCard>
  )
}
