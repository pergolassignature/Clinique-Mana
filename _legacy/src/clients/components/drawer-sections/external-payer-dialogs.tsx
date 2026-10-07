import { useState, useEffect } from 'react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Checkbox } from '@/shared/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import {
  useCreateIvacPayer,
  useUpdateIvacPayer,
  useCreatePaePayer,
  useUpdatePaePayer,
  useDeactivateExternalPayer,
  type ClientExternalPayerIvac,
  type ClientExternalPayerPae,
  type PAECoverageRule,
} from '@/external-payers'
import { CoverageRuleBuilder } from '@/external-payers/components/coverage-rule-builder'

// =============================================================================
// ADD EXTERNAL PAYER DIALOG
// =============================================================================

interface AddExternalPayerDialogProps {
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  hasIvac: boolean
  hasPae: boolean
}

export function AddExternalPayerDialog({
  clientId,
  open,
  onOpenChange,
  onSuccess,
  hasIvac,
  hasPae,
}: AddExternalPayerDialogProps) {
  const [selectedType, setSelectedType] = useState<'ivac' | 'pae' | null>(null)

  useEffect(() => {
    if (open) {
      setSelectedType(null)
    }
  }, [open])

  const handleSelect = (type: 'ivac' | 'pae') => {
    setSelectedType(type)
  }

  const handleBack = () => {
    setSelectedType(null)
  }

  if (selectedType === 'ivac') {
    return (
      <AddIvacDialog
        clientId={clientId}
        open={open}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        onBack={handleBack}
      />
    )
  }

  if (selectedType === 'pae') {
    return (
      <AddPaeDialog
        clientId={clientId}
        open={open}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        onBack={handleBack}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('externalPayers.add')}</DialogTitle>
          <DialogDescription>{t('externalPayers.selectType')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => handleSelect('ivac')}
            disabled={hasIvac}
            className="w-full p-4 border rounded-lg text-left hover:bg-background-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <h4 className="font-medium">IVAC</h4>
            <p className="text-sm text-foreground-muted mt-1">
              {t('externalPayers.ivac.description')}
            </p>
            {hasIvac && (
              <p className="text-xs text-wine-600 mt-1">{t('externalPayers.alreadyExists')}</p>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSelect('pae')}
            disabled={hasPae}
            className="w-full p-4 border rounded-lg text-left hover:bg-background-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <h4 className="font-medium">PAE</h4>
            <p className="text-sm text-foreground-muted mt-1">
              {t('externalPayers.pae.description')}
            </p>
            {hasPae && (
              <p className="text-xs text-wine-600 mt-1">{t('externalPayers.alreadyExists')}</p>
            )}
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// ADD IVAC DIALOG
// =============================================================================

interface AddIvacDialogProps {
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  onBack: () => void
}

function AddIvacDialog({ clientId, open, onOpenChange, onSuccess, onBack }: AddIvacDialogProps) {
  const createIvac = useCreateIvacPayer()
  const [form, setForm] = useState({
    file_number: '',
    event_date: '',
    expiry_date: '',
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm({ file_number: '', event_date: '', expiry_date: '' })
      setError(null)
    }
  }, [open])

  const handleSave = async () => {
    if (!form.file_number.trim()) {
      setError(t('externalPayers.validation.fileNumberRequired'))
      return
    }

    try {
      await createIvac.mutateAsync({
        client_id: clientId,
        file_number: form.file_number.trim(),
        event_date: form.event_date || null,
        expiry_date: form.expiry_date || null,
      })
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('externalPayers.ivac.addTitle')}</DialogTitle>
          <DialogDescription>{t('externalPayers.ivac.addDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-wine-50 border border-wine-200 rounded text-sm text-wine-700">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="file_number">{t('externalPayers.ivac.fileNumber')} *</Label>
            <Input
              id="file_number"
              value={form.file_number}
              onChange={(e) => setForm({ ...form, file_number: e.target.value })}
              placeholder="ex: IVAC-2024-001234"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event_date">{t('externalPayers.ivac.eventDate')}</Label>
            <Input
              id="event_date"
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiry_date">{t('externalPayers.ivac.expiryDate')}</Label>
            <Input
              id="expiry_date"
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onBack}>
            {t('common.back')}
          </Button>
          <Button onClick={handleSave} disabled={createIvac.isPending}>
            {createIvac.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// EDIT IVAC DIALOG
// =============================================================================

interface EditIvacPayerDialogProps {
  payer: ClientExternalPayerIvac
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function EditIvacPayerDialog({
  payer,
  clientId,
  open,
  onOpenChange,
  onSuccess,
}: EditIvacPayerDialogProps) {
  const updateIvac = useUpdateIvacPayer()
  const deactivatePayer = useDeactivateExternalPayer()
  const [form, setForm] = useState({
    file_number: '',
    event_date: '',
    expiry_date: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)

  useEffect(() => {
    if (open && payer.ivac_details) {
      setForm({
        file_number: payer.ivac_details.file_number || '',
        event_date: payer.ivac_details.event_date?.split('T')[0] || '',
        expiry_date: payer.ivac_details.expiry_date?.split('T')[0] || '',
      })
      setError(null)
    }
  }, [open, payer])

  const handleSave = async () => {
    if (!form.file_number.trim()) {
      setError(t('externalPayers.validation.fileNumberRequired'))
      return
    }

    try {
      await updateIvac.mutateAsync({
        payer_id: payer.id,
        client_id: clientId,
        input: {
          file_number: form.file_number.trim(),
          event_date: form.event_date || null,
          expiry_date: form.expiry_date || null,
        },
      })
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDeactivate = async () => {
    try {
      await deactivatePayer.mutateAsync({
        payer_id: payer.id,
        client_id: clientId,
      })
      setShowDeactivateConfirm(false)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('externalPayers.ivac.editTitle')}</DialogTitle>
            <DialogDescription>{t('externalPayers.ivac.editDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-wine-50 border border-wine-200 rounded text-sm text-wine-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="file_number">{t('externalPayers.ivac.fileNumber')} *</Label>
              <Input
                id="file_number"
                value={form.file_number}
                onChange={(e) => setForm({ ...form, file_number: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="event_date">{t('externalPayers.ivac.eventDate')}</Label>
              <Input
                id="event_date"
                type="date"
                value={form.event_date}
                onChange={(e) => setForm({ ...form, event_date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiry_date">{t('externalPayers.ivac.expiryDate')}</Label>
              <Input
                id="expiry_date"
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="destructive"
              onClick={() => setShowDeactivateConfirm(true)}
              className="sm:mr-auto"
            >
              {t('externalPayers.deactivate')}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={updateIvac.isPending}>
              {updateIvac.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeactivateConfirm} onOpenChange={setShowDeactivateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('externalPayers.deactivateConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('externalPayers.deactivateConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate}>
              {t('externalPayers.deactivate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// =============================================================================
// ADD PAE DIALOG
// =============================================================================

interface AddPaeDialogProps {
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  onBack: () => void
}

function AddPaeDialog({ clientId, open, onOpenChange, onSuccess, onBack }: AddPaeDialogProps) {
  const createPae = useCreatePaePayer()
  const [form, setForm] = useState({
    file_number: '',
    employer_name: '',
    pae_provider_name: '',
    file_opening_fee: false,
    reimbursement_percentage: 100,
    maximum_amount_cents: 0,
    expiry_date: '',
    coverage_rules: [] as PAECoverageRule[],
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm({
        file_number: '',
        employer_name: '',
        pae_provider_name: '',
        file_opening_fee: false,
        reimbursement_percentage: 100,
        maximum_amount_cents: 0,
        expiry_date: '',
        coverage_rules: [],
      })
      setError(null)
    }
  }, [open])

  const handleSave = async () => {
    if (!form.file_number.trim()) {
      setError(t('externalPayers.validation.fileNumberRequired'))
      return
    }
    if (!form.pae_provider_name.trim()) {
      setError(t('externalPayers.validation.paeProviderRequired'))
      return
    }
    if (!form.expiry_date) {
      setError(t('externalPayers.validation.expiryDateRequired'))
      return
    }

    try {
      await createPae.mutateAsync({
        client_id: clientId,
        file_number: form.file_number.trim(),
        employer_name: form.employer_name || null,
        pae_provider_name: form.pae_provider_name.trim(),
        file_opening_fee: form.file_opening_fee,
        reimbursement_percentage: form.reimbursement_percentage,
        maximum_amount_cents: form.maximum_amount_cents,
        expiry_date: form.expiry_date,
        coverage_rules: form.coverage_rules,
      })
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('externalPayers.pae.addTitle')}</DialogTitle>
          <DialogDescription>{t('externalPayers.pae.addDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-wine-50 border border-wine-200 rounded text-sm text-wine-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="file_number">{t('externalPayers.pae.fileNumber')} *</Label>
              <Input
                id="file_number"
                value={form.file_number}
                onChange={(e) => setForm({ ...form, file_number: e.target.value })}
                placeholder="ex: PAE-2024-001234"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pae_provider_name">{t('externalPayers.pae.provider')} *</Label>
              <Input
                id="pae_provider_name"
                value={form.pae_provider_name}
                onChange={(e) => setForm({ ...form, pae_provider_name: e.target.value })}
                placeholder="ex: Morneau Shepell"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employer_name">{t('externalPayers.pae.employer')}</Label>
            <Input
              id="employer_name"
              value={form.employer_name}
              onChange={(e) => setForm({ ...form, employer_name: e.target.value })}
              placeholder="Optionnel"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reimbursement_percentage">
                {t('externalPayers.pae.reimbursementPercentage')}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="reimbursement_percentage"
                  type="number"
                  min={0}
                  max={100}
                  value={form.reimbursement_percentage}
                  onChange={(e) =>
                    setForm({ ...form, reimbursement_percentage: parseInt(e.target.value) || 0 })
                  }
                />
                <span>%</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maximum_amount">{t('externalPayers.pae.maximumAmount')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="maximum_amount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={(form.maximum_amount_cents / 100).toFixed(2)}
                  onChange={(e) =>
                    setForm({ ...form, maximum_amount_cents: Math.round(parseFloat(e.target.value) * 100) || 0 })
                  }
                />
                <span>$</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiry_date">{t('externalPayers.pae.expiryDate')} *</Label>
              <Input
                id="expiry_date"
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="file_opening_fee"
              checked={form.file_opening_fee}
              onCheckedChange={(checked) => setForm({ ...form, file_opening_fee: !!checked })}
            />
            <Label htmlFor="file_opening_fee" className="cursor-pointer">
              {t('externalPayers.pae.fileOpeningFeeIncluded')}
            </Label>
          </div>

          {/* Coverage Rules Builder */}
          <div className="space-y-2">
            <Label>{t('externalPayers.pae.coverageRules')}</Label>
            <CoverageRuleBuilder
              rules={form.coverage_rules}
              onChange={(rules) => setForm({ ...form, coverage_rules: rules })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onBack}>
            {t('common.back')}
          </Button>
          <Button onClick={handleSave} disabled={createPae.isPending}>
            {createPae.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// EDIT PAE DIALOG
// =============================================================================

interface EditPaePayerDialogProps {
  payer: ClientExternalPayerPae
  clientId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function EditPaePayerDialog({
  payer,
  clientId,
  open,
  onOpenChange,
  onSuccess,
}: EditPaePayerDialogProps) {
  const updatePae = useUpdatePaePayer()
  const deactivatePayer = useDeactivateExternalPayer()
  const [form, setForm] = useState({
    file_number: '',
    employer_name: '',
    pae_provider_name: '',
    file_opening_fee: false,
    reimbursement_percentage: 100,
    maximum_amount_cents: 0,
    expiry_date: '',
    coverage_rules: [] as PAECoverageRule[],
  })
  const [error, setError] = useState<string | null>(null)
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false)

  useEffect(() => {
    if (open && payer.pae_details) {
      const details = payer.pae_details
      setForm({
        file_number: details.file_number || '',
        employer_name: details.employer_name || '',
        pae_provider_name: details.pae_provider_name || '',
        file_opening_fee: details.file_opening_fee ?? false,
        reimbursement_percentage: details.reimbursement_percentage ?? 100,
        maximum_amount_cents: details.maximum_amount_cents ?? 0,
        expiry_date: details.expiry_date?.split('T')[0] || '',
        coverage_rules: (details.coverage_rules as PAECoverageRule[]) || [],
      })
      setError(null)
    }
  }, [open, payer])

  const handleSave = async () => {
    if (!form.file_number.trim()) {
      setError(t('externalPayers.validation.fileNumberRequired'))
      return
    }
    if (!form.pae_provider_name.trim()) {
      setError(t('externalPayers.validation.paeProviderRequired'))
      return
    }
    if (!form.expiry_date) {
      setError(t('externalPayers.validation.expiryDateRequired'))
      return
    }

    try {
      await updatePae.mutateAsync({
        payer_id: payer.id,
        client_id: clientId,
        input: {
          file_number: form.file_number.trim(),
          employer_name: form.employer_name || null,
          pae_provider_name: form.pae_provider_name.trim(),
          file_opening_fee: form.file_opening_fee,
          reimbursement_percentage: form.reimbursement_percentage,
          maximum_amount_cents: form.maximum_amount_cents,
          expiry_date: form.expiry_date,
          coverage_rules: form.coverage_rules,
        },
      })
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDeactivate = async () => {
    try {
      await deactivatePayer.mutateAsync({
        payer_id: payer.id,
        client_id: clientId,
      })
      setShowDeactivateConfirm(false)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('externalPayers.pae.editTitle')}</DialogTitle>
            <DialogDescription>{t('externalPayers.pae.editDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-wine-50 border border-wine-200 rounded text-sm text-wine-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="file_number">{t('externalPayers.pae.fileNumber')} *</Label>
                <Input
                  id="file_number"
                  value={form.file_number}
                  onChange={(e) => setForm({ ...form, file_number: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pae_provider_name">{t('externalPayers.pae.provider')} *</Label>
                <Input
                  id="pae_provider_name"
                  value={form.pae_provider_name}
                  onChange={(e) => setForm({ ...form, pae_provider_name: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="employer_name">{t('externalPayers.pae.employer')}</Label>
              <Input
                id="employer_name"
                value={form.employer_name}
                onChange={(e) => setForm({ ...form, employer_name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="reimbursement_percentage">
                  {t('externalPayers.pae.reimbursementPercentage')}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="reimbursement_percentage"
                    type="number"
                    min={0}
                    max={100}
                    value={form.reimbursement_percentage}
                    onChange={(e) =>
                      setForm({ ...form, reimbursement_percentage: parseInt(e.target.value) || 0 })
                    }
                  />
                  <span>%</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maximum_amount">{t('externalPayers.pae.maximumAmount')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="maximum_amount"
                    type="number"
                    min={0}
                    step={0.01}
                    value={(form.maximum_amount_cents / 100).toFixed(2)}
                    onChange={(e) =>
                      setForm({ ...form, maximum_amount_cents: Math.round(parseFloat(e.target.value) * 100) || 0 })
                    }
                  />
                  <span>$</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiry_date">{t('externalPayers.pae.expiryDate')} *</Label>
                <Input
                  id="expiry_date"
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="file_opening_fee"
                checked={form.file_opening_fee}
                onCheckedChange={(checked) => setForm({ ...form, file_opening_fee: !!checked })}
              />
              <Label htmlFor="file_opening_fee" className="cursor-pointer">
                {t('externalPayers.pae.fileOpeningFeeIncluded')}
              </Label>
            </div>

            {/* Coverage Rules Builder */}
            <div className="space-y-2">
              <Label>{t('externalPayers.pae.coverageRules')}</Label>
              <CoverageRuleBuilder
                rules={form.coverage_rules}
                onChange={(rules) => setForm({ ...form, coverage_rules: rules })}
              />
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="destructive"
              onClick={() => setShowDeactivateConfirm(true)}
              className="sm:mr-auto"
            >
              {t('externalPayers.deactivate')}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={updatePae.isPending}>
              {updatePae.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeactivateConfirm} onOpenChange={setShowDeactivateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('externalPayers.deactivateConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('externalPayers.deactivateConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate}>
              {t('externalPayers.deactivate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
