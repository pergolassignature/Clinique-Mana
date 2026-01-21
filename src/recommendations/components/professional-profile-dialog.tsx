// src/recommendations/components/professional-profile-dialog.tsx
// Dialog to view a professional's profile summary for recommendation context

import { Briefcase, Tag, Award, User, Clock } from 'lucide-react'
import { t } from '@/i18n'
import { useProfessional } from '@/professionals/hooks'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'

interface ProfessionalProfileDialogProps {
  professionalId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional callback when selecting this professional */
  onSelect?: (professionalId: string) => void
}

/**
 * Get initials from a display name.
 */
function getInitials(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
    const first = parts[0][0] ?? ''
    const last = parts[parts.length - 1]?.[0] ?? ''
    return `${first}${last}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

/**
 * Loading skeleton for the profile.
 */
function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  )
}

/**
 * Section component for profile sections.
 */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-foreground-secondary">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{title}</span>
      </div>
      <div>{children}</div>
    </div>
  )
}

/**
 * Dialog showing a professional's profile summary.
 */
export function ProfessionalProfileDialog({
  professionalId,
  open,
  onOpenChange,
  onSelect,
}: ProfessionalProfileDialogProps) {
  const { data: professional, isLoading } = useProfessional(professionalId ?? undefined)

  // Extract display name from profile relation
  const displayName = professional?.profile?.display_name

  // Get profession titles from professions relation
  const professionTitles = professional?.professions
    ?.map((p) => p.profession_title?.label_fr)
    .filter(Boolean) as string[] | undefined

  // Get motifs from motifs relation
  const motifs = professional?.motifs
    ?.map((m) => ({ key: m.motif?.key, label: m.motif?.label }))
    .filter((m) => m.key && m.label) as { key: string; label: string }[] | undefined

  // Get specialties from specialties relation
  const specialties = professional?.specialties
    ?.map((s) => ({
      code: s.specialty?.code,
      name: s.specialty?.name_fr,
      proficiencyLevel: s.proficiency_level,
    }))
    .filter((s) => s.code && s.name) as { code: string; name: string; proficiencyLevel: string | null }[] | undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('recommendations.profileDialog.title')}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <ProfileSkeleton />
        ) : !professional ? (
          <div className="py-8 text-center text-foreground-muted">
            {t('recommendations.profileDialog.notFound')}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header: Avatar, name, professions */}
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-foreground truncate">
                  {displayName || t('recommendations.profileDialog.unknownName')}
                </h3>
                {professionTitles && professionTitles.length > 0 && (
                  <p className="text-sm text-foreground-muted">
                    {professionTitles.join(' / ')}
                  </p>
                )}
                {professional.years_experience != null && professional.years_experience > 0 && (
                  <p className="text-xs text-foreground-muted mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {professional.years_experience} {t('recommendations.profileDialog.yearsExperience')}
                  </p>
                )}
              </div>
            </div>

            {/* Bio */}
            {professional.portrait_bio && (
              <Section icon={User} title={t('recommendations.profileDialog.bio')}>
                <p className="text-sm text-foreground-secondary leading-relaxed">
                  {professional.portrait_bio}
                </p>
              </Section>
            )}

            {/* Motifs */}
            {motifs && motifs.length > 0 && (
              <Section icon={Tag} title={t('recommendations.profileDialog.motifs')}>
                <div className="flex flex-wrap gap-1.5">
                  {motifs.map((motif) => (
                    <Badge key={motif.key} variant="secondary" className="text-xs">
                      {motif.label}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {/* Specialties */}
            {specialties && specialties.length > 0 && (
              <Section icon={Award} title={t('recommendations.profileDialog.specialties')}>
                <div className="flex flex-wrap gap-1.5">
                  {specialties.map((specialty) => (
                    <Badge
                      key={specialty.code}
                      variant="outline"
                      className="text-xs"
                    >
                      {specialty.name}
                      {specialty.proficiencyLevel && (
                        <span className="ml-1 text-foreground-muted">
                          ({specialty.proficiencyLevel})
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {/* Approach / methodology */}
            {professional.portrait_approach && (
              <Section icon={Briefcase} title={t('recommendations.profileDialog.approach')}>
                <p className="text-sm text-foreground-secondary leading-relaxed">
                  {professional.portrait_approach}
                </p>
              </Section>
            )}

            {/* Actions */}
            {onSelect && (
              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  {t('common.close')}
                </Button>
                <Button
                  onClick={() => {
                    onSelect(professional.id)
                    onOpenChange(false)
                  }}
                >
                  {t('recommendations.profileDialog.selectProfessional')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
