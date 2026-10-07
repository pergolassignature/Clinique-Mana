/**
 * The message to show for a failed module RPC. Errors raised by our SQL carry a SQLSTATE code and
 * a French message written for users (e.g. « Activez d'abord : … »); anything else (network,
 * fetch failures) has no code and an English technical message, so it gets the fallback.
 */
export function moduleErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const { code, message } = error
    if (typeof code === 'string' && code !== '' && typeof message === 'string' && message !== '') return message
  }
  return fallback
}
