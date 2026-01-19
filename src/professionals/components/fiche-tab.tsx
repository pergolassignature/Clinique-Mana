import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  FileText,
  Download,
  RefreshCw,
  Loader2,
  Mail,
  Phone,
  Briefcase,
  Award,
} from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations, Specialty } from '../types'
import { useUpdateProfessional } from '../hooks'
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

const categoryLabels: Record<string, string> = {
  therapy_type: 'professionals.portrait.specialties.categories.therapy_type',
  population: 'professionals.portrait.specialties.categories.population',
  issue: 'professionals.portrait.specialties.categories.issue',
  modality: 'professionals.portrait.specialties.categories.modality',
}

// Fiche preview component - styled like a professional profile card
function FichePreview({
  professional,
}: {
  professional: ProfessionalWithRelations
}) {
  // Group specialties by category
  const specialtiesByCategory = professional.specialties?.reduce(
    (acc, ps) => {
      if (ps.specialty) {
        const category = ps.specialty.category
        if (!acc[category]) acc[category] = []
        acc[category].push(ps.specialty)
      }
      return acc
    },
    {} as Record<string, Specialty[]>
  ) || {}

  const initials = professional.profile?.display_name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  return (
    <div
      id="fiche-preview"
      className="bg-gradient-to-b from-sage-50 to-background rounded-2xl border border-border overflow-hidden"
    >
      {/* Header Section */}
      <div className="bg-gradient-to-r from-sage-500 to-sage-600 px-8 py-10 text-white">
        <div className="flex items-center gap-6">
          {/* Avatar */}
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white border-4 border-white/30">
            <span className="text-3xl font-bold">{initials}</span>
          </div>

          {/* Name & Title */}
          <div>
            <h2 className="text-2xl font-bold">
              {professional.profile?.display_name}
            </h2>
            {professional.license_number && (
              <p className="mt-1 text-sage-100 flex items-center gap-2">
                <Award className="h-4 w-4" />
                Permis: {professional.license_number}
              </p>
            )}
            {professional.years_experience && (
              <p className="mt-1 text-sage-100 flex items-center gap-2">
                <Briefcase className="h-4 w-4" />
                {professional.years_experience} années d'expérience
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-8 space-y-8">
        {/* Bio */}
        {professional.portrait_bio && (
          <section>
            <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
              {t('professionals.fiche.sections.bio')}
            </h3>
            <p className="text-foreground whitespace-pre-wrap leading-relaxed">
              {professional.portrait_bio}
            </p>
          </section>
        )}

        {/* Approach */}
        {professional.portrait_approach && (
          <section>
            <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
              {t('professionals.fiche.sections.approach')}
            </h3>
            <p className="text-foreground whitespace-pre-wrap leading-relaxed">
              {professional.portrait_approach}
            </p>
          </section>
        )}

        {/* Specialties */}
        {Object.keys(specialtiesByCategory).length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
              {t('professionals.fiche.sections.specialties')}
            </h3>
            <div className="space-y-3">
              {Object.entries(specialtiesByCategory).map(([category, specialties]) => (
                <div key={category}>
                  <p className="text-xs text-foreground-muted mb-1.5">
                    {t(categoryLabels[category] as Parameters<typeof t>[0])}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {specialties.map((specialty) => (
                      <Badge key={specialty.id} variant="secondary">
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
        {(professional.public_email || professional.public_phone) && (
          <section>
            <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
              {t('professionals.fiche.sections.contact')}
            </h3>
            <div className="flex flex-wrap gap-6">
              {professional.public_email && (
                <a
                  href={`mailto:${professional.public_email}`}
                  className="flex items-center gap-2 text-sage-600 hover:underline"
                >
                  <Mail className="h-4 w-4" />
                  {professional.public_email}
                </a>
              )}
              {professional.public_phone && (
                <a
                  href={`tel:${professional.public_phone}`}
                  className="flex items-center gap-2 text-sage-600 hover:underline"
                >
                  <Phone className="h-4 w-4" />
                  {professional.public_phone}
                </a>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="bg-background-secondary px-8 py-4 border-t border-border">
        <div className="flex items-center justify-between text-xs text-foreground-muted">
          <span>Clinique MANA</span>
          <span>
            Généré le {formatDate(professional.fiche_generated_at || new Date().toISOString())}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ProfessionalFicheTab({ professional }: ProfessionalFicheTabProps) {
  const updateProfessional = useUpdateProfessional()
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  const hasContent =
    professional.portrait_bio ||
    professional.portrait_approach ||
    (professional.specialties && professional.specialties.length > 0)

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      // Update the fiche_generated_at timestamp and increment version
      await updateProfessional.mutateAsync({
        id: professional.id,
        input: {},
      })

      // In a real implementation, you would:
      // 1. Generate a PDF from the fiche content
      // 2. Upload it to storage
      // 3. Create a document record of type 'fiche'

      // For now, we just update the timestamp via a server function
      // This would be done via an Edge Function in production
    } catch (err) {
      console.error('Failed to generate fiche:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      // In production, this would:
      // 1. Use a library like html2pdf or jsPDF
      // 2. Or call an Edge Function to generate the PDF server-side
      // 3. Then download the generated file

      // For now, we'll use the browser's print functionality
      const printWindow = window.open('', '_blank')
      if (printWindow) {
        const content = document.getElementById('fiche-preview')?.innerHTML
        if (content) {
          printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Fiche - ${professional.profile?.display_name}</title>
              <style>
                body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; }
                @page { margin: 20mm; }
                @media print {
                  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
              </style>
            </head>
            <body>
              ${content}
            </body>
            </html>
          `)
          printWindow.document.close()
          printWindow.print()
        }
      }
    } catch (err) {
      console.error('Failed to download fiche:', err)
    } finally {
      setIsDownloading(false)
    }
  }

  if (!hasContent) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" />}
        title={t('professionals.fiche.empty.title')}
        description={t('professionals.fiche.empty.description')}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('professionals.fiche.title')}</h2>
          {professional.fiche_generated_at && (
            <p className="text-sm text-foreground-muted">
              {t('professionals.fiche.lastGenerated')}: {formatDate(professional.fiche_generated_at)}
              {professional.fiche_version > 1 && (
                <span className="ml-2">
                  ({t('professionals.fiche.version')} {professional.fiche_version})
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {professional.fiche_generated_at
              ? t('professionals.fiche.regenerate')
              : t('professionals.detail.actions.generateFiche')}
          </Button>

          <Button onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t('professionals.fiche.download')}
          </Button>
        </div>
      </div>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('professionals.fiche.preview')}</CardTitle>
          <CardDescription>
            Aperçu de la fiche professionnelle telle qu'elle sera générée
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div ref={previewRef}>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <FichePreview professional={professional} />
            </motion.div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
