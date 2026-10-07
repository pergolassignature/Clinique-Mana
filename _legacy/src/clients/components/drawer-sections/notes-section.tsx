import { useState } from 'react'
import { StickyNote, Plus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { t } from '@/i18n'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { ClientWithRelations } from '../../types'
import { AddNoteDialog } from './edit-dialogs'

interface NotesSectionProps {
  client: ClientWithRelations
  onAddNote?: (content: string) => void
}

export function NotesSection({ client, onAddNote }: NotesSectionProps) {
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const notes = client.notes || []

  const formatRelativeDate = (date: string) => {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr })
  }

  const handleAddNote = (content: string) => {
    console.log('Add note:', content)
    onAddNote?.(content)
  }

  return (
    <>
      <AccordionItem value="notes" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-sage-500" />
            <span>{t('clients.drawer.sections.notes')}</span>
            {notes.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {notes.length}
              </Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            {/* Add note button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setAddNoteOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('clients.drawer.notes.addNote')}
            </Button>

            {/* Notes list */}
            {notes.length > 0 ? (
              <ul className="space-y-3">
                {notes.map(note => (
                  <li
                    key={note.id}
                    className="p-3 rounded-lg bg-background-secondary"
                  >
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {note.content}
                    </p>
                    <p className="text-xs text-foreground-muted mt-2">
                      {t('clients.drawer.notes.by')} {note.authorName} • {formatRelativeDate(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground-muted italic py-2">
                {t('clients.drawer.notes.noNotes')}
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Add Note Dialog */}
      <AddNoteDialog
        open={addNoteOpen}
        onOpenChange={setAddNoteOpen}
        onSave={handleAddNote}
      />
    </>
  )
}
