import { useState, useMemo, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  User,
  Plus,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Check,
  Calendar,
  Mail,
  Phone,
  Loader2,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog'
import {
  validateField,
  buildDuplicateCheckPayload,
  type FormValidationErrors,
} from '@/shared/lib/client-validation'
import {
  useDuplicateDetection,
  type DuplicateMatch,
} from '@/shared/hooks/use-duplicate-detection'
import { DuplicateWarning } from './duplicate-warning'

type ConsentStatus = 'valid' | 'expired' | 'missing'

interface Client {
  id: string
  firstName: string
  lastName: string
  dateOfBirth: string
  email?: string
  phone?: string
  consent: {
    status: ConsentStatus
  }
}

interface ClientPickerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectClient: (client: Client) => void
  onCreateClient?: (clientData: NewClientData) => void
  excludeClientIds?: string[]
}

interface NewClientData {
  firstName: string
  lastName: string
  dateOfBirth: string
  email: string
  phone: string
}

// Mock clients for demonstration
const mockClients: Client[] = [
  {
    id: 'CLI-2024-0020',
    firstName: 'Jean',
    lastName: 'Tremblay',
    dateOfBirth: '1985-03-15',
    email: 'jean.tremblay@email.com',
    phone: '514-555-0101',
    consent: { status: 'valid' },
  },
  {
    id: 'CLI-2024-0021',
    firstName: 'Sophie',
    lastName: 'Gagnon',
    dateOfBirth: '1992-07-22',
    email: 'sophie.gagnon@email.com',
    phone: '514-555-0102',
    consent: { status: 'expired' },
  },
  {
    id: 'CLI-2024-0022',
    firstName: 'Pierre',
    lastName: 'Lavoie',
    dateOfBirth: '1978-11-08',
    email: 'pierre.lavoie@email.com',
    phone: '514-555-0103',
    consent: { status: 'missing' },
  },
  {
    id: 'CLI-2024-0023',
    firstName: 'Marie',
    lastName: 'Bouchard',
    dateOfBirth: '2010-05-20',
    email: '',
    phone: '514-555-0104',
    consent: { status: 'valid' },
  },
  {
    id: 'CLI-2024-0024',
    firstName: 'Luc',
    lastName: 'Bergeron',
    dateOfBirth: '1965-01-30',
    email: 'luc.bergeron@email.com',
    phone: '514-555-0105',
    consent: { status: 'valid' },
  },
]

const consentConfig: Record<
  ConsentStatus,
  { icon: typeof ShieldCheck; colorClass: string; labelKey: string }
> = {
  valid: {
    icon: ShieldCheck,
    colorClass: 'text-sage-600',
    labelKey: 'pages.requestDetail.clientPicker.client.consent.valid',
  },
  expired: {
    icon: ShieldAlert,
    colorClass: 'text-honey-600',
    labelKey: 'pages.requestDetail.clientPicker.client.consent.expired',
  },
  missing: {
    icon: ShieldX,
    colorClass: 'text-wine-600',
    labelKey: 'pages.requestDetail.clientPicker.client.consent.missing',
  },
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

// Map validation error keys to i18n keys
function getValidationErrorMessage(errorKey: string): string {
  const errorMap: Record<string, string> = {
    required: 'pages.requestDetail.clientPicker.create.validation.required',
    invalidEmail: 'pages.requestDetail.clientPicker.create.validation.invalidEmail',
    invalidPhone: 'pages.requestDetail.clientPicker.create.validation.invalidPhone',
    invalidName: 'pages.requestDetail.clientPicker.create.validation.invalidName',
    invalidDateOfBirth: 'pages.requestDetail.clientPicker.create.validation.invalidDateOfBirth',
  }
  return t((errorMap[errorKey] || errorMap.required) as Parameters<typeof t>[0])
}

export function ClientPickerDrawer({
  open,
  onOpenChange,
  onSelectClient,
  onCreateClient,
  excludeClientIds = [],
}: ClientPickerDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Form state for new client
  const [newClient, setNewClient] = useState<NewClientData>({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    email: '',
    phone: '',
  })

  // Track which fields have been touched (for live validation)
  const [touchedFields, setTouchedFields] = useState<Set<keyof NewClientData>>(new Set())

  // Live validation errors
  const [formErrors, setFormErrors] = useState<FormValidationErrors>({})

  // Medium confidence duplicate confirmation
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false)

  // Build duplicate check payload from form state
  const duplicatePayload = useMemo(() => {
    if (!showCreateForm) return null
    return buildDuplicateCheckPayload(newClient)
  }, [showCreateForm, newClient])

  // Use duplicate detection hook (Supabase)
  const {
    isChecking: isDuplicateChecking,
    matches: supabaseMatches,
  } = useDuplicateDetection(duplicatePayload, { enabled: showCreateForm })

  // Local mock duplicate check for demo/testing
  // TODO: Remove once real Supabase data is available
  const localDuplicateMatches = useMemo(() => {
    if (!showCreateForm || !duplicatePayload) return []

    const { normalizedEmail, normalizedPhone, normalizedFirstName, normalizedLastName, dateOfBirth } = duplicatePayload
    const matches: Array<{
      id: string
      firstName: string
      lastName: string
      email: string | null
      phone: string | null
      dateOfBirth: string | null
      confidence: 'high' | 'medium' | 'none'
      matchReasons: string[]
    }> = []

    for (const client of mockClients) {
      const matchReasons: string[] = []
      let confidence: 'high' | 'medium' | 'none' = 'none'

      const clientEmail = client.email?.toLowerCase().trim() || ''
      const clientPhone = client.phone?.replace(/\D/g, '') || ''
      const clientFirstName = client.firstName.toLowerCase().trim()
      const clientLastName = client.lastName.toLowerCase().trim()

      // LEVEL 1: CERTAIN DUPLICATE
      // Exact email match
      if (normalizedEmail && clientEmail && clientEmail === normalizedEmail) {
        matchReasons.push('email')
        confidence = 'high'
      }

      // Exact phone match
      if (normalizedPhone.length >= 10 && clientPhone) {
        const payloadPhoneLast10 = normalizedPhone.slice(-10)
        const clientPhoneLast10 = clientPhone.slice(-10)
        if (payloadPhoneLast10.length === 10 && payloadPhoneLast10 === clientPhoneLast10) {
          matchReasons.push('phone')
          confidence = 'high'
        }
      }

      // Exact name + DOB
      if (
        dateOfBirth &&
        client.dateOfBirth === dateOfBirth &&
        clientFirstName === normalizedFirstName &&
        clientLastName === normalizedLastName
      ) {
        matchReasons.push('name+dob')
        confidence = 'high'
      }

      // LEVEL 2: POSSIBLE DUPLICATE (only if not already high)
      if (confidence === 'none' && normalizedFirstName && normalizedLastName) {
        if (clientFirstName === normalizedFirstName && clientLastName === normalizedLastName) {
          matchReasons.push('same_name')
          confidence = 'medium'
        }
      }

      if (confidence !== 'none') {
        matches.push({
          id: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email || null,
          phone: client.phone || null,
          dateOfBirth: client.dateOfBirth,
          confidence,
          matchReasons,
        })
      }
    }

    // Sort by confidence (high first)
    return matches.sort((a, b) => (a.confidence === 'high' ? -1 : b.confidence === 'high' ? 1 : 0))
  }, [showCreateForm, duplicatePayload])

  // Combine Supabase and local matches (use local for demo, Supabase when available)
  const duplicateMatches = supabaseMatches.length > 0 ? supabaseMatches : localDuplicateMatches
  const firstMatch = duplicateMatches[0]
  const highestConfidence = firstMatch ? firstMatch.confidence : 'none'
  const hasHighConfidenceDuplicate = duplicateMatches.some((m) => m.confidence === 'high')
  const hasMediumConfidenceDuplicate = duplicateMatches.some((m) => m.confidence === 'medium')

  // Handle field change with live validation
  const handleFieldChange = useCallback(
    (field: keyof NewClientData, value: string) => {
      setNewClient((prev) => ({ ...prev, [field]: value }))

      // Reset duplicate confirmation when relevant fields change
      if (['email', 'phone', 'firstName', 'lastName', 'dateOfBirth'].includes(field)) {
        setDuplicateConfirmed(false)
      }

      // Validate if touched
      if (touchedFields.has(field)) {
        const result = validateField(field, value)
        setFormErrors((prev) => {
          if (result.isValid) {
            const { [field]: _, ...rest } = prev
            return rest
          }
          return { ...prev, [field]: result.error }
        })
      }
    },
    [touchedFields]
  )

  // Handle field blur (mark as touched and validate)
  const handleFieldBlur = useCallback((field: keyof NewClientData) => {
    setTouchedFields((prev) => new Set(prev).add(field))
    const result = validateField(field, newClient[field])
    setFormErrors((prev) => {
      if (result.isValid) {
        const { [field]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [field]: result.error }
    })
  }, [newClient])

  // Filter clients based on search query
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return []

    const query = searchQuery.toLowerCase()
    return mockClients.filter((client) => {
      const fullName = `${client.firstName} ${client.lastName}`.toLowerCase()
      const email = client.email?.toLowerCase() || ''
      const phone = client.phone || ''

      return fullName.includes(query) || email.includes(query) || phone.includes(query)
    })
  }, [searchQuery])

  // Simulate search delay
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (value.trim()) {
      setIsSearching(true)
      setTimeout(() => setIsSearching(false), 300)
    }
  }

  // Handle client selection
  const handleSelectClient = (client: Client) => {
    onSelectClient(client)
    onOpenChange(false)
    resetState()
  }

  // Handle selecting a duplicate match
  const handleSelectDuplicate = (match: DuplicateMatch) => {
    // Convert match to Client format and select
    const client: Client = {
      id: match.id,
      firstName: match.firstName,
      lastName: match.lastName,
      dateOfBirth: match.dateOfBirth || '',
      email: match.email || undefined,
      phone: match.phone || undefined,
      consent: { status: 'missing' }, // Default, would come from actual data
    }
    onSelectClient(client)
    onOpenChange(false)
    resetState()
  }

  // Validate all fields on submit
  const validateAllFieldsOnSubmit = (): boolean => {
    const fields: (keyof NewClientData)[] = [
      'firstName',
      'lastName',
      'dateOfBirth',
      'email',
      'phone',
    ]
    const errors: FormValidationErrors = {}
    let isValid = true

    for (const field of fields) {
      const result = validateField(field, newClient[field])
      if (!result.isValid && result.error) {
        errors[field] = result.error
        isValid = false
      }
    }

    setFormErrors(errors)
    // Mark all fields as touched
    setTouchedFields(new Set(fields))
    return isValid
  }

  // Check if form can be submitted
  const canSubmit = useMemo(() => {
    // Check all fields are filled and valid
    const hasAllFields =
      newClient.firstName.trim() &&
      newClient.lastName.trim() &&
      newClient.dateOfBirth &&
      newClient.email.trim() &&
      newClient.phone.trim()

    if (!hasAllFields) return false

    // Check no validation errors
    if (Object.keys(formErrors).length > 0) return false

    // Block if high confidence duplicate
    if (hasHighConfidenceDuplicate) return false

    // Require confirmation for medium confidence
    if (hasMediumConfidenceDuplicate && !duplicateConfirmed) return false

    return true
  }, [
    newClient,
    formErrors,
    hasHighConfidenceDuplicate,
    hasMediumConfidenceDuplicate,
    duplicateConfirmed,
  ])

  // Handle form submission
  const handleCreateClient = () => {
    if (!validateAllFieldsOnSubmit()) return
    if (!canSubmit) return

    if (onCreateClient) {
      onCreateClient(newClient)
    }
    onOpenChange(false)
    resetState()
  }

  // Reset state when drawer closes
  const resetState = () => {
    setSearchQuery('')
    setShowCreateForm(false)
    setNewClient({
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      email: '',
      phone: '',
    })
    setFormErrors({})
    setTouchedFields(new Set())
    setDuplicateConfirmed(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState()
    }
    onOpenChange(newOpen)
  }

  // Reset touched fields when switching to create form
  useEffect(() => {
    if (showCreateForm) {
      setTouchedFields(new Set())
      setFormErrors({})
      setDuplicateConfirmed(false)
    }
  }, [showCreateForm])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="fixed right-0 top-0 h-full max-h-full w-full max-w-md translate-x-0 translate-y-0 rounded-none rounded-l-2xl border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-300 data-[state=open]:duration-300 sm:max-w-md"
        style={{
          left: 'auto',
          top: 0,
          transform: 'none',
        }}
      >
        <AnimatePresence mode="wait">
          {showCreateForm ? (
            // CREATE CLIENT FORM
            <motion.div
              key="create-form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="flex h-full flex-col"
            >
              <DialogHeader className="space-y-1 pb-4">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="mb-2 flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors w-fit"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('pages.requestDetail.clientPicker.create.backToSearch')}
                </button>
                <DialogTitle className="text-lg font-semibold">
                  {t('pages.requestDetail.clientPicker.create.title')}
                </DialogTitle>
                <DialogDescription>
                  {t('pages.requestDetail.clientPicker.create.subtitle')}
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* First Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {t('pages.requestDetail.clientPicker.create.fields.firstName')}
                    <span className="text-wine-500 ml-0.5">*</span>
                  </label>
                  <Input
                    value={newClient.firstName}
                    onChange={(e) => handleFieldChange('firstName', e.target.value)}
                    onBlur={() => handleFieldBlur('firstName')}
                    placeholder={t(
                      'pages.requestDetail.clientPicker.create.fields.firstNamePlaceholder'
                    )}
                    className={cn(
                      formErrors.firstName && touchedFields.has('firstName') && 'border-wine-300 focus:ring-wine-500/30'
                    )}
                  />
                  {formErrors.firstName && touchedFields.has('firstName') && (
                    <p className="text-xs text-wine-600">
                      {getValidationErrorMessage(formErrors.firstName)}
                    </p>
                  )}
                </div>

                {/* Last Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {t('pages.requestDetail.clientPicker.create.fields.lastName')}
                    <span className="text-wine-500 ml-0.5">*</span>
                  </label>
                  <Input
                    value={newClient.lastName}
                    onChange={(e) => handleFieldChange('lastName', e.target.value)}
                    onBlur={() => handleFieldBlur('lastName')}
                    placeholder={t(
                      'pages.requestDetail.clientPicker.create.fields.lastNamePlaceholder'
                    )}
                    className={cn(
                      formErrors.lastName && touchedFields.has('lastName') && 'border-wine-300 focus:ring-wine-500/30'
                    )}
                  />
                  {formErrors.lastName && touchedFields.has('lastName') && (
                    <p className="text-xs text-wine-600">
                      {getValidationErrorMessage(formErrors.lastName)}
                    </p>
                  )}
                </div>

                {/* Date of Birth */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {t('pages.requestDetail.clientPicker.create.fields.dateOfBirth')}
                    <span className="text-wine-500 ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted pointer-events-none" />
                    <Input
                      type="date"
                      value={newClient.dateOfBirth}
                      onChange={(e) => handleFieldChange('dateOfBirth', e.target.value)}
                      onBlur={() => handleFieldBlur('dateOfBirth')}
                      max={new Date().toISOString().split('T')[0]}
                      className={cn(
                        'pl-10',
                        formErrors.dateOfBirth && touchedFields.has('dateOfBirth') && 'border-wine-300 focus:ring-wine-500/30'
                      )}
                    />
                  </div>
                  {formErrors.dateOfBirth && touchedFields.has('dateOfBirth') && (
                    <p className="text-xs text-wine-600">
                      {getValidationErrorMessage(formErrors.dateOfBirth)}
                    </p>
                  )}
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {t('pages.requestDetail.clientPicker.create.fields.email')}
                    <span className="text-wine-500 ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted pointer-events-none" />
                    <Input
                      type="email"
                      value={newClient.email}
                      onChange={(e) => handleFieldChange('email', e.target.value)}
                      onBlur={() => handleFieldBlur('email')}
                      placeholder={t(
                        'pages.requestDetail.clientPicker.create.fields.emailPlaceholder'
                      )}
                      className={cn(
                        'pl-10',
                        formErrors.email && touchedFields.has('email') && 'border-wine-300 focus:ring-wine-500/30'
                      )}
                    />
                  </div>
                  {formErrors.email && touchedFields.has('email') && (
                    <p className="text-xs text-wine-600">
                      {getValidationErrorMessage(formErrors.email)}
                    </p>
                  )}
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {t('pages.requestDetail.clientPicker.create.fields.phone')}
                    <span className="text-wine-500 ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted pointer-events-none" />
                    <Input
                      type="tel"
                      value={newClient.phone}
                      onChange={(e) => handleFieldChange('phone', e.target.value)}
                      onBlur={() => handleFieldBlur('phone')}
                      placeholder={t(
                        'pages.requestDetail.clientPicker.create.fields.phonePlaceholder'
                      )}
                      className={cn(
                        'pl-10',
                        formErrors.phone && touchedFields.has('phone') && 'border-wine-300 focus:ring-wine-500/30'
                      )}
                    />
                  </div>
                  {formErrors.phone && touchedFields.has('phone') && (
                    <p className="text-xs text-wine-600">
                      {getValidationErrorMessage(formErrors.phone)}
                    </p>
                  )}
                </div>

                {/* Duplicate Detection Status */}
                {isDuplicateChecking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 text-sm text-foreground-muted py-2"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('pages.requestDetail.clientPicker.duplicates.checking')}
                  </motion.div>
                )}

                {/* Duplicate Warning Panel */}
                <AnimatePresence>
                  {duplicateMatches.length > 0 && !isDuplicateChecking && (
                    <DuplicateWarning
                      matches={duplicateMatches}
                      highestConfidence={highestConfidence}
                      onSelectClient={handleSelectDuplicate}
                      confirmed={duplicateConfirmed}
                      onConfirmChange={
                        hasMediumConfidenceDuplicate && !hasHighConfidenceDuplicate
                          ? setDuplicateConfirmed
                          : undefined
                      }
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-border mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCreateForm(false)}
                >
                  {t('pages.requestDetail.clientPicker.create.actions.cancel')}
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCreateClient}
                  disabled={!canSubmit || isDuplicateChecking}
                >
                  {isDuplicateChecking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('pages.requestDetail.clientPicker.create.actions.create')
                  )}
                </Button>
              </div>
            </motion.div>
          ) : (
            // SEARCH VIEW
            <motion.div
              key="search-view"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="flex h-full flex-col"
            >
              <DialogHeader className="space-y-1 pb-4">
                <DialogTitle className="text-lg font-semibold">
                  {t('pages.requestDetail.clientPicker.title')}
                </DialogTitle>
                <DialogDescription>
                  {t('pages.requestDetail.clientPicker.subtitle')}
                </DialogDescription>
              </DialogHeader>

              {/* Search Input */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
                <Input
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t('pages.requestDetail.clientPicker.searchPlaceholder')}
                  className="pl-10 pr-10"
                  autoFocus
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted animate-spin" />
                )}
              </div>

              {/* Results Area */}
              <div className="flex-1 overflow-y-auto -mx-1 px-1">
                {searchQuery.trim() ? (
                  <>
                    {filteredClients.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs text-foreground-muted mb-3">
                          {filteredClients.length}{' '}
                          {t('pages.requestDetail.clientPicker.results.found')}
                        </p>
                        {filteredClients.map((client) => {
                          const isExcluded = excludeClientIds.includes(client.id)
                          const consentInfo = consentConfig[client.consent.status]
                          const ConsentIcon = consentInfo.icon
                          const age = calculateAge(client.dateOfBirth)

                          return (
                            <motion.button
                              key={client.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              onClick={() => !isExcluded && handleSelectClient(client)}
                              disabled={isExcluded}
                              className={cn(
                                'w-full rounded-xl border p-4 text-left transition-all',
                                isExcluded
                                  ? 'opacity-50 cursor-not-allowed border-border bg-background-secondary'
                                  : 'border-border bg-background hover:border-sage-300 hover:bg-sage-50/50 cursor-pointer'
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <div className="shrink-0 h-10 w-10 rounded-full bg-sage-100 flex items-center justify-center">
                                  <User className="h-5 w-5 text-sage-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-foreground">
                                      {client.firstName} {client.lastName}
                                    </span>
                                    <span className="text-sm text-foreground-muted">
                                      {age} {t('pages.requestDetail.clientPicker.client.age')}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <ConsentIcon
                                      className={cn('h-3.5 w-3.5', consentInfo.colorClass)}
                                    />
                                    <span
                                      className={cn(
                                        'text-xs',
                                        client.consent.status === 'valid'
                                          ? 'text-sage-600'
                                          : client.consent.status === 'expired'
                                            ? 'text-honey-600'
                                            : 'text-wine-600'
                                      )}
                                    >
                                      {t(consentInfo.labelKey as Parameters<typeof t>[0])}
                                    </span>
                                  </div>
                                </div>
                                {isExcluded ? (
                                  <Badge variant="secondary" className="text-xs shrink-0">
                                    {t('pages.requestDetail.clientPicker.alreadyAdded')}
                                  </Badge>
                                ) : (
                                  <div className="shrink-0 h-8 w-8 rounded-lg border border-sage-200 bg-sage-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Check className="h-4 w-4 text-sage-600" />
                                  </div>
                                )}
                              </div>
                            </motion.button>
                          )
                        })}
                      </div>
                    ) : (
                      // No Results
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-8"
                      >
                        <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-background-secondary flex items-center justify-center">
                          <Search className="h-6 w-6 text-foreground-muted" />
                        </div>
                        <p className="text-sm font-medium text-foreground mb-1">
                          {t('pages.requestDetail.clientPicker.results.empty')}
                        </p>
                        <p className="text-xs text-foreground-muted mb-4">
                          {t('pages.requestDetail.clientPicker.results.emptyHint')}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowCreateForm(true)}
                          className="gap-1.5"
                        >
                          <Plus className="h-4 w-4" />
                          {t('pages.requestDetail.clientPicker.actions.createNew')}
                        </Button>
                      </motion.div>
                    )}
                  </>
                ) : (
                  // Initial state - prompt to search
                  <div className="text-center py-8">
                    <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-sage-50 flex items-center justify-center">
                      <User className="h-6 w-6 text-sage-500" />
                    </div>
                    <p className="text-sm text-foreground-muted">
                      {t('pages.requestDetail.clientPicker.subtitle')}
                    </p>
                  </div>
                )}
              </div>

              {/* Create New Client Button */}
              <div className="pt-4 border-t border-border mt-4">
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setShowCreateForm(true)}
                >
                  <Plus className="h-4 w-4" />
                  {t('pages.requestDetail.clientPicker.actions.createNew')}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
