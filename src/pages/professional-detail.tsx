import { useState } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Power,
  PowerOff,
  FileText,
  User,
  Briefcase,
  History,
  Loader2,
  Package,
  LayoutDashboard,
  Calendar,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import {
  useProfessional,
  useUpdateProfessionalStatus,
} from '@/professionals'
import { getDocumentDownloadUrl } from '@/professionals/api'
import type { ProfessionalDocument } from '@/professionals/types'
import type { ProfessionalDetailTab, ProfessionalStatus } from '@/professionals'
import { mapProfessionalToViewModel } from '@/professionals/mappers'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Skeleton } from '@/shared/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

// Tab components
import { ProfessionalApercuTab } from '@/professionals/components/apercu-tab'
import { ProfessionalProfileTab } from '@/professionals/components/profile-tab'
import { ProfessionalProfilPublicTab } from '@/professionals/components/profil-public-tab'
import { ProfessionalDocumentsTab } from '@/professionals/components/documents-tab'
import { ProfessionalHistoryTab } from '@/professionals/components/history-tab'
import { ProfessionalServicesTab } from '@/professionals/components/services-tab'
import { ProfessionalCalendarTab } from '@/professionals/components/calendar-tab'

const tabs: Array<{
  id: ProfessionalDetailTab
  label: string
  icon: typeof User
}> = [
  { id: 'apercu', label: 'Aperçu', icon: LayoutDashboard },
  { id: 'profil', label: 'Profil', icon: User },
  { id: 'profil-public', label: 'Profil public', icon: Briefcase },
  { id: 'services', label: 'Services', icon: Package },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'calendrier', label: 'Calendrier', icon: Calendar },
  { id: 'historique', label: 'Historique', icon: History },
]

function getStatusBadgeVariant(status: ProfessionalStatus): 'success' | 'warning' | 'secondary' | 'error' {
  switch (status) {
    case 'active':
      return 'success'
    case 'invited':
      return 'warning'
    case 'pending':
      return 'secondary'
    case 'inactive':
      return 'error'
    default:
      return 'secondary'
  }
}

function getStatusLabel(status: ProfessionalStatus): string {
  switch (status) {
    case 'active':
      return 'Actif'
    case 'invited':
      return 'Invité'
    case 'pending':
      return 'En attente'
    case 'inactive':
      return 'Inactif'
    default:
      return status
  }
}

// Hook to get profile photo URL
function useProfilePhotoUrl(documents: ProfessionalDocument[] | undefined) {
  const photoDoc = documents?.find(
    (doc) => doc.document_type === 'photo' && doc.file_path
  )

  return useQuery({
    queryKey: ['document-url', photoDoc?.id],
    queryFn: () => getDocumentDownloadUrl(photoDoc!.file_path),
    enabled: !!photoDoc?.file_path,
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
    gcTime: 1000 * 60 * 60, // Keep in cache for 1 hour
  })
}

// Profile Avatar component with photo support
function ProfileAvatar({
  photoUrl,
  initials,
  isLoading,
}: {
  photoUrl?: string
  initials: string
  isLoading?: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-sage-100">
        <Loader2 className="h-5 w-5 animate-spin text-sage-600" />
      </div>
    )
  }

  if (photoUrl) {
    return (
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full">
        <img
          src={photoUrl}
          alt="Photo de profil"
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-600">
      <span className="text-lg font-semibold">{initials}</span>
    </div>
  )
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-1.5 h-4 w-32" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  )
}

export function ProfessionalDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string }
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<ProfessionalDetailTab>('apercu')
  const [showStatusDialog, setShowStatusDialog] = useState(false)

  const { data: professional, isLoading, error } = useProfessional(id)
  const updateStatus = useUpdateProfessionalStatus()

  const viewModel = professional ? mapProfessionalToViewModel(professional) : null

  // Get profile photo URL
  const { data: photoUrl, isLoading: isLoadingPhoto } = useProfilePhotoUrl(professional?.documents)

  const handleToggleStatus = async () => {
    if (!professional) return
    const newStatus: ProfessionalStatus =
      professional.status === 'active' ? 'inactive' : 'active'
    try {
      await updateStatus.mutateAsync({
        id: professional.id,
        input: { status: newStatus },
      })
      setShowStatusDialog(false)
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  const canToggleStatus =
    professional?.status === 'active' || professional?.status === 'inactive'

  const handleNavigateToTab = (tab: ProfessionalDetailTab) => {
    setActiveTab(tab)
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-foreground-muted">Une erreur est survenue</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate({ to: '/professionnels' })}
        >
          Retour à la liste
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/professionnels"
        className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux professionnels
      </Link>

      {/* Header */}
      {isLoading ? (
        <HeaderSkeleton />
      ) : professional && viewModel ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Profile info */}
          <div className="flex items-center gap-4">
            <ProfileAvatar
              photoUrl={photoUrl}
              initials={viewModel.initials}
              isLoading={isLoadingPhoto}
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">
                  {viewModel.displayName}
                </h1>
                <Badge variant={getStatusBadgeVariant(professional.status)}>
                  {getStatusLabel(professional.status)}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-foreground-muted">
                {viewModel.email}
                {viewModel.title && (
                  <span className="ml-2">• {viewModel.title}</span>
                )}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {canToggleStatus && (
              <Button
                variant={professional.status === 'active' ? 'outline' : 'default'}
                onClick={() => setShowStatusDialog(true)}
              >
                {professional.status === 'active' ? (
                  <>
                    <PowerOff className="h-4 w-4" />
                    Désactiver
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4" />
                    Activer
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-4 overflow-x-auto sm:space-x-6">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'border-sage-600 text-sage-600'
                    : 'border-transparent text-foreground-muted hover:border-border hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-48 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
          ) : professional ? (
            <>
              {activeTab === 'apercu' && (
                <ProfessionalApercuTab
                  professional={professional}
                  onNavigateToTab={handleNavigateToTab}
                />
              )}
              {activeTab === 'profil' && (
                <ProfessionalProfileTab professional={professional} />
              )}
              {activeTab === 'profil-public' && (
                <ProfessionalProfilPublicTab professional={professional} />
              )}
              {activeTab === 'services' && (
                <ProfessionalServicesTab professional={professional} />
              )}
              {activeTab === 'documents' && (
                <ProfessionalDocumentsTab professional={professional} />
              )}
              {activeTab === 'calendrier' && (
                <ProfessionalCalendarTab professional={professional} />
              )}
              {activeTab === 'historique' && (
                <ProfessionalHistoryTab professional={professional} />
              )}
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* Status change confirmation dialog */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {professional?.status === 'active' ? 'Désactiver' : 'Activer'} le professionnel
            </DialogTitle>
            <DialogDescription>
              {professional?.status === 'active'
                ? 'Le professionnel ne sera plus visible sur la plateforme et ne pourra plus recevoir de demandes.'
                : 'Le professionnel sera visible sur la plateforme et pourra recevoir des demandes.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStatusDialog(false)}
            >
              Annuler
            </Button>
            <Button
              variant={professional?.status === 'active' ? 'destructive' : 'default'}
              onClick={handleToggleStatus}
              disabled={updateStatus.isPending}
            >
              {updateStatus.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : professional?.status === 'active' ? (
                'Désactiver'
              ) : (
                'Activer'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
