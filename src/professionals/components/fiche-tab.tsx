import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  Download,
  Eye,
  Loader2,
  Mail,
  Phone,
  Briefcase,
  Award,
  DollarSign,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import type { ProfessionalWithRelations } from '../types'
import { mapProfessionalToViewModel, SPECIALTY_CATEGORY_LABELS } from '../mappers'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { useToast } from '@/shared/hooks/use-toast'

interface ProfessionalFicheTabProps {
  professional: ProfessionalWithRelations
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Fiche preview component - styled like a professional profile card
function FichePreview({
  professional,
}: {
  professional: ProfessionalWithRelations
}) {
  const viewModel = mapProfessionalToViewModel(professional)

  const initials = viewModel.initials

  return (
    <div className="bg-gradient-to-b from-sage-50 to-background rounded-2xl border border-border overflow-hidden">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-sage-500 to-sage-600 px-6 py-8 text-white sm:px-8 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          {/* Avatar */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white border-4 border-white/30 sm:h-24 sm:w-24">
            <span className="text-2xl font-bold sm:text-3xl">{initials}</span>
          </div>

          {/* Name & Title */}
          <div>
            <h2 className="text-xl font-bold sm:text-2xl">
              {viewModel.displayName}
            </h2>
            {viewModel.title && (
              <p className="mt-1 text-sage-100">{viewModel.title}</p>
            )}
            {viewModel.licenseNumber && (
              <p className="mt-1 text-sage-100 flex items-center gap-2 text-sm">
                <Award className="h-4 w-4" />
                Permis: {viewModel.licenseNumber}
              </p>
            )}
            {viewModel.yearsExperience && (
              <p className="text-sage-100 flex items-center gap-2 text-sm">
                <Briefcase className="h-4 w-4" />
                {viewModel.yearsExperience} années d'expérience
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6 sm:p-8 sm:space-y-8">
        {/* Bio */}
        {viewModel.bio && (
          <section>
            <h3 className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2 sm:text-sm sm:mb-3">
              Biographie
            </h3>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed sm:text-base">
              {viewModel.bio}
            </p>
          </section>
        )}

        {/* Approach */}
        {viewModel.approach && (
          <section>
            <h3 className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2 sm:text-sm sm:mb-3">
              Approche thérapeutique
            </h3>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed sm:text-base">
              {viewModel.approach}
            </p>
          </section>
        )}

        {/* Specialties */}
        {Object.keys(viewModel.specialtiesByCategory).length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2 sm:text-sm sm:mb-3">
              Spécialités
            </h3>
            <div className="space-y-3">
              {Object.entries(viewModel.specialtiesByCategory).map(([category, specialties]) => (
                <div key={category}>
                  <p className="text-xs text-foreground-muted mb-1.5">
                    {SPECIALTY_CATEGORY_LABELS[category] || category}
                  </p>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {specialties.map((specialty) => (
                      <Badge key={specialty.id} variant="secondary" className="text-xs sm:text-sm">
                        {specialty.name_fr}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Contact */}
        {(viewModel.publicEmail || viewModel.publicPhone) && (
          <section>
            <h3 className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2 sm:text-sm sm:mb-3">
              Contact
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              {viewModel.publicEmail && (
                <a
                  href={`mailto:${viewModel.publicEmail}`}
                  className="flex items-center gap-2 text-sm text-sage-600 hover:underline"
                >
                  <Mail className="h-4 w-4" />
                  {viewModel.publicEmail}
                </a>
              )}
              {viewModel.publicPhone && (
                <a
                  href={`tel:${viewModel.publicPhone}`}
                  className="flex items-center gap-2 text-sm text-sage-600 hover:underline"
                >
                  <Phone className="h-4 w-4" />
                  {viewModel.publicPhone}
                </a>
              )}
            </div>
          </section>
        )}

        {/* Rates/Honoraires - Placeholder */}
        <section>
          <h3 className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2 sm:text-sm sm:mb-3">
            Honoraires
          </h3>
          <div className="rounded-lg bg-background-secondary/50 p-4 text-sm text-foreground-muted">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              <span>À confirmer avec la Clinique MANA</span>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="bg-background-secondary px-6 py-3 border-t border-border sm:px-8 sm:py-4">
        <div className="flex flex-col gap-1 text-xs text-foreground-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="font-medium">Clinique MANA</span>
          <span>
            Généré le {formatDate(professional.fiche_generated_at || new Date().toISOString())}
            {professional.fiche_version > 0 && ` • Version ${professional.fiche_version}`}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ProfessionalFicheTab({ professional }: ProfessionalFicheTabProps) {
  const { toast } = useToast()
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const viewModel = mapProfessionalToViewModel(professional)

  const hasContent =
    viewModel.bio ||
    viewModel.approach ||
    Object.keys(viewModel.specialtiesByCategory).length > 0

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      // TODO: Implement PDF generation with react-pdf
      // For now, show a "coming soon" toast
      toast({
        title: 'Bientôt disponible',
        description: 'Le téléchargement PDF sera disponible prochainement.',
      })
    } catch (err) {
      console.error('Failed to download fiche:', err)
      toast({
        title: 'Erreur',
        description: 'Impossible de générer le PDF.',
        variant: 'error',
      })
    } finally {
      setIsDownloading(false)
    }
  }

  // Determine readiness
  const isReady = hasContent && viewModel.status === 'active'
  const missingItems: string[] = []
  if (!viewModel.bio) missingItems.push('Biographie')
  if (!viewModel.approach) missingItems.push('Approche')
  if (Object.keys(viewModel.specialtiesByCategory).length === 0) missingItems.push('Spécialités')

  if (!hasContent) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" />}
        title="Fiche non disponible"
        description="Le profil n'a pas assez d'informations pour générer une fiche. Complétez d'abord le portrait (biographie, approche, spécialités)."
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Main action card */}
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sage-100 text-sage-600 mb-4">
              <FileText className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Fiche professionnelle
            </h2>
            <p className="mt-1 text-sm text-foreground-muted max-w-md">
              La fiche contient les informations publiques du professionnel: biographie, approche thérapeutique, spécialités et coordonnées.
            </p>

            {/* Status indicator */}
            <div className="mt-4">
              {isReady ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Prête à télécharger
                </Badge>
              ) : missingItems.length > 0 ? (
                <Badge variant="warning" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Informations manquantes
                </Badge>
              ) : null}
            </div>

            {/* Missing items */}
            {missingItems.length > 0 && (
              <div className="mt-3 text-xs text-foreground-muted">
                Manquant: {missingItems.join(', ')}
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button onClick={handleDownload} disabled={isDownloading} size="lg">
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Télécharger la fiche (PDF)
              </Button>

              <Button
                variant="outline"
                size="lg"
                onClick={() => setShowPreviewModal(true)}
              >
                <Eye className="h-4 w-4" />
                Aperçu
              </Button>
            </div>

            {/* Version info */}
            {professional.fiche_generated_at && (
              <p className="mt-4 text-xs text-foreground-muted">
                Dernière génération: {formatDate(professional.fiche_generated_at)}
                {professional.fiche_version > 0 && ` (version ${professional.fiche_version})`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick preview card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Aperçu rapide</CardTitle>
              <CardDescription>
                Contenu qui sera inclus dans la fiche
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPreviewModal(true)}
            >
              <Eye className="h-4 w-4" />
              Voir en grand
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border overflow-hidden opacity-75 hover:opacity-100 transition-opacity cursor-pointer" onClick={() => setShowPreviewModal(true)}>
            <div className="scale-[0.7] origin-top-left w-[142.8%]">
              <FichePreview professional={professional} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Aperçu de la fiche</DialogTitle>
            <DialogDescription>
              Prévisualisation de la fiche professionnelle telle qu'elle apparaîtra
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <FichePreview professional={professional} />
            </motion.div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowPreviewModal(false)}>
              Fermer
            </Button>
            <Button onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Télécharger (PDF)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
