import { initialsOf } from '@/shared/lib/format'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'

/** 24 px initials avatar (design system tone « neutral »). Decorative: the name is always given nearby. */
export function UserAvatar({ name }: { name: string }) {
  return (
    <Avatar size="sm" aria-hidden>
      <AvatarFallback className="text-muted-foreground">{initialsOf(name)}</AvatarFallback>
    </Avatar>
  )
}
