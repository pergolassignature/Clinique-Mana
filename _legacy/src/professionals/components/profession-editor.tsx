// src/professionals/components/profession-editor.tsx

import { useState } from 'react'
import { Plus, Trash2, Loader2, Check, X, Star, StarOff } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Badge } from '@/shared/ui/badge'
import { useToast } from '@/shared/hooks/use-toast'
import {
  useProfessionTitles,
  useAddProfession,
  useUpdateProfession,
  useRemoveProfession,
} from '../hooks'
import type { ProfessionalProfession, ProfessionTitle } from '../types'

interface ProfessionEditorProps {
  professionalId: string
  professions: ProfessionalProfession[]
}

export function ProfessionEditor({ professionalId, professions }: ProfessionEditorProps) {
  const { toast } = useToast()
  const { data: allTitles = [] } = useProfessionTitles()

  const addProfession = useAddProfession()
  const updateProfession = useUpdateProfession()
  const removeProfession = useRemoveProfession()

  const [isAdding, setIsAdding] = useState(false)
  const [newTitleKey, setNewTitleKey] = useState('')
  const [newLicenseNumber, setNewLicenseNumber] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLicenseNumber, setEditLicenseNumber] = useState('')

  // Get profession titles that aren't already assigned
  const availableTitles = allTitles.filter(
    (title) => !professions.some((p) => p.profession_title_key === title.key)
  )

  const canAddMore = professions.length < 2

  const handleAdd = async () => {
    if (!newTitleKey || !newLicenseNumber.trim()) {
      toast({
        title: t('professionals.detail.professionEditor.toast.fieldsRequired.title'),
        description: t('professionals.detail.professionEditor.toast.fieldsRequired.description'),
        variant: 'error',
      })
      return
    }

    try {
      await addProfession.mutateAsync({
        professional_id: professionalId,
        profession_title_key: newTitleKey,
        license_number: newLicenseNumber.trim(),
        is_primary: professions.length === 0,
      })
      toast({ title: t('professionals.detail.professionEditor.toast.titleAdded') })
      setIsAdding(false)
      setNewTitleKey('')
      setNewLicenseNumber('')
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err instanceof Error ? err.message : t('professionals.detail.professionEditor.toast.error.addTitle'),
        variant: 'error',
      })
    }
  }

  const handleUpdateLicense = async (profession: ProfessionalProfession) => {
    if (!editLicenseNumber.trim()) {
      toast({
        title: t('professionals.detail.professionEditor.toast.licenseRequired'),
        variant: 'error',
      })
      return
    }

    try {
      await updateProfession.mutateAsync({
        id: profession.id,
        professional_id: professionalId,
        updates: { license_number: editLicenseNumber.trim() },
      })
      toast({ title: t('professionals.detail.professionEditor.toast.licenseUpdated') })
      setEditingId(null)
      setEditLicenseNumber('')
    } catch {
      toast({
        title: t('common.error'),
        description: t('professionals.detail.professionEditor.toast.error.updateLicense'),
        variant: 'error',
      })
    }
  }

  const handleSetPrimary = async (profession: ProfessionalProfession) => {
    if (profession.is_primary) return

    try {
      await updateProfession.mutateAsync({
        id: profession.id,
        professional_id: professionalId,
        updates: { is_primary: true },
      })
      toast({ title: t('professionals.detail.professionEditor.toast.primaryUpdated') })
    } catch {
      toast({
        title: t('common.error'),
        description: t('professionals.detail.professionEditor.toast.error.setPrimary'),
        variant: 'error',
      })
    }
  }

  const handleRemove = async (profession: ProfessionalProfession) => {
    try {
      await removeProfession.mutateAsync({
        id: profession.id,
        professional_id: professionalId,
      })
      toast({ title: t('professionals.detail.professionEditor.toast.titleRemoved') })
    } catch {
      toast({
        title: t('common.error'),
        description: t('professionals.detail.professionEditor.toast.error.removeTitle'),
        variant: 'error',
      })
    }
  }

  const startEdit = (profession: ProfessionalProfession) => {
    setEditingId(profession.id)
    setEditLicenseNumber(profession.license_number)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditLicenseNumber('')
  }

  return (
    <div className="space-y-3">
      {/* Existing professions */}
      {professions.map((profession) => {
        const title = profession.profession_title as ProfessionTitle | undefined
        const isEditing = editingId === profession.id

        return (
          <div
            key={profession.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-background-secondary/30 p-3"
          >
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {title?.label_fr || profession.profession_title_key}
                </span>
                {profession.is_primary && (
                  <Badge variant="default" className="text-xs">
                    {t('professionals.detail.professionEditor.primaryBadge')}
                  </Badge>
                )}
              </div>

              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editLicenseNumber}
                    onChange={(e) => setEditLicenseNumber(e.target.value)}
                    placeholder={t('professionals.detail.professionEditor.licensePlaceholder')}
                    className="h-8 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdateLicense(profession)
                      if (e.key === 'Escape') cancelEdit()
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleUpdateLicense(profession)}
                    disabled={updateProfession.isPending}
                    className="h-8 w-8 p-0"
                  >
                    {updateProfession.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 text-sage-600" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelEdit}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4 text-foreground-muted" />
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => startEdit(profession)}
                  className="text-xs text-foreground-muted hover:text-foreground transition-colors"
                >
                  {t('professionals.detail.professionEditor.licensePrefix')} {profession.license_number}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* Set as primary button (only show if not primary and there are 2 professions) */}
              {!profession.is_primary && professions.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleSetPrimary(profession)}
                  disabled={updateProfession.isPending}
                  className="h-8 w-8 p-0 text-foreground-muted hover:text-honey-600"
                  title={t('professionals.detail.professionEditor.setPrimaryTitle')}
                >
                  <StarOff className="h-4 w-4" />
                </Button>
              )}
              {profession.is_primary && professions.length > 1 && (
                <div className="h-8 w-8 flex items-center justify-center">
                  <Star className="h-4 w-4 text-honey-500" />
                </div>
              )}

              {/* Remove button */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemove(profession)}
                disabled={removeProfession.isPending}
                className="h-8 w-8 p-0 text-foreground-muted hover:text-wine-600"
              >
                {removeProfession.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )
      })}

      {/* Add new profession form */}
      {isAdding ? (
        <div className="rounded-xl border border-sage-200 bg-sage-50/30 p-3 space-y-3">
          <Select
            value={newTitleKey}
            onChange={(e) => setNewTitleKey(e.target.value)}
            className="h-9"
          >
            <option value="">{t('professionals.detail.professionEditor.selectTitle')}</option>
            {availableTitles.map((title) => (
              <option key={title.key} value={title.key}>
                {title.label_fr}
              </option>
            ))}
          </Select>

          <Input
            value={newLicenseNumber}
            onChange={(e) => setNewLicenseNumber(e.target.value)}
            placeholder={t('professionals.detail.professionEditor.licensePlaceholder')}
            className="h-9"
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={addProfession.isPending || !newTitleKey || !newLicenseNumber.trim()}
              className="flex-1"
            >
              {addProfession.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('professionals.detail.professionEditor.addButton')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsAdding(false)
                setNewTitleKey('')
                setNewLicenseNumber('')
              }}
            >
              {t('professionals.detail.professionEditor.cancelButton')}
            </Button>
          </div>
        </div>
      ) : canAddMore ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAdding(true)}
          className="w-full"
          disabled={availableTitles.length === 0}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          {professions.length === 0
            ? t('professionals.detail.professionEditor.addFirstTitle')
            : t('professionals.detail.professionEditor.addSecondTitle')}
        </Button>
      ) : (
        <p className="text-xs text-foreground-muted text-center">
          {t('professionals.detail.professionEditor.maxReached')}
        </p>
      )}
    </div>
  )
}
