import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/shared/ui/alert'

/** A refusal said where the user acted (a form, a dialog): the message, and a detail under it. */
export function RefusalAlert({ message, detail }: { message: string; detail?: string | null }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">
        {message}
        {detail && <span className="mt-0.5 block text-muted-foreground">{detail}</span>}
      </AlertDescription>
    </Alert>
  )
}
