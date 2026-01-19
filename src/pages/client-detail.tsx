import { Link, useRouterState } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MessageCircle,
  Calendar,
  FileText,
  Plus,
  ArrowRight,
  Info,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Users,
  ExternalLink,
  Check,
  Cake,
  Edit2,
  Globe,
  Crown,
  Link2,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import {
  getBackNavigation,
  type DetailPageSearchParams,
} from '@/shared/lib/navigation'

type ClientStatus = 'active' | 'inactive'
type RequestStatus = 'toAnalyze' | 'assigned' | 'closed'
type ContactMethod = 'call' | 'text' | 'email' | 'noPreference'
type ConsentStatus = 'valid' | 'expired' | 'missing'
type RelationType = 'parent' | 'legalGuardian' | 'spouse' | 'emergencyContact' | 'other'
type Language = 'fr' | 'en' | 'other'
type Gender = 'male' | 'female' | 'nonBinary' | 'other' | 'preferNotToSay' | null
type ParticipantRole = 'principal' | 'participant'

interface ClientRequest {
  id: string
  date: string
  status: RequestStatus
  motifs: string[]
  role: ParticipantRole
}

interface ConsentRecord {
  id: string
  version: string
  signedDate: string
  signedBy: string
  signedByType: 'client' | 'parent' | 'guardian'
  notes?: string
}

interface AuthorizedContact {
  id: string
  name: string
  relation: RelationType
  phone: string
  email: string
  canDiscuss: boolean // Authorization to discuss client matters
  isPrimary: boolean
  linkedClientId?: string // If this person is also a client in the system
}

interface Client {
  id: string
  firstName: string
  lastName: string
  dateOfBirth: string
  preferredLanguage: Language | null
  gender: Gender
  email: string | null
  phonePrimary: string
  phoneSecondary: string | null
  preferredContact: ContactMethod | null
  status: ClientStatus
  createdAt: string
  consentStatus: ConsentStatus
  consentRecords: ConsentRecord[]
  contacts: AuthorizedContact[]
  requests: ClientRequest[]
}

// Mock data for demonstration
const mockClient: Client = {
  id: 'CLI-2024-0018',
  firstName: 'Marie-Claire',
  lastName: 'Dubois',
  dateOfBirth: '1985-06-15',
  preferredLanguage: 'fr',
  gender: 'female',
  email: 'marie.dubois@courriel.com',
  phonePrimary: '514-555-0123',
  phoneSecondary: '514-555-0124',
  preferredContact: 'email',
  status: 'active',
  createdAt: '2024-01-10T09:00:00',
  consentStatus: 'valid',
  consentRecords: [
    {
      id: 'CON-001',
      version: '2.1',
      signedDate: '2024-01-10T09:15:00',
      signedBy: 'Marie-Claire Dubois',
      signedByType: 'client',
      notes: 'Consentement signé lors de la première prise de contact.',
    },
  ],
  contacts: [
    {
      id: 'CONTACT-001',
      name: 'François Dubois',
      relation: 'spouse',
      phone: '514-555-0456',
      email: 'francois.dubois@courriel.com',
      canDiscuss: true,
      isPrimary: false,
      linkedClientId: 'CLI-2024-0019', // He is also a client
    },
    {
      id: 'CONTACT-002',
      name: 'Jeanne Dubois',
      relation: 'parent',
      phone: '514-555-0789',
      email: 'jeanne.dubois@courriel.com',
      canDiscuss: true,
      isPrimary: true,
    },
    {
      id: 'CONTACT-003',
      name: 'Marc Tremblay',
      relation: 'emergencyContact',
      phone: '514-555-0999',
      email: '',
      canDiscuss: false, // Not authorized to discuss
      isPrimary: false,
    },
  ],
  requests: [
    {
      id: 'DEM-2024-0042',
      date: '2024-01-15T10:30:00',
      status: 'toAnalyze',
      motifs: ['Difficultés relationnelles'],
      role: 'principal',
    },
    {
      id: 'DEM-2023-0128',
      date: '2023-11-20T14:15:00',
      status: 'closed',
      motifs: ['Transition de vie'],
      role: 'principal',
    },
  ],
}

const statusConfig: Record<
  ClientStatus,
  { variant: 'success' | 'secondary'; labelKey: string }
> = {
  active: { variant: 'success', labelKey: 'pages.clientDetail.status.active' },
  inactive: { variant: 'secondary', labelKey: 'pages.clientDetail.status.inactive' },
}

const requestStatusConfig: Record<
  RequestStatus,
  { variant: 'warning' | 'success' | 'secondary'; labelKey: string }
> = {
  toAnalyze: { variant: 'warning', labelKey: 'pages.requestDetail.status.toAnalyze' },
  assigned: { variant: 'success', labelKey: 'pages.requestDetail.status.assigned' },
  closed: { variant: 'secondary', labelKey: 'pages.requestDetail.status.closed' },
}

const consentStatusConfig: Record<
  ConsentStatus,
  {
    variant: 'success' | 'warning' | 'error'
    icon: typeof ShieldCheck
    bannerKey: string
    labelKey: string
  }
> = {
  valid: {
    variant: 'success',
    icon: ShieldCheck,
    bannerKey: 'pages.clientDetail.consent.banner.valid',
    labelKey: 'pages.clientDetail.consent.status.valid',
  },
  expired: {
    variant: 'warning',
    icon: ShieldAlert,
    bannerKey: 'pages.clientDetail.consent.banner.expired',
    labelKey: 'pages.clientDetail.consent.status.expired',
  },
  missing: {
    variant: 'error',
    icon: ShieldX,
    bannerKey: 'pages.clientDetail.consent.banner.missing',
    labelKey: 'pages.clientDetail.consent.status.missing',
  },
}

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(dateString))
}

function formatDateShort(dateString: string): string {
  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString))
}

function calculateAge(dateOfBirth: string): number {
  const today = new Date()
  const birthDate = new Date(dateOfBirth)
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

export function ClientDetailPage() {
  // Get navigation context from router state
  const routerState = useRouterState()
  const searchParams = routerState.location.search as DetailPageSearchParams
  const clientId = (routerState.matches.at(-1)?.params as { id?: string })?.id ?? ''
  const backNav = getBackNavigation(searchParams, 'clients')

  const client = mockClient
  const statusInfo = statusConfig[client.status]
  const consentInfo = consentStatusConfig[client.consentStatus]
  const ConsentIcon = consentInfo.icon
  const fullName = `${client.firstName} ${client.lastName}`
  const age = calculateAge(client.dateOfBirth)

  return (
    <div className="min-h-full">
      {/* Sticky Header */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-10 -mx-6 -mt-6 mb-6 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-4"
      >
        {/* Back link - context-aware */}
        <Link
          to={backNav.to as '/clients' | '/demandes/$id'}
          params={backNav.params as { id: string } | undefined}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          {t(backNav.labelKey as Parameters<typeof t>[0])}
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {/* Client name + Age + Status badges */}
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold text-foreground">
                {fullName}
                <span className="text-lg text-foreground-muted font-normal ml-2">
                  {age} ans
                </span>
              </h1>
              <Badge variant={statusInfo.variant}>
                {t(statusInfo.labelKey as Parameters<typeof t>[0])}
              </Badge>
              <Badge variant={consentInfo.variant} className="gap-1">
                <ConsentIcon className="h-3 w-3" />
                {t(consentInfo.labelKey as Parameters<typeof t>[0])}
              </Badge>
            </div>
            {/* Profile helper text + Client ID */}
            <p className="text-sm text-foreground-secondary">
              {t('pages.clientDetail.profileHelper')}
            </p>
            <p className="text-xs text-foreground-muted font-mono">{client.id}</p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" className="gap-1.5">
              <Edit2 className="h-4 w-4" />
              {t('pages.clientDetail.editProfile')}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-4 w-4" />
              {t('pages.clientDetail.createRequest')}
            </Button>
          </div>
        </div>
      </motion.header>

      {/* Main content - Two column layout */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left column - IDENTITY + CONTACT + CONSENT + RELATIONS (primary, wider) */}
        <div className="lg:col-span-3 space-y-6">
          {/* ===== IDENTITY SECTION ===== */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
          >
            {/* Section header */}
            <div className="bg-sage-50/50 border-b border-sage-100 px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-sage-100 p-1.5">
                  <User className="h-3.5 w-3.5 text-sage-600" />
                </div>
                <h2 className="text-sm font-semibold text-sage-700">
                  {t('pages.clientDetail.sections.identity')}
                </h2>
              </div>
            </div>

            {/* Identity fields */}
            <div className="p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                {/* Prénom */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <User className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.identity.firstName')}
                    </dt>
                    <dd className="text-sm text-foreground font-medium">
                      {client.firstName}
                    </dd>
                  </div>
                </div>

                {/* Nom */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <User className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.identity.lastName')}
                    </dt>
                    <dd className="text-sm text-foreground font-medium">
                      {client.lastName}
                    </dd>
                  </div>
                </div>

                {/* Date de naissance */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <Cake className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.identity.dateOfBirth')}
                    </dt>
                    <dd className="text-sm text-foreground">
                      {formatDate(client.dateOfBirth)}
                    </dd>
                  </div>
                </div>

                {/* Langue préférée */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <Globe className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.identity.preferredLanguage')}
                    </dt>
                    <dd className="text-sm text-foreground">
                      {client.preferredLanguage
                        ? t(
                            `pages.clientDetail.languages.${client.preferredLanguage}` as Parameters<
                              typeof t
                            >[0]
                          )
                        : '—'}
                    </dd>
                  </div>
                </div>

                {/* Genre / identité de genre */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <User className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.identity.gender')}
                    </dt>
                    <dd className="text-sm text-foreground">
                      {client.gender
                        ? t(
                            `pages.clientDetail.genders.${client.gender}` as Parameters<
                              typeof t
                            >[0]
                          )
                        : t('pages.clientDetail.genders.notProvided')}
                    </dd>
                  </div>
                </div>

                {/* Date de création */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <Calendar className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.identity.createdAt')}
                    </dt>
                    <dd className="text-sm text-foreground">
                      {formatDate(client.createdAt)}
                    </dd>
                  </div>
                </div>
              </div>

              {/* Helper text */}
              <div className="mt-6 pt-4 border-t border-border">
                <p className="text-xs text-foreground-muted flex items-center gap-1.5">
                  <Info className="h-3 w-3" />
                  {t('pages.clientDetail.identity.helper')}
                </p>
              </div>
            </div>
          </motion.section>

          {/* ===== CONTACT SECTION ===== */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
          >
            {/* Section header */}
            <div className="bg-background-secondary/50 border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-background-tertiary p-1.5">
                  <Phone className="h-3.5 w-3.5 text-foreground-secondary" />
                </div>
                <h2 className="text-sm font-semibold text-foreground-secondary">
                  {t('pages.clientDetail.sections.contact')}
                </h2>
              </div>
            </div>

            {/* Contact fields */}
            <div className="p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                {/* Courriel */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <Mail className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.contact.email')}
                    </dt>
                    <dd className="text-sm">
                      {client.email ? (
                        <a
                          href={`mailto:${client.email}`}
                          className="text-sage-600 hover:text-sage-700 hover:underline transition-colors"
                        >
                          {client.email}
                        </a>
                      ) : (
                        <span className="text-foreground-muted italic">
                          {t('pages.clientDetail.contact.emailUnknown')}
                          <span className="block text-xs text-wine-500 mt-0.5">
                            {t('pages.clientDetail.contact.emailRequired')}
                          </span>
                        </span>
                      )}
                    </dd>
                  </div>
                </div>

                {/* Téléphone principal */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <Phone className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.contact.phonePrimary')}
                    </dt>
                    <dd className="text-sm text-foreground">
                      <a
                        href={`tel:${client.phonePrimary}`}
                        className="text-sage-600 hover:text-sage-700 hover:underline transition-colors"
                      >
                        {client.phonePrimary}
                      </a>
                    </dd>
                  </div>
                </div>

                {/* Téléphone secondaire */}
                {client.phoneSecondary && (
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                      <Phone className="h-4 w-4 text-foreground-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                        {t('pages.clientDetail.contact.phoneSecondary')}
                      </dt>
                      <dd className="text-sm text-foreground">
                        <a
                          href={`tel:${client.phoneSecondary}`}
                          className="text-sage-600 hover:text-sage-700 hover:underline transition-colors"
                        >
                          {client.phoneSecondary}
                        </a>
                      </dd>
                    </div>
                  </div>
                )}

                {/* Préférence de contact */}
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-background-secondary p-2 mt-0.5">
                    <MessageCircle className="h-4 w-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <dt className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-1">
                      {t('pages.clientDetail.contact.preferredContact')}
                    </dt>
                    <dd className="text-sm text-foreground">
                      {client.preferredContact
                        ? t(
                            `pages.clientDetail.contactMethods.${client.preferredContact}` as Parameters<
                              typeof t
                            >[0]
                          )
                        : t('pages.clientDetail.contactMethods.noPreference')}
                    </dd>
                  </div>
                </div>
              </div>

              {/* Helper text */}
              <div className="mt-6 pt-4 border-t border-border">
                <p className="text-xs text-foreground-muted flex items-center gap-1.5">
                  <Info className="h-3 w-3" />
                  {t('pages.clientDetail.contact.helper')}
                </p>
              </div>
            </div>
          </motion.section>

          {/* ===== CONSENT SECTION ===== */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
          >
            {/* Section header */}
            <div className="bg-honey-50/50 border-b border-honey-100 px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-honey-100 p-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-honey-600" />
                  </div>
                  <h2 className="text-sm font-semibold text-honey-700">
                    {t('pages.clientDetail.sections.consent')}
                  </h2>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <Plus className="h-3 w-3" />
                  {t('pages.clientDetail.consent.actions.add')}
                </Button>
              </div>
            </div>

            {/* Consent status banner */}
            <div
              className={cn(
                'px-5 py-3 flex items-center gap-3 border-b',
                client.consentStatus === 'valid' && 'bg-sage-50/50 border-sage-100',
                client.consentStatus === 'expired' && 'bg-honey-50/50 border-honey-100',
                client.consentStatus === 'missing' && 'bg-wine-50/50 border-wine-100'
              )}
            >
              <ConsentIcon
                className={cn(
                  'h-5 w-5',
                  client.consentStatus === 'valid' && 'text-sage-600',
                  client.consentStatus === 'expired' && 'text-honey-600',
                  client.consentStatus === 'missing' && 'text-wine-600'
                )}
              />
              <div className="flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    client.consentStatus === 'valid' && 'text-sage-700',
                    client.consentStatus === 'expired' && 'text-honey-700',
                    client.consentStatus === 'missing' && 'text-wine-700'
                  )}
                >
                  {t(consentInfo.bannerKey as Parameters<typeof t>[0])}
                </p>
              </div>
              {client.consentStatus !== 'valid' && (
                <Button
                  size="sm"
                  variant={client.consentStatus === 'missing' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                >
                  {t('pages.clientDetail.consent.actions.renew')}
                </Button>
              )}
            </div>

            {/* Consent explanation */}
            <div className="px-5 py-3 bg-background-secondary/30 border-b border-border">
              <p className="text-xs text-foreground-muted flex items-center gap-2">
                <Info className="h-3.5 w-3.5 shrink-0" />
                {t('pages.clientDetail.consent.explanation')}
              </p>
            </div>

            {/* Assignment notice when consent is not valid */}
            {client.consentStatus !== 'valid' && (
              <div className="px-5 py-3 bg-honey-50/30 border-b border-honey-100">
                <p className="text-xs text-honey-700 flex items-center gap-2">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  {t('pages.clientDetail.consent.assignmentNotice')}
                </p>
              </div>
            )}

            {/* Consent records */}
            <div className="p-5">
              {client.consentRecords.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
                    {t('pages.clientDetail.consent.records.title')}
                  </h3>
                  {client.consentRecords.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-xl border border-border bg-background-secondary/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Badge variant="secondary" className="text-xs">
                              {t('pages.clientDetail.consent.records.version')}{' '}
                              {record.version}
                            </Badge>
                            <span className="text-xs text-foreground-muted">
                              {t('pages.clientDetail.consent.records.signedDate')}{' '}
                              {formatDateShort(record.signedDate)}
                            </span>
                          </div>
                          <div className="text-sm text-foreground flex items-center flex-wrap gap-1">
                            <span className="text-foreground-muted">
                              {t('pages.clientDetail.consent.records.signedBy')}:
                            </span>
                            <span>{record.signedBy}</span>
                            <Badge variant="outline" className="text-xs">
                              {t(
                                `pages.clientDetail.consent.records.signedByOptions.${record.signedByType}` as Parameters<
                                  typeof t
                                >[0]
                              )}
                            </Badge>
                          </div>
                          {record.notes && (
                            <p className="text-xs text-foreground-muted">{record.notes}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1 shrink-0"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t('pages.clientDetail.consent.records.viewDocument')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-background-secondary/50 p-6 text-center">
                  <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-background-tertiary flex items-center justify-center">
                    <ShieldX className="h-5 w-5 text-foreground-muted" />
                  </div>
                  <p className="text-sm text-foreground-muted">
                    {t('pages.clientDetail.consent.records.empty')}
                  </p>
                </div>
              )}
            </div>
          </motion.section>

          {/* ===== CONTACTS AUTORISÉS SECTION ===== */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-xl border border-border bg-background shadow-soft overflow-hidden"
          >
            {/* Section header */}
            <div className="bg-background-secondary/50 border-b border-border px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-background-tertiary p-1.5">
                    <Users className="h-3.5 w-3.5 text-foreground-secondary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground-secondary">
                      {t('pages.clientDetail.sections.contacts')}
                    </h2>
                    <p className="text-xs text-foreground-muted">
                      {t('pages.clientDetail.contacts.subtitle')}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <Plus className="h-3 w-3" />
                  {t('pages.clientDetail.contacts.add')}
                </Button>
              </div>
            </div>

            {/* Contacts list */}
            <div className="p-5">
              {client.contacts.length > 0 ? (
                <div className="space-y-3">
                  {client.contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="rounded-xl border border-border bg-background-secondary/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* Name + Relation type badge + Primary badge */}
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <span className="font-medium text-foreground">
                              {contact.name}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {t(
                                `pages.clientDetail.contacts.types.${contact.relation}` as Parameters<
                                  typeof t
                                >[0]
                              )}
                            </Badge>
                            {contact.isPrimary && (
                              <Badge variant="default" className="text-xs">
                                {t('pages.clientDetail.contacts.authorization.primaryContact')}
                              </Badge>
                            )}
                          </div>

                          {/* Authorization status + Client status badges */}
                          <div className="flex items-center gap-2 flex-wrap mb-3">
                            {contact.canDiscuss ? (
                              <div className="flex items-center gap-1.5 rounded-lg bg-sage-50 px-2 py-1">
                                <Check className="h-3.5 w-3.5 text-sage-600" />
                                <span className="text-xs text-sage-700">
                                  {t('pages.clientDetail.contacts.authorization.canDiscuss')}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 rounded-lg bg-background-tertiary px-2 py-1">
                                <span className="text-xs text-foreground-muted">
                                  {t('pages.clientDetail.contacts.authorization.cannotDiscuss')}
                                </span>
                              </div>
                            )}
                            {contact.linkedClientId && (
                              <div className="flex items-center gap-1.5 rounded-lg bg-honey-50 px-2 py-1">
                                <User className="h-3.5 w-3.5 text-honey-600" />
                                <span className="text-xs text-honey-700">
                                  {t('pages.clientDetail.contacts.clientStatus.isClient')}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Contact info */}
                          <div className="space-y-1 text-sm">
                            <p className="text-foreground-secondary flex items-center gap-2">
                              <Phone className="h-3.5 w-3.5 text-foreground-muted" />
                              <a
                                href={`tel:${contact.phone}`}
                                className="hover:text-sage-600 hover:underline transition-colors"
                              >
                                {contact.phone}
                              </a>
                            </p>
                            {contact.email && (
                              <p className="text-foreground-secondary flex items-center gap-2">
                                <Mail className="h-3.5 w-3.5 text-foreground-muted" />
                                <a
                                  href={`mailto:${contact.email}`}
                                  className="hover:text-sage-600 hover:underline transition-colors"
                                >
                                  {contact.email}
                                </a>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          {/* If contact is also a client, show "View client" link */}
                          {contact.linkedClientId ? (
                            <Link
                              to="/clients/$id"
                              params={{ id: contact.linkedClientId }}
                              search={{ from: 'client', fromId: clientId }}
                              className="inline-flex items-center gap-1.5 text-xs text-sage-600 hover:text-sage-700 font-medium transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {t('pages.clientDetail.contacts.clientStatus.viewClient')}
                            </Link>
                          ) : (
                            /* If contact is NOT a client, show options to link/create */
                            <div className="flex flex-col gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs gap-1 text-foreground-muted hover:text-sage-600 justify-end"
                              >
                                <Link2 className="h-3 w-3" />
                                {t('pages.clientDetail.contacts.clientStatus.linkExisting')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs gap-1 text-foreground-muted hover:text-sage-600 justify-end"
                              >
                                <Plus className="h-3 w-3" />
                                {t('pages.clientDetail.contacts.clientStatus.createClient')}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-background-secondary/50 p-6 text-center">
                  <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-background-tertiary flex items-center justify-center">
                    <Users className="h-5 w-5 text-foreground-muted" />
                  </div>
                  <p className="text-sm text-foreground-muted">
                    {t('pages.clientDetail.contacts.empty')}
                  </p>
                </div>
              )}

              {/* Helper text */}
              <div className="mt-4 pt-3 border-t border-border space-y-2">
                <p className="text-xs text-foreground-muted flex items-start gap-1.5">
                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>{t('pages.clientDetail.contacts.helper')}</span>
                </p>
                <p className="text-xs text-foreground-muted/80 pl-[18px]">
                  {t('pages.clientDetail.contacts.relationshipNote')}
                </p>
              </div>
            </div>
          </motion.section>
        </div>

        {/* Right column - REQUEST HISTORY (secondary, narrower) */}
        <div className="lg:col-span-2 space-y-6">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="rounded-xl border border-border bg-background p-5 shadow-soft"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="rounded-lg bg-honey-100 p-2">
                <FileText className="h-4 w-4 text-honey-600" />
              </div>
              <h2 className="font-semibold text-foreground">
                {t('pages.clientDetail.sections.requests')}
              </h2>
            </div>

            {client.requests.length > 0 ? (
              <div className="space-y-3">
                {client.requests.map((request) => {
                  const reqStatusInfo = requestStatusConfig[request.status]
                  const isPrincipal = request.role === 'principal'
                  return (
                    <Link
                      key={request.id}
                      to="/demandes/$id"
                      params={{ id: request.id }}
                      search={{ from: 'client', fromId: clientId }}
                      className="block rounded-xl border border-border bg-background-secondary/50 p-4 hover:bg-background-tertiary hover:border-sage-200 transition-colors group"
                    >
                      {/* Date + Status + Role */}
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-foreground-muted">
                            {formatDateShort(request.date)}
                          </span>
                          <Badge
                            variant={isPrincipal ? 'default' : 'secondary'}
                            className="text-xs gap-1"
                          >
                            {isPrincipal && <Crown className="h-3 w-3" />}
                            {t(
                              `pages.clientDetail.requestHistory.roles.${request.role}` as Parameters<
                                typeof t
                              >[0]
                            )}
                          </Badge>
                        </div>
                        <Badge variant={reqStatusInfo.variant} className="text-xs">
                          {t(reqStatusInfo.labelKey as Parameters<typeof t>[0])}
                        </Badge>
                      </div>

                      {/* Motifs as tags */}
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {request.motifs.map((motif) => (
                          <span
                            key={motif}
                            className="inline-flex items-center rounded-md bg-sage-100 px-2 py-0.5 text-xs font-medium text-sage-700"
                          >
                            {motif}
                          </span>
                        ))}
                      </div>

                      {/* Link to view */}
                      <span className="text-xs text-sage-600 group-hover:text-sage-700 inline-flex items-center gap-1 transition-colors">
                        {t('pages.clientDetail.requestHistory.viewRequest')}
                        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              /* Empty state */
              <div className="rounded-xl border border-dashed border-border bg-background-secondary/50 p-6 text-center">
                <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-background-tertiary flex items-center justify-center">
                  <FileText className="h-5 w-5 text-foreground-muted" />
                </div>
                <p className="text-sm text-foreground-muted leading-relaxed">
                  {t('pages.clientDetail.requestHistory.empty')}
                </p>
              </div>
            )}
          </motion.section>
        </div>
      </div>
    </div>
  )
}
