/**
 * The e2e dev server's own origin. Not the shared 5173 server, which may serve another worktree:
 * Playwright starts this worktree's code on its own port (playwright.config.ts `webServer`).
 */
export const E2E_PORT = 5190
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`
