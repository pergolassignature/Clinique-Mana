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
} from 'lucide-react'
import { t } from '@/i18n'
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
import { EmptyState } from '@/shared/components/empty-state'
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

const DOCUMENT_TYPES: DocumentType[] = [
  'cv',
  'diploma',
  'license',
  'insurance',
  'photo',
  'other',
]

const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.jpg,.jpeg,.png'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function getDocumentStatus(doc: ProfessionalDocument): 'verified' | 'pending' | 'expired' {
  if (doc.expires_at && new Date(doc.expires_at) < new Date()) {
    return 'expired'
  }
  if (doc.verified_at) {
    return 'verified'
  }
  return 'pending'
}

function getStatusBadge(status: 'verified' | 'pending' | 'expired') {
  switch (status) {
    case 'verified':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {t('professionals.documents.status.verified')}
        </Badge>
      )
    case 'pending':
      return (
        <Badge variant="warning" className="gap-1">
          <Clock className="h-3 w-3" />
          {t('professionals.documents.status.pending')}
        </Badge>
      )
    case 'expired':
      return (
        <Badge variant="error" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          {t('professionals.documents.status.expired')}
        </Badge>
      )
  }
}

// Upload dialog component
function UploadDialog({
  isOpen,
  onClose,
  professionalId,
}: {
  isOpen: boolean
  onClose: () => void
  professionalId: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedType, setSelectedType] = useState<DocumentType>('cv')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [expiryDate, setExpiryDate] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uploadDocument = useUploadDocument()
  const queryClient = useQueryClient()

  const resetForm = () => {
    setSelectedType('cv')
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
      // Generate unique file path
      const ext = selectedFile.name.split('.').pop()?.toLowerCase() || 'bin'
      const uuid = crypto.randomUUID()
      const filePath = `professionals/${professionalId}/${selectedType}/${uuid}.${ext}`

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from('professional-documents')
        .upload(filePath, selectedFile, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      // Create database record
      await uploadDocument.mutateAsync({
        professional_id: professionalId,
        document_type: selectedType,
        file_name: selectedFile.name,
        file_path: filePath,
        file_size: selectedFile.size,
        mime_type: selectedFile.type,
        expires_at: expiryDate || undefined,
      })

      // Invalidate queries
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('professionals.documents.upload.title')}</DialogTitle>
          <DialogDescription>
            {t('professionals.documents.upload.maxSize')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Document type */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t('professionals.documents.upload.selectType')}
            </label>
            <Select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as DocumentType)}
              disabled={isUploading}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`professionals.documents.types.${type}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </Select>
          </div>

          {/* File input */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t('professionals.documents.upload.selectFile')}
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
                  <p className="text-xs text-foreground-muted">
                    {t('professionals.documents.upload.dragDrop')}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Expiry date (optional) */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              {t('professionals.documents.upload.expiryDate')}
            </label>
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              disabled={isUploading}
            />
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
            {t('professionals.documents.upload.cancel')}
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
              t('professionals.documents.upload.submit')
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
          <DialogTitle>{t('professionals.documents.expiry.title')}</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <label className="text-sm font-medium mb-2 block">
            {t('professionals.documents.expiry.label')}
          </label>
          <Input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
          <p className="mt-2 text-xs text-foreground-muted">
            {t('professionals.documents.expiry.noExpiry')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('professionals.documents.expiry.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={updateExpiry.isPending}>
            {t('professionals.documents.expiry.save')}
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
  const deleteDocument = useDeleteDocument()
  const queryClient = useQueryClient()

  const handleDelete = async () => {
    if (!document) return

    try {
      await deleteDocument.mutateAsync(document.id)
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
          <DialogTitle>{t('professionals.documents.delete.title')}</DialogTitle>
          <DialogDescription>
            {t('professionals.documents.delete.description')}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('professionals.documents.delete.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteDocument.isPending}
          >
            {deleteDocument.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('professionals.documents.delete.confirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Document card
function DocumentCard({
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
  const status = getDocumentStatus(document)

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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-4 transition-colors hover:border-sage-200"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background-secondary">
          <FileText className="h-5 w-5 text-foreground-muted" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{document.file_name}</p>
          <div className="flex items-center gap-2 mt-1">
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
                <span className="text-xs text-foreground-muted flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDate(document.expires_at)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {getStatusBadge(status)}

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
              {t('professionals.documents.actions.download')}
            </DropdownMenuItem>

            {status === 'pending' && (
              <DropdownMenuItem onClick={() => onVerify(document, true)}>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t('professionals.documents.actions.verify')}
              </DropdownMenuItem>
            )}

            {status === 'verified' && (
              <DropdownMenuItem onClick={() => onVerify(document, false)}>
                <X className="h-4 w-4 mr-2" />
                {t('professionals.documents.actions.reject')}
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onClick={() => onEditExpiry(document)}>
              <Calendar className="h-4 w-4 mr-2" />
              {t('professionals.documents.actions.updateExpiry')}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => onDelete(document)}
              className="text-wine-600"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('professionals.documents.actions.delete')}
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
  const [expiryDocument, setExpiryDocument] = useState<ProfessionalDocument | null>(null)
  const [deleteDocument, setDeleteDocument] = useState<ProfessionalDocument | null>(null)

  const handleVerify = async (doc: ProfessionalDocument, verified: boolean) => {
    try {
      await verifyDocument.mutateAsync({ id: doc.id, verified })
      queryClient.invalidateQueries({ queryKey: professionalKeys.documents(professional.id) })
    } catch (err) {
      console.error('Failed to verify document:', err)
    }
  }

  // Group documents by type
  const groupedDocuments = (documents || []).reduce(
    (acc, doc) => {
      const type = doc.document_type
      if (!acc[type]) acc[type] = []
      acc[type].push(doc)
      return acc
    },
    {} as Record<DocumentType, ProfessionalDocument[]>
  )

  const hasDocuments = documents && documents.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('professionals.documents.title')}</h2>
          {hasDocuments && (
            <p className="text-sm text-foreground-muted">
              {documents.length} document(s)
            </p>
          )}
        </div>
        <Button onClick={() => setShowUploadDialog(true)}>
          <Upload className="h-4 w-4" />
          Téléverser
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-background-secondary"
            />
          ))}
        </div>
      ) : !hasDocuments ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={t('professionals.documents.empty.title')}
          description={t('professionals.documents.empty.description')}
          action={
            <Button onClick={() => setShowUploadDialog(true)}>
              <Upload className="h-4 w-4" />
              Téléverser
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {DOCUMENT_TYPES.filter((type) => groupedDocuments[type]?.length > 0).map((type) => (
            <Card key={type}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t(`professionals.documents.types.${type}` as Parameters<typeof t>[0])}
                </CardTitle>
                <CardDescription>
                  {groupedDocuments[type].length} document(s)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <AnimatePresence>
                    {groupedDocuments[type].map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        document={doc}
                        onVerify={handleVerify}
                        onEditExpiry={setExpiryDocument}
                        onDelete={setDeleteDocument}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <UploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        professionalId={professional.id}
      />

      <ExpiryDialog
        isOpen={!!expiryDocument}
        onClose={() => setExpiryDocument(null)}
        document={expiryDocument}
      />

      <DeleteDialog
        isOpen={!!deleteDocument}
        onClose={() => setDeleteDocument(null)}
        document={deleteDocument}
        professionalId={professional.id}
      />
    </div>
  )
}
