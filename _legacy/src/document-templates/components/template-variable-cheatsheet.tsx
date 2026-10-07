import { Copy } from 'lucide-react'
import { toast } from '@/shared/hooks/use-toast'
import { VARIABLE_GROUPS } from '../constants'

async function copyVariable(key: string) {
  try {
    await navigator.clipboard.writeText(`{{${key}}}`)
    toast({ title: 'Copie!', description: `{{${key}}} copie dans le presse-papier.` })
  } catch {
    toast({ title: 'Erreur', description: 'Impossible de copier dans le presse-papier.', variant: 'error' })
  }
}

export function TemplateVariableCheatsheet() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Variables disponibles
        </h3>
        <p className="mt-1 text-xs text-foreground-secondary">
          Cliquez sur une variable pour la copier. Utilisez la syntaxe{' '}
          <code className="rounded bg-background-tertiary px-1 py-0.5 font-mono text-xs">
            {'{{variable}}'}
          </code>{' '}
          dans votre gabarit.
        </p>
      </div>

      {VARIABLE_GROUPS.map((group) => (
        <div key={group.label}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {group.label}
          </h4>
          <div className="space-y-1">
            {group.variables.map((variable) => (
              <button
                key={variable.key}
                type="button"
                onClick={() => copyVariable(variable.key)}
                className="group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-background-secondary"
              >
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <code className="rounded bg-background-tertiary px-1.5 py-0.5 font-mono text-xs text-sage-700">
                    {`{{${variable.key}}}`}
                  </code>
                  <Copy className="h-3 w-3 text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {variable.description}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-foreground-muted">
                    Ex: {variable.example}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
