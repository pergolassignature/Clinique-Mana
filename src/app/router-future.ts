/**
 * React Router v7 behaviour, opted into now (also silences the v6 deprecation warnings).
 * Shared by App.tsx and the test router (src/test/contexts.tsx) so relative Navigate/NavLink
 * resolution in tests matches the app.
 */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const
