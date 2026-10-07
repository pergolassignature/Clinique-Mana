import { useState, useEffect } from 'react'
import {
  User,
  Briefcase,
  FileText,
  Star,
  Heart,
  Camera,
  Shield,
  FileSignature,
  Link2,
  Copy,
  Check,
  Loader2,
} from 'lucide-react'
import { t, type TranslationKey } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Label } from '@/shared/ui/label'
import { useToast } from '@/shared/hooks/use-toast'
import type { QuestionnaireSection, ProfessionalWithRelations } from '../types'
import { useCreateUpdateRequest } from '../hooks'

interface UpdateRequestModalProps {
  open: boolean
  onClose: () => void
  professional: ProfessionalWithRelations
}

const SECTION_OPTIONS: {
  key: QuestionnaireSection
  labelKey: string
  icon: typeof User
}[] = [
  { key: 'personal', labelKey: 'professionals.updateRequest.sections.personal', icon: User },
  { key: 'professional', labelKey: 'professionals.updateRequest.sections.professional', icon: Briefcase },
  { key: 'portrait', labelKey: 'professionals.updateRequest.sections.portrait', icon: FileText },
  { key: 'specialties', labelKey: 'professionals.updateRequest.sections.specialties', icon: Star },
  { key: 'motifs', labelKey: 'professionals.updateRequest.sections.motifs', icon: Heart },
  { key: 'photo', labelKey: 'professionals.updateRequest.sections.photo', icon: Camera },
  { key: 'insurance', labelKey: 'professionals.updateRequest.sections.insurance', icon: Shield },
  { key: 'consent', labelKey: 'professionals.updateRequest.sections.consent', icon: FileSignature },
]

export function UpdateRequestModal({ open, onClose, professional }: UpdateRequestModalProps) {
  const { toast } = useToast()
  const [selectedSections, setSelectedSections] = useState<Set<QuestionnaireSection>>(new Set())
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const createUpdateRequest = useCreateUpdateRequest()

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedSections(new Set())
      setGeneratedLink(null)
      setCopied(false)
    }
  }, [open])

  const handleToggleSection = (section: QuestionnaireSection) => {
    setSelectedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    if (selectedSections.size === SECTION_OPTIONS.length) {
      setSelectedSections(new Set())
    } else {
      setSelectedSections(new Set(SECTION_OPTIONS.map((s) => s.key)))
    }
  }

  const handleCreateLink = async () => {
    if (selectedSections.size === 0) return

    try {
      const result = await createUpdateRequest.mutateAsync({
        professional_id: professional.id,
        email: professional.profile?.email || '',
        requested_sections: Array.from(selectedSections),
      })

      const link = `${window.location.origin}/invitation/${result.token}`
      setGeneratedLink(link)

      toast({
        title: t('professionals.updateRequest.toast.created.title'),
        description: t('professionals.updateRequest.toast.created.description'),
      })
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('common.error'),
        variant: 'error',
      })
    }
  }

  const handleCopyLink = async () => {
    if (!generatedLink) return

    await navigator.clipboard.writeText(generatedLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)

    toast({
      title: t('professionals.updateRequest.toast.copied.title'),
      description: t('professionals.updateRequest.toast.copied.description'),
    })
  }

  const handleClose = () => {
    setSelectedSections(new Set())
    setGeneratedLink(null)
    setCopied(false)
    onClose()
  }

  const allSelected = selectedSections.size === SECTION_OPTIONS.length

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('professionals.updateRequest.title')}</DialogTitle>
          <DialogDescription>
            {t('professionals.updateRequest.description')}
          </DialogDescription>
        </DialogHeader>

        {!generatedLink ? (
          <>
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {t('professionals.updateRequest.selectSections')}
                </span>
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                  {allSelected
                    ? t('professionals.updateRequest.deselectAll')
                    : t('professionals.updateRequest.selectAll')}
                </Button>
              </div>

              <div className="grid gap-3">
                {SECTION_OPTIONS.map(({ key, labelKey, icon: Icon }) => (
                  <Label
                    key={key}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedSections.has(key)}
                      onCheckedChange={() => handleToggleSection(key)}
                    />
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span>{t(labelKey as TranslationKey)}</span>
                  </Label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleCreateLink}
                disabled={selectedSections.size === 0 || createUpdateRequest.isPending}
              >
                {createUpdateRequest.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" />
                    {t('professionals.updateRequest.createLink')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-4 overflow-hidden">
              <div className="rounded-lg border bg-muted/50 p-4 overflow-hidden">
                <p className="mb-2 text-sm font-medium">
                  {t('professionals.updateRequest.linkReady')}
                </p>
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <code className="flex-1 min-w-0 truncate rounded bg-background px-2 py-1 text-xs break-all">
                    {generatedLink}
                  </code>
                  <Button size="sm" variant="outline" onClick={handleCopyLink} className="shrink-0">
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                {t('professionals.updateRequest.linkInstructions')}
              </p>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>{t('common.close')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
