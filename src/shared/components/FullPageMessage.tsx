import type { ReactNode } from 'react'

interface FullPageMessageProps {
  title: string
  body?: string
  action?: ReactNode
}

export function FullPageMessage({ title, body, action }: FullPageMessageProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  )
}
