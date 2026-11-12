import type { MailModifyInput, ModifyThreadInput, Translate } from '@pergolas-signature/email-ui'
import type { MailAction } from '../api/inbox'
import { emailUiText, toMailAction } from '../lib/email-ui'
import { useMailAction } from './use-inbox'

/*
 * The hook ports of `@pergolas-signature/email-ui` (`components/inbox/email-ui-ports.ts`): the kit
 * calls them in every row and pane, like the hooks they stand for.
 */

/** `gmail-modify` takes at most 50 threads per call. */
const MODIFY_BATCH = 50

/** The kit's `t`: its words in `modules.communications.emailUi`. */
export function useEmailUiT(): Translate {
  return emailUiText
}

/**
 * A row's or the open thread's action (archive, read, unread, follow…): `useMailAction`, optimistic,
 * with its French toast. The kit's thread id is MANA's (`toMailListRow`); an action `gmail-modify`
 * has no counterpart for is never offered (`BATCH_ACTIONS`, the menu's filter) and does nothing.
 */
export function useEmailUiModifyThread(): (input: ModifyThreadInput) => void {
  const action = useMailAction()
  return (input) => {
    const next = toMailAction(input.action)
    if (input.threadId && next) action.mutate({ threadIds: [input.threadId], action: next })
  }
}

/**
 * The selection toolbar's action on every selected thread: one `gmail-modify` call per action and
 * 50 threads, one after the other. « Suivre » comes per message from the kit; here a row's message
 * id is its thread. Settles when every call has: a refusal is already rolled back and said by
 * `useMailAction` (its toast, and the partial answer's), so nothing is thrown at the toolbar.
 */
export function useEmailUiModifyMany(): (inputs: MailModifyInput[]) => Promise<void> {
  const action = useMailAction()
  return async (inputs) => {
    const groups = new Map<string, { action: MailAction; ids: Set<string> }>()
    for (const input of inputs) {
      const next = toMailAction(input.action)
      const id = input.threadId ?? input.gmailMessageId
      if (!next || !id) continue
      const group = groups.get(next.kind) ?? { action: next, ids: new Set<string>() }
      group.ids.add(id)
      groups.set(next.kind, group)
    }
    for (const { action: next, ids } of groups.values()) {
      const all = [...ids]
      for (let i = 0; i < all.length; i += MODIFY_BATCH) {
        await action.mutateAsync({ threadIds: all.slice(i, i + MODIFY_BATCH), action: next }).catch(() => undefined)
      }
    }
  }
}
