# Module Status — app-shell

Module: app-shell
Workflow: module.pipeline
Current Gate: LOCKED
Last Updated: 2026-01-18

## UI Shell Locked

UI shell locked after dashboard and navigation polish.
Future changes require explicit review.

Progress:
- [x] Gate 0 — UI Wireframe (COMPLETE)
- [x] Gate 0.1 — Dashboard KPI cleanup (COMPLETE)
- [x] Gate 0.2 — Navigation reorder (COMPLETE)
- [x] Gate 0.3 — User identity cleanup (COMPLETE)
- [ ] Gate 1 — Data Contract (N/A for app-shell)
- [ ] Gate 2 — Schema (N/A for app-shell)
- [ ] Gate 3 — Security (RLS) (N/A for app-shell)
- [ ] Gate 4 — Audit (Write) (N/A for app-shell)
- [ ] Gate 5 — Local Dev Validation (N/A for app-shell)
- [ ] Gate 6 — UI Integration (N/A for app-shell)
- [ ] Gate 7 — Automated Tests
- [ ] Gate 8 — Production

Blockers:
- None

Notes:
- Iteration 0: UI shell only (navigation + empty pages)
- Auth integration complete (useAuth, ProtectedRoute)
- All strings in fr-CA

## Gate 0 Deliverables (Complete)
- Vite + React 19 + TypeScript project
- TanStack Router with all 8 routes
- Tailwind CSS with brand tokens (sage, honey, wine)
- shadcn/ui components (Button, Badge, Avatar, Dialog, Dropdown, Toast, Tooltip, Input)
- Collapsible sidebar with animations + tooltips
- Topbar with page title, search bar, notifications, help, user dropdown
- Command palette (Cmd+K) with keyboard navigation
- All pages: PageHeader + FilterBarSkeleton + EmptyState
- fr-CA i18n dictionary with t() helper
- Error boundary
- Responsive: sidebar overlay on mobile
- ESLint + Prettier configured
- Build passes

## Polish Pass (Complete)
- Dashboard KPIs: Removed RDV references, added operational metrics
- Navigation: Reordered to match workflow (Demandes → Clients → Professionnels)
- User identity: Bottom-left primary (name + role), top-right actions only
- Empty states: Action-oriented copy, no clinical language
- Loading states: Skeletons for user card areas
- Auth: Single source of truth via useAuth()
