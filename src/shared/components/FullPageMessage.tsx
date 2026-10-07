import type { ReactNode } from 'react'

interface FullPageMessageProps {
  title: string
  body?: string
  action?: ReactNode
  /** ARIA live role for the wrapper, e.g. 'alert' for error fallbacks. */
  role?: 'alert' | 'status'
}

export function FullPageMessage({ title, body, action, role }: FullPageMessageProps) {
  return (
    <div role={role} className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  )
}
