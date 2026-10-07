// src/contracts/components/service-contract-section.tsx
// Service contract section using the document-templates system.
// Reads from document_instances table, generates via template-based flow.
// Styled to match RequiredDocumentCard for visual consistency.
import { useState } from 'react'
import {
  FileText,
  Send,
  CheckCircle,
  Clock,
  Loader2,
  Download,
  Eye,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  MoreVertical,
  FileSignature,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { useToast } from '@/shared/hooks/use-toast'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { supabase } from '@/lib/supabaseClient'
import { useServiceContractStatus, useGenerateDocument, useSyncDocumentStatus } from '@/document-templates/hooks'
import { TEMPLATE_KEYS } from '@/document-templates/constants'
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

interface ServiceContractSectionProps {
  professionalId: string
  professionalName: string
  professionalEmail: string
  generatedByProfileId: string
  className?: string
}

export function ServiceContractSection({
  professionalId,
  professionalName,
  professionalEmail,
  generatedByProfileId,
  className,
}: ServiceContractSectionProps) {
  const { toast } = useToast()
  const { instance, status, isLoading, isSigned, isSent } =
    useServiceContractStatus(professionalId)
  const generateDocument = useGenerateDocument()
  const syncStatus = useSyncDocumentStatus()
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const handleGenerateAndSend = async () => {
    try {
      await generateDocument.mutateAsync({
        templateKey: TEMPLATE_KEYS.SERVICE_CONTRACT,
        subjectType: 'professional',
        subjectId: professionalId,
        submitterEmail: professionalEmail,
        submitterName: professionalName,
        generatedBy: generatedByProfileId,
      })
      toast({
        title: 'Contrat envoyé',
        description: `Le contrat a été envoyé à ${professionalName} via DocuSeal.`,
      })
    } catch (error) {
      console.error('Error generating contract:', error)
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Impossible de générer le contrat.',
        variant: 'error',
      })
    }
  }

  const handleSyncStatus = async () => {
    if (!instance?.id) return

    try {
      const result = await syncStatus.mutateAsync(instance.id)
      toast({
        title: result.synced ? 'Statut synchronisé' : 'Aucune mise à jour',
        description: result.message,
        variant: result.synced ? 'default' : 'warning',
      })
    } catch (error) {
      console.error('Error syncing status:', error)
      toast({
        title: 'Erreur de synchronisation',
        description: error instanceof Error ? error.message : 'Impossible de synchroniser le statut.',
        variant: 'error',
      })
    }
  }

  const handleViewPdf = async () => {
    if (!instance?.signed_pdf_storage_path) return
    setIsDownloading(true)
    try {
      const { data, error } = await supabase.storage
        .from('professional-documents')
        .createSignedUrl(instance.signed_pdf_storage_path, 60 * 60)

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank')
      } else if (error) {
        throw error
      }
    } catch (err) {
      console.error('Error getting signed URL:', err)
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ouvrir le PDF.',
        variant: 'error',
      })
    } finally {
      setIsDownloading(false)
    }
  }

  const handleDownloadPdf = async () => {
    if (!instance?.signed_pdf_storage_path) return
    setIsDownloading(true)
    try {
      const { data, error } = await supabase.storage
        .from('professional-documents')
        .download(instance.signed_pdf_storage_path)

      if (data) {
        const url = URL.createObjectURL(data)
        const a = document.createElement('a')
        a.href = url
        a.download = `contrat-service-${professionalName.replace(/\s+/g, '-')}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else if (error) {
        throw error
      }
    } catch (err) {
      console.error('Error downloading PDF:', err)
      toast({
        title: 'Erreur',
        description: 'Impossible de télécharger le PDF.',
        variant: 'error',
      })
    } finally {
      setIsDownloading(false)
    }
  }

  const handleViewAuditLog = async () => {
    // Prefer local storage
    if (instance?.audit_log_storage_path) {
      setIsDownloading(true)
      try {
        const { data, error } = await supabase.storage
          .from('professional-documents')
          .createSignedUrl(instance.audit_log_storage_path, 60 * 60)

        if (data?.signedUrl) {
          window.open(data.signedUrl, '_blank')
          return
        } else if (error) {
          console.error('Error getting audit log URL:', error)
        }
      } catch (err) {
        console.error('Error fetching audit log:', err)
      } finally {
        setIsDownloading(false)
      }
    }

    // Fallback to DocuSeal URL
    const auditLog = instance?.docuseal_audit_log as { audit_log_url?: string } | null
    if (auditLog?.audit_log_url) {
      window.open(auditLog.audit_log_url, '_blank')
      return
    }

    toast({
      title: 'Non disponible',
      description: 'Le log de signature n\'est pas encore disponible.',
      variant: 'warning',
    })
  }

  const handleDownloadAuditLog = async () => {
    if (!instance?.audit_log_storage_path) {
      toast({
        title: 'Non disponible',
        description: 'Le log de signature n\'est pas stocké localement.',
        variant: 'warning',
      })
      return
    }

    setIsDownloading(true)
    try {
      const { data, error } = await supabase.storage
        .from('professional-documents')
        .download(instance.audit_log_storage_path)

      if (data) {
        const url = URL.createObjectURL(data)
        const a = document.createElement('a')
        a.href = url
        a.download = `audit-log-${professionalName.replace(/\s+/g, '-')}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else if (error) {
        throw error
      }
    } catch (err) {
      console.error('Error downloading audit log:', err)
      toast({
        title: 'Erreur',
        description: 'Impossible de télécharger le log de signature.',
        variant: 'error',
      })
    } finally {
      setIsDownloading(false)
    }
  }

  // Status badge
  const getStatusBadge = () => {
    if (!instance) {
      return (
        <Badge variant="outline" className="gap-1 text-wine-600 border-wine-200">
          <AlertCircle className="h-3 w-3" />
          Non généré
        </Badge>
      )
    }

    switch (status) {
      case 'signed':
        return (
          <Badge variant="success" className="gap-1">
            <CheckCircle className="h-3 w-3" />
            Signé
          </Badge>
        )
      case 'sent_to_docuseal':
        return (
          <Badge variant="warning" className="gap-1">
            <Clock className="h-3 w-3" />
            En attente
          </Badge>
        )
      case 'generated':
        return (
          <Badge variant="secondary" className="gap-1">
            <FileText className="h-3 w-3" />
            Généré
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <FileText className="h-3 w-3" />
            {status}
          </Badge>
        )
    }
  }

  // Card styling based on status
  const cardClass = !instance
    ? 'border-dashed border-wine-200 bg-wine-50/30'
    : isSigned
      ? 'border-sage-200 bg-sage-50/30'
      : isSent
        ? ''
        : ''

  // Icon styling based on status
  const iconClass = !instance
    ? 'bg-wine-100 text-wine-600'
    : isSigned
      ? 'bg-sage-100 text-sage-600'
      : isSent
        ? 'bg-honey-100 text-honey-600'
        : 'bg-background-secondary text-foreground-muted'

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="animate-pulse space-y-3">
            <div className="h-5 w-32 bg-muted rounded" />
            <div className="h-4 w-48 bg-muted rounded" />
          </div>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className={cn(cardClass, className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconClass)}>
              <FileSignature className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Contrat de service</CardTitle>
                <Badge variant="outline" className="gap-1 text-xs">
                  <AlertCircle className="h-3 w-3" />
                  Requis
                </Badge>
              </div>
              <CardDescription className="mt-0.5">
                Contrat de collaboration avec la Clinique MANA
              </CardDescription>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent>
        {/* Contract details when exists */}
        {instance && (
          <div className="mb-4 space-y-2 rounded-lg bg-background p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Type</span>
              <Badge variant="outline" className="text-sage-600 border-sage-300">
                Signature électronique
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground-muted">Version</span>
              <span className="font-medium">v{instance.template_version}</span>
            </div>
            {instance.created_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Envoyé le</span>
                <span>{formatClinicDateShort(instance.created_at)}</span>
              </div>
            )}
            {instance.signed_at && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Signé le</span>
                <span className="font-medium text-sage-600">
                  {formatClinicDateShort(instance.signed_at)}
                </span>
              </div>
            )}
            {instance.clinic_signer_name && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Clinique</span>
                <span>{instance.clinic_signer_name}</span>
              </div>
            )}
            {instance.docuseal_submission_id && (
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">ID DocuSeal</span>
                <span className="font-mono text-xs">{instance.docuseal_submission_id}</span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {!instance ? (
            // No contract - show generate button
            <Button onClick={handleGenerateAndSend} disabled={generateDocument.isPending}>
              {generateDocument.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Générer et envoyer
            </Button>
          ) : isSigned ? (
            // Signed - show view/download options
            <>
              <Button variant="outline" onClick={handleViewPdf} disabled={isDownloading || !instance.signed_pdf_storage_path}>
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Aperçu
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleViewPdf} disabled={!instance.signed_pdf_storage_path}>
                    <Eye className="h-4 w-4 mr-2" />
                    Voir le PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadPdf} disabled={!instance.signed_pdf_storage_path}>
                    <Download className="h-4 w-4 mr-2" />
                    Télécharger le PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleViewAuditLog}>
                    <FileText className="h-4 w-4 mr-2" />
                    Voir le log de signature
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDownloadAuditLog}
                    disabled={!instance.audit_log_storage_path}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Télécharger le log
                  </DropdownMenuItem>
                  {instance.docuseal_submission_id && (
                    <DropdownMenuItem
                      onClick={() => window.open(`https://docuseal.com/submissions/${instance.docuseal_submission_id}`, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Voir dans DocuSeal
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowRegenerateConfirm(true)}
                    className="text-wine-600"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Régénérer le contrat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : isSent ? (
            // Sent but not signed - show sync and DocuSeal link
            <>
              <Button
                variant="outline"
                onClick={handleSyncStatus}
                disabled={syncStatus.isPending}
              >
                {syncStatus.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Synchroniser
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {instance.docuseal_submission_id && (
                    <DropdownMenuItem
                      onClick={() => window.open(`https://docuseal.com/submissions/${instance.docuseal_submission_id}`, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Voir dans DocuSeal
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowRegenerateConfirm(true)}
                    className="text-wine-600"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Régénérer le contrat
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>

        {/* Info banner for sent contracts */}
        {isSent && !isSigned && (
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <p className="text-sm text-amber-800">
              En attente de la signature de <strong>{professionalEmail}</strong>
            </p>
          </div>
        )}
      </CardContent>

      {/* Confirmation dialog for regenerating contract */}
      <AlertDialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Régénérer le contrat de service?</AlertDialogTitle>
            <AlertDialogDescription>
              Un nouveau contrat de service sera généré et envoyé à{' '}
              <strong>{professionalEmail}</strong> pour signature.
              {isSigned && (
                <span className="block mt-2 text-amber-600">
                  Le contrat actuel est déjà signé. Cette action créera une nouvelle version
                  qui devra être signée à nouveau.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowRegenerateConfirm(false)
                handleGenerateAndSend()
              }}
            >
              Envoyer le nouveau contrat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
