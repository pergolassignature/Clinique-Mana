import { useState, useEffect } from 'react'
import { Pencil } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog'
import type { ClientWithRelations, Sex, Language, Province, RelationType, ClientRelation } from '../../types'
import { AddressAutocomplete } from '@/shared/components/address-autocomplete'
import { SearchableSelect, type SearchableSelectOption } from '@/shared/components/searchable-select'
import { ClientPickerDrawer } from '@/shared/components/client-picker-drawer'
import type { ParsedAddress } from '@/shared/hooks/use-google-places'

// =============================================================================
// EDIT IDENTITY DIALOG
// =============================================================================

interface EditIdentityDialogProps {
  client: ClientWithRelations
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: IdentityFormData) => void
}

export interface IdentityFormData {
  firstName: string
  lastName: string
  sex: Sex | null
  language: Language
  birthday: string | null
}

export function EditIdentityDialog({ client, open, onOpenChange, onSave }: EditIdentityDialogProps) {
  const [form, setForm] = useState<IdentityFormData>({
    firstName: client.firstName,
    lastName: client.lastName,
    sex: client.sex,
    language: client.language,
    birthday: client.birthday,
  })

  useEffect(() => {
    if (open) {
      setForm({
        firstName: client.firstName,
        lastName: client.lastName,
        sex: client.sex,
        language: client.language,
        birthday: client.birthday,
      })
    }
  }, [open, client])

  const handleSave = () => {
    onSave(form)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.identity.title')}</DialogTitle>
          <DialogDescription>{t('clients.edit.identity.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">{t('clients.edit.identity.firstName')}</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">{t('clients.edit.identity.lastName')}</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sex">{t('clients.edit.identity.sex')}</Label>
              <Select
                id="sex"
                value={form.sex || ''}
                onChange={(e) => setForm({ ...form, sex: (e.target.value as Sex) || null })}
              >
                <option value="">{t('clients.edit.identity.sexNotSpecified')}</option>
                <option value="male">{t('clients.sex.male')}</option>
                <option value="female">{t('clients.sex.female')}</option>
                <option value="other">{t('clients.sex.other')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="language">{t('clients.edit.identity.language')}</Label>
              <Select
                id="language"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value as Language })}
              >
                <option value="fr">Francais</option>
                <option value="en">English</option>
                <option value="other">Autre</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="birthday">{t('clients.edit.identity.birthday')}</Label>
            <Input
              id="birthday"
              type="date"
              value={form.birthday?.split('T')[0] || ''}
              onChange={(e) => setForm({ ...form, birthday: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// EDIT CONTACT DIALOG
// =============================================================================

interface EditContactDialogProps {
  client: ClientWithRelations
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: ContactFormData) => void
}

export interface ContactFormData {
  email: string | null
  cellPhoneCountryCode: string
  cellPhone: string | null
  homePhoneCountryCode: string
  homePhone: string | null
  workPhoneCountryCode: string
  workPhone: string | null
  workPhoneExtension: string | null
}

export function EditContactDialog({ client, open, onOpenChange, onSave }: EditContactDialogProps) {
  const [form, setForm] = useState<ContactFormData>({
    email: client.email,
    cellPhoneCountryCode: client.cellPhoneCountryCode,
    cellPhone: client.cellPhone,
    homePhoneCountryCode: client.homePhoneCountryCode,
    homePhone: client.homePhone,
    workPhoneCountryCode: client.workPhoneCountryCode,
    workPhone: client.workPhone,
    workPhoneExtension: client.workPhoneExtension,
  })

  useEffect(() => {
    if (open) {
      setForm({
        email: client.email,
        cellPhoneCountryCode: client.cellPhoneCountryCode,
        cellPhone: client.cellPhone,
        homePhoneCountryCode: client.homePhoneCountryCode,
        homePhone: client.homePhone,
        workPhoneCountryCode: client.workPhoneCountryCode,
        workPhone: client.workPhone,
        workPhoneExtension: client.workPhoneExtension,
      })
    }
  }, [open, client])

  const handleSave = () => {
    onSave(form)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.contact.title')}</DialogTitle>
          <DialogDescription>{t('clients.edit.contact.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('clients.edit.contact.email')}</Label>
            <Input
              id="email"
              type="email"
              value={form.email || ''}
              onChange={(e) => setForm({ ...form, email: e.target.value || null })}
              placeholder="courriel@exemple.com"
            />
          </div>

          <div className="space-y-2">
            <Label>{t('clients.edit.contact.cellPhone')}</Label>
            <div className="flex gap-2">
              <Input
                className="w-20"
                value={form.cellPhoneCountryCode}
                onChange={(e) => setForm({ ...form, cellPhoneCountryCode: e.target.value })}
                placeholder="+1"
              />
              <Input
                className="flex-1"
                value={form.cellPhone || ''}
                onChange={(e) => setForm({ ...form, cellPhone: e.target.value || null })}
                placeholder="514-555-0100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('clients.edit.contact.homePhone')}</Label>
            <div className="flex gap-2">
              <Input
                className="w-20"
                value={form.homePhoneCountryCode}
                onChange={(e) => setForm({ ...form, homePhoneCountryCode: e.target.value })}
                placeholder="+1"
              />
              <Input
                className="flex-1"
                value={form.homePhone || ''}
                onChange={(e) => setForm({ ...form, homePhone: e.target.value || null })}
                placeholder="514-555-0100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('clients.edit.contact.workPhone')}</Label>
            <div className="flex gap-2">
              <Input
                className="w-20"
                value={form.workPhoneCountryCode}
                onChange={(e) => setForm({ ...form, workPhoneCountryCode: e.target.value })}
                placeholder="+1"
              />
              <Input
                className="flex-1"
                value={form.workPhone || ''}
                onChange={(e) => setForm({ ...form, workPhone: e.target.value || null })}
                placeholder="514-555-0100"
              />
              <Input
                className="w-20"
                value={form.workPhoneExtension || ''}
                onChange={(e) => setForm({ ...form, workPhoneExtension: e.target.value || null })}
                placeholder="ext."
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// EDIT ADDRESS DIALOG
// =============================================================================

interface EditAddressDialogProps {
  client: ClientWithRelations
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: AddressFormData) => void
}

export interface AddressFormData {
  streetNumber: string | null
  streetName: string | null
  apartment: string | null
  city: string | null
  province: Province | null
  country: string
  postalCode: string | null
}

export function EditAddressDialog({ client, open, onOpenChange, onSave }: EditAddressDialogProps) {
  const [form, setForm] = useState<AddressFormData>({
    streetNumber: client.streetNumber,
    streetName: client.streetName,
    apartment: client.apartment,
    city: client.city,
    province: client.province,
    country: 'Canada', // Always Canada
    postalCode: client.postalCode,
  })

  useEffect(() => {
    if (open) {
      setForm({
        streetNumber: client.streetNumber,
        streetName: client.streetName,
        apartment: client.apartment,
        city: client.city,
        province: client.province,
        country: 'Canada', // Always Canada
        postalCode: client.postalCode,
      })
    }
  }, [open, client])

  const handleAddressSelect = (parsed: ParsedAddress) => {
    console.log('[EditAddressDialog] Received parsed address:', parsed)
    setForm((prev) => ({
      ...prev,
      streetNumber: parsed.streetNumber,
      streetName: parsed.streetName,
      city: parsed.city,
      province: (parsed.province as Province) || null,
      country: 'Canada', // Always Canada
      postalCode: parsed.postalCode,
      // Keep apartment as it's not in Google results
    }))
  }

  const handleSave = () => {
    onSave(form)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.address.title')}</DialogTitle>
          <DialogDescription>{t('clients.edit.address.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Address Autocomplete */}
          <div className="space-y-2">
            <Label>{t('clients.edit.address.search')}</Label>
            <AddressAutocomplete
              onAddressSelect={handleAddressSelect}
              placeholder="Rechercher une adresse..."
            />
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-foreground-muted">
                ou saisir manuellement
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <Label htmlFor="streetNumber">{t('clients.edit.address.streetNumber')}</Label>
              <Input
                id="streetNumber"
                value={form.streetNumber || ''}
                onChange={(e) => setForm({ ...form, streetNumber: e.target.value || null })}
                placeholder="123"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="streetName">{t('clients.edit.address.streetName')}</Label>
              <Input
                id="streetName"
                value={form.streetName || ''}
                onChange={(e) => setForm({ ...form, streetName: e.target.value || null })}
                placeholder="Rue Exemple"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apartment">{t('clients.edit.address.apartment')}</Label>
            <Input
              id="apartment"
              value={form.apartment || ''}
              onChange={(e) => setForm({ ...form, apartment: e.target.value || null })}
              placeholder="Appartement, suite, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">{t('clients.edit.address.city')}</Label>
              <Input
                id="city"
                value={form.city || ''}
                onChange={(e) => setForm({ ...form, city: e.target.value || null })}
                placeholder="Montreal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="province">{t('clients.edit.address.province')}</Label>
              <Select
                id="province"
                value={form.province || ''}
                onChange={(e) => setForm({ ...form, province: (e.target.value as Province) || null })}
              >
                <option value="">Selectionner...</option>
                <option value="QC">Quebec</option>
                <option value="ON">Ontario</option>
                <option value="BC">Colombie-Britannique</option>
                <option value="AB">Alberta</option>
                <option value="MB">Manitoba</option>
                <option value="SK">Saskatchewan</option>
                <option value="NS">Nouvelle-Ecosse</option>
                <option value="NB">Nouveau-Brunswick</option>
                <option value="NL">Terre-Neuve-et-Labrador</option>
                <option value="PE">Ile-du-Prince-Edouard</option>
                <option value="NT">Territoires du Nord-Ouest</option>
                <option value="YT">Yukon</option>
                <option value="NU">Nunavut</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="postalCode">{t('clients.edit.address.postalCode')}</Label>
              <Input
                id="postalCode"
                value={form.postalCode || ''}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value || null })}
                placeholder="H2X 1Y4"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">{t('clients.edit.address.country')}</Label>
              <Input
                id="country"
                value="Canada"
                disabled
                className="bg-background-secondary"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// EDIT PROFESSIONAL DIALOG
// =============================================================================

interface EditProfessionalDialogProps {
  client: ClientWithRelations
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (professionalId: string | null) => void
  professionals: { id: string; displayName: string }[]
}

export function EditProfessionalDialog({ client, open, onOpenChange, onSave, professionals }: EditProfessionalDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(client.primaryProfessionalId)

  useEffect(() => {
    if (open) {
      setSelectedId(client.primaryProfessionalId)
    }
  }, [open, client.primaryProfessionalId])

  const handleSave = () => {
    onSave(selectedId)
    onOpenChange(false)
  }

  // Convert professionals to SearchableSelect options
  const professionalOptions: SearchableSelectOption[] = [
    { value: '', label: 'Aucun professionnel assigne' },
    ...professionals.map((pro) => ({
      value: pro.id,
      label: pro.displayName,
    })),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.professional.title')}</DialogTitle>
          <DialogDescription>{t('clients.edit.professional.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('clients.edit.professional.select')}</Label>
            <SearchableSelect
              options={professionalOptions}
              value={selectedId || ''}
              onValueChange={(value) => setSelectedId(value || null)}
              placeholder="Aucun professionnel assigne"
              searchPlaceholder="Rechercher un professionnel..."
              emptyMessage="Aucun professionnel trouve."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// EDIT TAGS DIALOG
// =============================================================================

interface EditTagsDialogProps {
  client: ClientWithRelations
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (tags: string[]) => void
  availableTags: string[]
}

export function EditTagsDialog({ client, open, onOpenChange, onSave, availableTags }: EditTagsDialogProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>(client.tags)
  const [newTag, setNewTag] = useState('')

  useEffect(() => {
    if (open) {
      setSelectedTags(client.tags)
      setNewTag('')
    }
  }, [open, client.tags])

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag))
    } else {
      setSelectedTags([...selectedTags, tag])
    }
  }

  const addNewTag = () => {
    if (newTag.trim() && !selectedTags.includes(newTag.trim())) {
      setSelectedTags([...selectedTags, newTag.trim()])
      setNewTag('')
    }
  }

  const handleSave = () => {
    onSave(selectedTags)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.tags.title')}</DialogTitle>
          <DialogDescription>{t('clients.edit.tags.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Available tags */}
          <div className="space-y-2">
            <Label>{t('clients.edit.tags.available')}</Label>
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    selectedTags.includes(tag)
                      ? 'bg-sage-100 border-sage-300 text-sage-700'
                      : 'border-border hover:bg-background-secondary'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Add new tag */}
          <div className="space-y-2">
            <Label htmlFor="newTag">{t('clients.edit.tags.addNew')}</Label>
            <div className="flex gap-2">
              <Input
                id="newTag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Nouveau tag..."
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addNewTag())}
              />
              <Button type="button" variant="outline" onClick={addNewTag}>
                Ajouter
              </Button>
            </div>
          </div>

          {/* Selected tags */}
          {selectedTags.length > 0 && (
            <div className="space-y-2">
              <Label>{t('clients.edit.tags.selected')}</Label>
              <div className="flex flex-wrap gap-2">
                {selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full bg-sage-100 text-sage-700"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className="hover:text-sage-900"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// ADD NOTE DIALOG
// =============================================================================

interface AddNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (content: string) => void
}

export function AddNoteDialog({ open, onOpenChange, onSave }: AddNoteDialogProps) {
  const [content, setContent] = useState('')

  useEffect(() => {
    if (open) {
      setContent('')
    }
  }, [open])

  const handleSave = () => {
    if (content.trim()) {
      onSave(content.trim())
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.note.title')}</DialogTitle>
          <DialogDescription>{t('clients.edit.note.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="noteContent">{t('clients.edit.note.content')}</Label>
            <Textarea
              id="noteContent"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Entrez votre note ici..."
              rows={5}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!content.trim()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// ADD CONSENT DIALOG
// =============================================================================

interface AddConsentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: ConsentFormData) => void
}

export interface ConsentFormData {
  type: string
  signedAt: string | null
  expiresAt: string | null
  signedBy: string | null
}

const CONSENT_TYPES = [
  'Consentement aux soins',
  'Consentement parental',
  'Consentement pour mineur',
  'Consentement telepsychologie',
  'Autorisation de communication',
]

export function AddConsentDialog({ open, onOpenChange, onSave }: AddConsentDialogProps) {
  const [form, setForm] = useState<ConsentFormData>({
    type: '',
    signedAt: null,
    expiresAt: null,
    signedBy: null,
  })

  useEffect(() => {
    if (open) {
      setForm({
        type: '',
        signedAt: null,
        expiresAt: null,
        signedBy: null,
      })
    }
  }, [open])

  const handleSave = () => {
    if (form.type) {
      onSave(form)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.consent.title')}</DialogTitle>
          <DialogDescription>{t('clients.edit.consent.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="consentType">{t('clients.edit.consent.type')}</Label>
            <Select
              id="consentType"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="">Selectionner un type...</option>
              {CONSENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signedAt">{t('clients.edit.consent.signedAt')}</Label>
            <Input
              id="signedAt"
              type="date"
              value={form.signedAt?.split('T')[0] || ''}
              onChange={(e) => setForm({ ...form, signedAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiresAt">{t('clients.edit.consent.expiresAt')}</Label>
            <Input
              id="expiresAt"
              type="date"
              value={form.expiresAt?.split('T')[0] || ''}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signedBy">{t('clients.edit.consent.signedBy')}</Label>
            <Input
              id="signedBy"
              value={form.signedBy || ''}
              onChange={(e) => setForm({ ...form, signedBy: e.target.value || null })}
              placeholder="Nom du signataire"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!form.type}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================================================
// EDIT BUTTON COMPONENT (reusable)
// =============================================================================

interface EditButtonProps {
  onClick: () => void
  label?: string
}

export function EditButton({ onClick, label }: EditButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="h-7 px-2 text-foreground-muted hover:text-foreground"
    >
      <Pencil className="h-3.5 w-3.5" />
      {label && <span className="ml-1">{label}</span>}
    </Button>
  )
}

// =============================================================================
// ADD RELATION DIALOG
// =============================================================================

interface AddRelationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: { relatedClientId: string; relatedClientName: string; relationType: RelationType; notes?: string }) => void
  excludeClientIds?: string[]
}

const RELATION_TYPES: RelationType[] = ['parent', 'child', 'spouse', 'sibling', 'guardian', 'other']

// Mock clients for relation picker (in real app, this would be fetched)
const MOCK_CLIENTS_FOR_PICKER = [
  { clientId: 'CLI-0000001', firstName: 'Marie-Claire', lastName: 'Tremblay' },
  { clientId: 'CLI-0000002', firstName: 'Jean-Philippe', lastName: 'Gagnon' },
  { clientId: 'CLI-0000003', firstName: 'Sophie', lastName: 'Lavoie' },
  { clientId: 'CLI-0000004', firstName: 'Pierre-Luc', lastName: 'Pelletier' },
  { clientId: 'CLI-0000005', firstName: 'Isabelle', lastName: 'Côté' },
  { clientId: 'CLI-0000006', firstName: 'François', lastName: 'Dubois' },
  { clientId: 'CLI-0000007', firstName: 'Stéphane', lastName: 'Belanger' },
]

export function AddRelationDialog({ open, onOpenChange, onSave, excludeClientIds = [] }: AddRelationDialogProps) {
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedClientName, setSelectedClientName] = useState('')
  const [relationType, setRelationType] = useState<RelationType | ''>('')
  const [notes, setNotes] = useState('')
  const [clientPickerOpen, setClientPickerOpen] = useState(false)

  const availableClients = MOCK_CLIENTS_FOR_PICKER.filter(
    (c) => !excludeClientIds.includes(c.clientId)
  )

  // Convert clients to SearchableSelect options
  const clientOptions: SearchableSelectOption[] = availableClients.map((client) => ({
    value: client.clientId,
    label: `${client.firstName} ${client.lastName}`,
    description: client.clientId,
  }))

  // Convert relation types to SearchableSelect options
  const relationTypeOptions: SearchableSelectOption[] = RELATION_TYPES.map((type) => ({
    value: type,
    label: t(`clients.drawer.relations.types.${type}` as Parameters<typeof t>[0]),
  }))

  useEffect(() => {
    if (open) {
      setSelectedClientId('')
      setSelectedClientName('')
      setRelationType('')
      setNotes('')
    }
  }, [open])

  const handleClientSelect = (clientId: string) => {
    const selectedClient = availableClients.find((c) => c.clientId === clientId)
    if (selectedClient) {
      setSelectedClientId(clientId)
      setSelectedClientName(`${selectedClient.firstName} ${selectedClient.lastName}`)
    }
  }

  // Handle client selection from ClientPickerDrawer
  const handleClientPickerSelect = (client: { id: string; firstName: string; lastName: string }) => {
    setSelectedClientId(client.id)
    setSelectedClientName(`${client.firstName} ${client.lastName}`)
  }

  // Handle new client creation from ClientPickerDrawer
  const handleClientCreate = (clientData: { firstName: string; lastName: string }) => {
    // In real app, this would create the client and return the ID
    // For now, we'll just use a temporary ID and the name
    const tempId = `CLI-NEW-${Date.now()}`
    setSelectedClientId(tempId)
    setSelectedClientName(`${clientData.firstName} ${clientData.lastName}`)
  }

  const handleSave = () => {
    if (selectedClientId && selectedClientName && relationType) {
      onSave({
        relatedClientId: selectedClientId,
        relatedClientName: selectedClientName,
        relationType: relationType as RelationType,
        notes: notes || undefined,
      })
      onOpenChange(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('clients.edit.relation.addTitle')}</DialogTitle>
            <DialogDescription>{t('clients.edit.relation.addDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('clients.edit.relation.selectClient')}</Label>
              <SearchableSelect
                options={clientOptions}
                value={selectedClientId}
                onValueChange={handleClientSelect}
                placeholder={t('clients.edit.relation.selectClientPlaceholder')}
                searchPlaceholder="Rechercher un client..."
                emptyMessage="Aucun client trouve."
                onCreateNew={() => setClientPickerOpen(true)}
                createNewLabel={t('clients.edit.relation.createNewClient')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('clients.edit.relation.type')}</Label>
              <SearchableSelect
                options={relationTypeOptions}
                value={relationType}
                onValueChange={(value) => setRelationType(value as RelationType | '')}
                placeholder={t('clients.edit.relation.typePlaceholder')}
                searchPlaceholder="Rechercher un type..."
                emptyMessage="Aucun type trouve."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="relationNotes">{t('clients.edit.relation.notes')}</Label>
              <Textarea
                id="relationNotes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('clients.edit.relation.notesPlaceholder')}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!selectedClientId || !relationType}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Client Picker Drawer for creating new contacts */}
      <ClientPickerDrawer
        open={clientPickerOpen}
        onOpenChange={setClientPickerOpen}
        onSelectClient={handleClientPickerSelect}
        onCreateClient={handleClientCreate}
        excludeClientIds={excludeClientIds}
      />
    </>
  )
}

// =============================================================================
// EDIT RELATION DIALOG
// =============================================================================

interface EditRelationDialogProps {
  relation: ClientRelation
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: { relationType: RelationType; notes?: string }) => void
}

export function EditRelationDialog({ relation, open, onOpenChange, onSave }: EditRelationDialogProps) {
  const [relationType, setRelationType] = useState<RelationType>(relation.relationType)
  const [notes, setNotes] = useState(relation.notes || '')

  // Convert relation types to SearchableSelect options
  const relationTypeOptions: SearchableSelectOption[] = RELATION_TYPES.map((type) => ({
    value: type,
    label: t(`clients.drawer.relations.types.${type}` as Parameters<typeof t>[0]),
  }))

  useEffect(() => {
    if (open) {
      setRelationType(relation.relationType)
      setNotes(relation.notes || '')
    }
  }, [open, relation])

  const handleSave = () => {
    onSave({
      relationType,
      notes: notes || undefined,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clients.edit.relation.editTitle')}</DialogTitle>
          <DialogDescription>
            {t('clients.edit.relation.editDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('clients.edit.relation.relatedClient')}</Label>
            <Input value={relation.relatedClientName} disabled className="bg-background-secondary" />
          </div>

          <div className="space-y-2">
            <Label>{t('clients.edit.relation.type')}</Label>
            <SearchableSelect
              options={relationTypeOptions}
              value={relationType}
              onValueChange={(value) => setRelationType(value as RelationType)}
              placeholder={t('clients.edit.relation.typePlaceholder')}
              searchPlaceholder="Rechercher un type..."
              emptyMessage="Aucun type trouve."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editRelationNotes">{t('clients.edit.relation.notes')}</Label>
            <Textarea
              id="editRelationNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('clients.edit.relation.notesPlaceholder')}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
