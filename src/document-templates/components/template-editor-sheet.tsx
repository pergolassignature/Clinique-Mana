import { useState, useEffect, useMemo } from 'react'
import { FileText, Eye, BookOpen } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/shared/ui/sheet'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { NavTabs, NavTab } from '@/shared/ui/nav-tabs'
import { toast } from '@/shared/hooks/use-toast'
import type { DocumentTemplate } from '../types'
import { useCreateTemplate, useUpdateTemplateDraft } from '../hooks'
import { renderTemplatePreview } from '../template-engine'
import { TemplateVariableCheatsheet } from './template-variable-cheatsheet'

type EditorTab = 'content' | 'preview' | 'variables'

const TABS: Array<{ id: EditorTab; label: string; icon: typeof FileText }> = [
  { id: 'content', label: 'Contenu', icon: FileText },
  { id: 'preview', label: 'Apercu', icon: Eye },
  { id: 'variables', label: 'Variables', icon: BookOpen },
]

export interface TemplateEditorSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: DocumentTemplate | null
  onSaved?: () => void
}

export function TemplateEditorSheet({
  open,
  onOpenChange,
  template,
  onSaved,
}: TemplateEditorSheetProps) {
  const isNew = !template
  const createMutation = useCreateTemplate()
  const updateMutation = useUpdateTemplateDraft()

  const [activeTab, setActiveTab] = useState<EditorTab>('content')
  const [key, setKey] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')

  // Reset form state when the sheet opens or the template changes
  useEffect(() => {
    if (open) {
      setActiveTab('content')
      if (template) {
        setKey(template.key)
        setTitle(template.title)
        setDescription(template.description ?? '')
        setContent(template.content)
      } else {
        setKey('')
        setTitle('')
        setDescription('')
        setContent('')
      }
    }
  }, [open, template])

  const previewHtml = useMemo(() => {
    if (activeTab !== 'preview' || !content.trim()) return ''
    return renderTemplatePreview(content)
  }, [activeTab, content])

  const isSaving = createMutation.isPending || updateMutation.isPending

  async function handleSaveDraft() {
    try {
      if (isNew) {
        await createMutation.mutateAsync({
          key: key.trim(),
          title: title.trim(),
          description: description.trim() || undefined,
          content,
        })
        toast({
          title: 'Gabarit cree',
          description: 'Le brouillon a ete enregistre.',
        })
      } else {
        await updateMutation.mutateAsync({
          id: template.id,
          input: {
            title: title.trim(),
            description: description.trim() || undefined,
            content,
          },
        })
        toast({
          title: 'Brouillon enregistre',
          description: 'Les modifications ont ete sauvegardees.',
        })
      }
      onSaved?.()
      onOpenChange(false)
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de sauvegarder le gabarit.',
        variant: 'error',
      })
    }
  }

  const canSave =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    (isNew ? key.trim().length > 0 : true)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {isNew ? 'Nouveau gabarit' : `Modifier : ${template.title}`}
          </SheetTitle>
        </SheetHeader>

        <NavTabs className="border-b border-border">
          {TABS.map((tab) => (
            <NavTab
              key={tab.id}
              active={activeTab === tab.id}
              icon={<tab.icon className="h-4 w-4" />}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </NavTab>
          ))}
        </NavTabs>

        <div className="flex-1 overflow-y-auto py-4">
          {activeTab === 'content' && (
            <div className="space-y-4">
              {isNew && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="template-key"
                    className="text-sm font-medium text-foreground"
                  >
                    Cle du gabarit
                  </label>
                  <Input
                    id="template-key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="ex: contrat_service"
                    className="font-mono"
                  />
                  <p className="text-xs text-foreground-muted">
                    Identifiant unique utilise dans le code. Ne peut pas etre
                    modifie apres la creation.
                  </p>
                </div>
              )}

              {!isNew && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Cle du gabarit
                  </label>
                  <Input value={template.key} disabled className="font-mono" />
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="template-title"
                  className="text-sm font-medium text-foreground"
                >
                  Titre
                </label>
                <Input
                  id="template-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Titre du gabarit"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="template-description"
                  className="text-sm font-medium text-foreground"
                >
                  Description
                </label>
                <Input
                  id="template-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description optionnelle"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="template-content"
                  className="text-sm font-medium text-foreground"
                >
                  Contenu HTML
                </label>
                <Textarea
                  id="template-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="<html>..."
                  className="min-h-[400px] font-mono text-xs"
                />
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="space-y-3">
              <p className="text-sm text-foreground-secondary">
                Apercu avec les donnees d'exemple. Les variables sont remplacees
                par des valeurs fictives.
              </p>
              {content.trim() ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <iframe
                    title="Apercu du gabarit"
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    className="h-[500px] w-full bg-white"
                  />
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-foreground-muted">
                  Ajoutez du contenu dans l'onglet Contenu pour voir l'apercu.
                </p>
              )}
            </div>
          )}

          {activeTab === 'variables' && <TemplateVariableCheatsheet />}
        </div>

        <SheetFooter className="border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Annuler
          </Button>
          <Button onClick={handleSaveDraft} disabled={!canSave || isSaving}>
            {isSaving ? 'Enregistrement...' : 'Enregistrer le brouillon'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
