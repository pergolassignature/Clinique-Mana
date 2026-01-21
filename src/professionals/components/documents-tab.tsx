import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  Upload,
  Download,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  MoreVertical,
  X,
  Loader2,
  Eye,
  Image,
  Shield,
  FileCheck,
  File,
  Info,
} from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { supabase } from '@/lib/supabaseClient'
import type {
  ProfessionalWithRelations,
  ProfessionalDocument,
  DocumentType,
} from '../types'
import {
  useProfessionalDocuments,
  useUploadDocument,
  useVerifyDocument,
  useUpdateDocumentExpiry,
  useDeleteDocument,
} from '../hooks'
import { getDocumentDownloadUrl } from '../api'
import {
  REQUIRED_DOCUMENTS,
  mapRequiredDocumentsState,
  type RequiredDocumentState,
} from '../mappers'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import { useQueryClient } from '@tanstack/react-query'
import { professionalKeys } from '../hooks'

interface ProfessionalDocumentsTabProps {
  professional: ProfessionalWithRelations
}

const ALL_DOCUMENT_TYPES: DocumentType[] = [
  'photo',
  'insurance',
  'license',
  'cv',
  'diploma',
  'fiche',
  'other',
]

const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return formatClinicDateShort(dateStr)
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function getDocumentIcon(type: DocumentType) {
  switch (type) {
    case 'photo':
      return <Image className="h-5 w-5" />
    case 'insurance':
      return <Shield className="h-5 w-5" />
    case 'license':
      return <FileCheck className="h-5 w-5" />
    case 'cv':
      return <FileText className="h-5 w-5" />
    default:
      return <File className="h-5 w-5" />
  }
}

function RequiredBadge() {
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <AlertCircle className="h-3 w-3" />
      Requis
    </Badge>
  )
}

// Upload dialog component
function UploadDialog({
  isOpen,
  onClose,
  professionalId,
  preselectedType,
}: {
  isOpen: boolean
  onClose: () => void
  professionalId: string
  preselectedType?: DocumentType
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedType, setSelectedType] = useState<DocumentType>(preselectedType || 'cv')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [expiryDate, setExpiryDate] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uploadDocument = useUploadDocument()
  const queryClient = useQueryClient()

  // Update selected type when preselectedType changes
  useState(() => {
    if (preselectedType) {
      setSelectedType(preselectedType)
    }
  })

  const resetForm = () => {
    setSelectedType(preselectedType || 'cv')
    setSelectedFile(null)
    setExpiryDate('')
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError('Le fichier dépasse la taille maximale de 10 Mo')
      return
    }

    setSelectedFile(file)
    setError(null)
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    setError(null)

    try {
      const ext = selectedFile.name.split('.').pop()?.toLowerCase() || 'bin'
      const uuid = crypto.randomUUID()
      const filePath = `professionals/${professionalId}/${selectedType}/${uuid}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('professional-documents')
        .upload(filePath, selectedFile, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      await uploadDocument.mutateAsync({
        professional_id: professionalId,
        document_type: selectedType,
        file_name: selectedFile.name,
        file_path: filePath,
        file_size: selectedFile.size,
        mime_type: selectedFile.type,
        expires_at: expiryDate || undefined,
      })

      queryClient.invalidateQueries({ queryKey: professionalKeys.documents(professionalId) })
      queryClient.invalidateQueries({ queryKey: professionalKeys.detail(professionalId) })

      resetForm()
      onClose()
    } catch (err) {
      console.error('Upload failed:', err)
      setError(err instanceof Error ? err.message : 'Échec du téléversement')
    } finally {
      setIsUploading(false)
    }
  }

  const handleClose = () => {
    if (!isUploading) {
      resetForm()
      onClose()
    }
  }

  // Determine if selected type has expiry requirement
  const requiresExpiry = REQUIRED_DOCUMENTS.find(d => d.type === selectedType)?.hasExpiry

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Téléverser un document</DialogTitle>
          <DialogDescription>
            Formats acceptés: PDF, Word, JPEG, PNG, WebP. Taille max: 10 Mo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Document type */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Type de document
            </label>
            <Select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as DocumentType)}
              disabled={isUploading || !!preselectedType}
            >
              {ALL_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`professionals.documents.types.${type}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </Select>
          </div>

          {/* File input */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Fichier
            </label>
            <div
              className={`
                relative rounded-xl border-2 border-dashed p-6 text-center cursor-pointer
                transition-colors
                ${selectedFile ? 'border-sage-300 bg-sage-50' : 'border-border hover:border-sage-300'}
              `}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                onChange={handleFileSelect}
                className="hidden"
                disabled={isUploading}
              />

              {selectedFile ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="h-8 w-8 text-sage-500" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{selectedFile.name}</p>
                    <p className="text-xs text-foreground-muted">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedFile(null)
                      if (fileInputRef.current) {
                        fileInputRef.current.value = ''
                      }
                    }}
                    disabled={isUploading}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="mx-auto h-8 w-8 text-foreground-muted" />
                  <p className="mt-2 text-sm text-foreground-muted">
                    Cliquez pour sélectionner un fichier
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Expiry date */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm font-medium">
                Date d'expiration
              </label>
              {requiresExpiry && (
                <Badge variant="warning" className="text-xs">Recommandé</Badge>
              )}
            </div>
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              disabled={isUploading}
            />
            <p className="mt-1 text-xs text-foreground-muted">
              Laissez vide si le document n'expire pas
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-wine-50 p-3 text-sm text-wine-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            Annuler
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Téléversement...
              </>
            ) : (
              'Téléverser'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Expiry edit dialog
function ExpiryDialog({
  isOpen,
  onClose,
  document,
}: {
  isOpen: boolean
  onClose: () => void
  document: ProfessionalDocument | null
}) {
  const [expiryDate, setExpiryDate] = useState(
    document?.expires_at ? document.expires_at.split('T')[0] : ''
  )
  const updateExpiry = useUpdateDocumentExpiry()

  const handleSave = async () => {
    if (!document) return

    try {
      await updateExpiry.mutateAsync({
        id: document.id,
        expires_at: expiryDate ? new Date(expiryDate).toISOString() : null,
      })
      onClose()
    } catch (err) {
      console.error('Failed to update expiry:', err)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier la date d'expiration</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <label className="text-sm font-medium mb-2 block">
            Date d'expiration
          </label>
          <Input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
          <p className="mt-2 text-xs text-foreground-muted">
            Laissez vide pour retirer la date d'expiration.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={updateExpiry.isPending}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Delete confirmation dialog
function DeleteDialog({
  isOpen,
  onClose,
  document,
  professionalId,
}: {
  isOpen: boolean
  onClose: () => void
  document: ProfessionalDocument | null
  professionalId: string
}) {
  const deleteDocumentMutation = useDeleteDocument()
  const queryClient = useQueryClient()

  const handleDelete = async () => {
    if (!document) return

    try {
      await deleteDocumentMutation.mutateAsync(document.id)
      queryClient.invalidateQueries({ queryKey: professionalKeys.documents(professionalId) })
      queryClient.invalidateQueries({ queryKey: professionalKeys.detail(professionalId) })
      onClose()
    } catch (err) {
      console.error('Failed to delete document:', err)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer le document</DialogTitle>
          <DialogDescription>
            Cette action est irréversible. Le document sera définitivement supprimé.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteDocumentMutation.isPending}
          >
            {deleteDocumentMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Supprimer'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Required document card - shows even when empty
function RequiredDocumentCard({
  state,
  onUpload,
  onVerify,
  onEditExpiry,
  onDelete,
}: {
  state: RequiredDocumentState
  onUpload: (type: DocumentType) => void
  onVerify: (doc: ProfessionalDocument, verified: boolean) => void
  onEditExpiry: (doc: ProfessionalDocument) => void
  onDelete: (doc: ProfessionalDocument) => void
}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const { config, status, document } = state

  const handleDownload = async () => {
    if (!document) return
    setIsDownloading(true)
    try {
      const url = await getDocumentDownloadUrl(document.file_path)
      window.open(url, '_blank')
    } catch (err) {
      console.error('Failed to get download URL:', err)
    } finally {
      setIsDownloading(false)
    }
  }

  const getStatusBadge = () => {
    switch (status) {
      case 'verified':
        return (
          <Badge variant="success" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            Vérifié
          </Badge>
        )
      case 'pending':
        return (
          <Badge variant="warning" className="gap-1">
            <Clock className="h-3 w-3" />
            En attente
          </Badge>
        )
      case 'expired':
        return (
          <Badge variant="error" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Expiré
          </Badge>
        )
      case 'missing':
        return (
          <Badge variant="outline" className="gap-1 text-wine-600 border-wine-200">
            <AlertCircle className="h-3 w-3" />
            Manquant
          </Badge>
        )
    }
  }

  const cardClass = status === 'missing'
    ? 'border-dashed border-wine-200 bg-wine-50/30'
    : status === 'expired'
      ? 'border-wine-200 bg-wine-50/30'
      : status === 'verified'
        ? 'border-sage-200 bg-sage-50/30'
        : ''

  return (
    <Card className={cardClass}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                status === 'missing'
                  ? 'bg-wine-100 text-wine-600'
                  : status === 'expired'
                    ? 'bg-wine-100 text-wine-600'
                    : status === 'verified'
                      ? 'bg-sage-100 text-sage-600'
                      : 'bg-honey-100 text-honey-600'
              }`}
            >
              {getDocumentIcon(config.type)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{config.labelFr}</CardTitle>
                {config.isRequired && <RequiredBadge />}
              </div>
              <CardDescription className="mt-0.5">
                {config.descriptionFr}
              </CardDescription>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent>
        {/* Document details if present */}
        {document && (
          <div className="mb-4 space-y-2 rounded-lg bg-background p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Fichier</span>
              <span className="font-medium truncate max-w-[200px]">{document.file_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Taille</span>
              <span>{formatFileSize(document.file_size)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Téléversé le</span>
              <span>{formatDate(document.created_at)}</span>
            </div>
            {document.verified_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Vérifié le</span>
                <span>{formatDate(document.verified_at)}</span>
              </div>
            )}
            {document.expires_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Expire le</span>
                <span className={status === 'expired' ? 'text-wine-600 font-medium' : ''}>
                  {formatDate(document.expires_at)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Electronic consent details (signed via questionnaire, no file) */}
        {!document && state.consentSource === 'questionnaire' && (
          <div className="mb-4 space-y-2 rounded-lg bg-sage-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Type</span>
              <Badge variant="outline" className="text-sage-600 border-sage-300">
                Signature électronique
              </Badge>
            </div>
            {state.consentSignerName && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Signataire</span>
                <span className="font-medium">{state.consentSignerName}</span>
              </div>
            )}
            {state.consentSignedAt && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Signé le</span>
                <span>{formatDate(state.consentSignedAt)}</span>
              </div>
            )}
            {state.expiresAt && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Expire le</span>
                <span className={status === 'expired' ? 'text-wine-600 font-medium' : ''}>
                  {formatDate(state.expiresAt)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Info banner for consent document */}
        {config.autoRenew && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-background-secondary/50 p-3 text-sm">
            <Info className="h-4 w-4 text-foreground-muted mt-0.5 shrink-0" />
            <div className="text-foreground-muted">
              <p>Valide {config.expiryMonths} mois avec renouvellement automatique.</p>
              {config.withdrawalNoticeMonths && (
                <p className="mt-1">Préavis de retrait : {config.withdrawalNoticeMonths} mois.</p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {status === 'missing' ? (
            <Button onClick={() => onUpload(config.type)}>
              <Upload className="h-4 w-4" />
              Téléverser
            </Button>
          ) : state.consentSource === 'questionnaire' && !document ? (
            // Electronic consent - no file actions needed, just show status
            <p className="text-sm text-foreground-muted italic">
              Consentement signé électroniquement via le questionnaire
            </p>
          ) : (
            <>
              <Button variant="outline" onClick={handleDownload} disabled={isDownloading}>
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Aperçu
              </Button>

              {status === 'pending' && document && (
                <Button onClick={() => onVerify(document, true)}>
                  <CheckCircle className="h-4 w-4" />
                  Vérifier
                </Button>
              )}

              {status === 'expired' && (
                <Button onClick={() => onUpload(config.type)}>
                  <Upload className="h-4 w-4" />
                  Remplacer
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleDownload}>
                    <Download className="h-4 w-4 mr-2" />
                    Télécharger
                  </DropdownMenuItem>

                  {status === 'verified' && document && (
                    <DropdownMenuItem onClick={() => onVerify(document, false)}>
                      <X className="h-4 w-4 mr-2" />
                      Retirer la vérification
                    </DropdownMenuItem>
                  )}

                  {document && (
                    <DropdownMenuItem onClick={() => onEditExpiry(document)}>
                      <Calendar className="h-4 w-4 mr-2" />
                      Modifier l'expiration
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem onClick={() => onUpload(config.type)}>
                    <Upload className="h-4 w-4 mr-2" />
                    Remplacer
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {document && (
                    <DropdownMenuItem
                      onClick={() => onDelete(document)}
                      className="text-wine-600"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Supprimer
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Other document card - for non-required documents
function OtherDocumentCard({
  document,
  onVerify,
  onEditExpiry,
  onDelete,
}: {
  document: ProfessionalDocument
  onVerify: (doc: ProfessionalDocument, verified: boolean) => void
  onEditExpiry: (doc: ProfessionalDocument) => void
  onDelete: (doc: ProfessionalDocument) => void
}) {
  const [isDownloading, setIsDownloading] = useState(false)

  const status = document.expires_at && new Date(document.expires_at) < new Date()
    ? 'expired'
    : document.verified_at
      ? 'verified'
      : 'pending'

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const url = await getDocumentDownloadUrl(document.file_path)
      window.open(url, '_blank')
    } catch (err) {
      console.error('Failed to get download URL:', err)
    } finally {
      setIsDownloading(false)
    }
  }

  const getStatusBadge = () => {
    switch (status) {
      case 'verified':
        return (
          <Badge variant="success" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            Vérifié
          </Badge>
        )
      case 'pending':
        return (
          <Badge variant="warning" className="gap-1">
            <Clock className="h-3 w-3" />
            En attente
          </Badge>
        )
      case 'expired':
        return (
          <Badge variant="error" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Expiré
          </Badge>
        )
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-4 transition-colors hover:border-sage-200"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background-secondary">
          {getDocumentIcon(document.document_type)}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{document.file_name}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-foreground-muted">
              {t(`professionals.documents.types.${document.document_type}` as Parameters<typeof t>[0])}
            </span>
            <span className="text-xs text-foreground-muted">•</span>
            <span className="text-xs text-foreground-muted">
              {formatFileSize(document.file_size)}
            </span>
            {document.expires_at && (
              <>
                <span className="text-xs text-foreground-muted">•</span>
                <span className={`text-xs flex items-center gap-1 ${status === 'expired' ? 'text-wine-600' : 'text-foreground-muted'}`}>
                  <Calendar className="h-3 w-3" />
                  {formatDate(document.expires_at)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {getStatusBadge()}

        <Button
          variant="ghost"
          size="icon"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDownload}>
              <Eye className="h-4 w-4 mr-2" />
              Aperçu
            </DropdownMenuItem>

            {status === 'pending' && (
              <DropdownMenuItem onClick={() => onVerify(document, true)}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Vérifier
              </DropdownMenuItem>
            )}

            {status === 'verified' && (
              <DropdownMenuItem onClick={() => onVerify(document, false)}>
                <X className="h-4 w-4 mr-2" />
                Retirer la vérification
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onClick={() => onEditExpiry(document)}>
              <Calendar className="h-4 w-4 mr-2" />
              Modifier l'expiration
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => onDelete(document)}
              className="text-wine-600"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  )
}

export function ProfessionalDocumentsTab({ professional }: ProfessionalDocumentsTabProps) {
  const { data: documents, isLoading } = useProfessionalDocuments(professional.id)
  const verifyDocument = useVerifyDocument()
  const queryClient = useQueryClient()

  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploadType, setUploadType] = useState<DocumentType | undefined>(undefined)
  const [expiryDocument, setExpiryDocument] = useState<ProfessionalDocument | null>(null)
  const [deleteDoc, setDeleteDoc] = useState<ProfessionalDocument | null>(null)

  const handleVerify = async (doc: ProfessionalDocument, verified: boolean) => {
    try {
      await verifyDocument.mutateAsync({ id: doc.id, verified })
      queryClient.invalidateQueries({ queryKey: professionalKeys.documents(professional.id) })
      queryClient.invalidateQueries({ queryKey: professionalKeys.detail(professional.id) })
    } catch (err) {
      console.error('Failed to verify document:', err)
    }
  }

  const handleUpload = (type?: DocumentType) => {
    setUploadType(type)
    setShowUploadDialog(true)
  }

  // Get required documents state (pass submission for electronic consent check)
  const requiredDocsState = mapRequiredDocumentsState(documents || [], professional.latest_submission)

  // Get other documents (not in required list)
  const requiredTypes = REQUIRED_DOCUMENTS.map(d => d.type)
  const otherDocuments = (documents || []).filter(
    d => !requiredTypes.includes(d.document_type)
  )

  // Calculate summary
  const missingCount = requiredDocsState.filter(d => d.status === 'missing').length
  const expiredCount = requiredDocsState.filter(d => d.status === 'expired').length
  const verifiedCount = requiredDocsState.filter(d => d.status === 'verified').length

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">
                Documents requis
              </h3>
              <p className="text-sm text-foreground-muted">
                {verifiedCount} sur {REQUIRED_DOCUMENTS.length} documents vérifiés
              </p>
            </div>
            <div className="flex items-center gap-3">
              {missingCount > 0 && (
                <Badge variant="error" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {missingCount} manquant(s)
                </Badge>
              )}
              {expiredCount > 0 && (
                <Badge variant="warning" className="gap-1">
                  <Clock className="h-3 w-3" />
                  {expiredCount} expiré(s)
                </Badge>
              )}
              {missingCount === 0 && expiredCount === 0 && (
                <Badge variant="success" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Complet
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Required documents grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl bg-background-secondary"
            />
          ))}
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-4">
              Documents requis pour l'intégration
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {requiredDocsState.map((state) => (
                <RequiredDocumentCard
                  key={state.config.type}
                  state={state}
                  onUpload={handleUpload}
                  onVerify={handleVerify}
                  onEditExpiry={setExpiryDocument}
                  onDelete={setDeleteDoc}
                />
              ))}
            </div>
          </div>

          {/* Other documents */}
          {otherDocuments.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-4">
                Autres documents
              </h3>
              <div className="space-y-3">
                <AnimatePresence>
                  {otherDocuments.map((doc) => (
                    <OtherDocumentCard
                      key={doc.id}
                      document={doc}
                      onVerify={handleVerify}
                      onEditExpiry={setExpiryDocument}
                      onDelete={setDeleteDoc}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      <UploadDialog
        isOpen={showUploadDialog}
        onClose={() => {
          setShowUploadDialog(false)
          setUploadType(undefined)
        }}
        professionalId={professional.id}
        preselectedType={uploadType}
      />

      <ExpiryDialog
        isOpen={!!expiryDocument}
        onClose={() => setExpiryDocument(null)}
        document={expiryDocument}
      />

      <DeleteDialog
        isOpen={!!deleteDoc}
        onClose={() => setDeleteDoc(null)}
        document={deleteDoc}
        professionalId={professional.id}
      />
    </div>
  )
}
