# UI kit — Clinique MANA (application de gestion)

Interactive recreation of the admin/staff web app (React + Supabase, repo `pergolassignature/Clinique-Mana`), restyled as a compact, flat tool: ink text on white, grey panels, one teal action per view, Inter 13px.

Open `index.html`. Flow: **Connexion** → **Accueil** (dashboard by role) → **Professionnels** (table-style list, add dialog, fiche with tabs) → **Demandes** (inbox + discovery-call drawer with matching suggestions) → **Paramètres** (grouped side menu, Modules toggles). The role switch in the top bar (Admin · Conseillère · Adjointe) changes the menu exactly as the spec's "Qui voit quoi" table. ⌘K opens the command palette.

Files: `data.jsx` (roles, nav, sample records) · `Shell.jsx` (SidebarNav + Topbar + palette, Stat tile) · `Login.jsx` · `Accueil.jsx` · `Professionnels.jsx` (list + Fiche) · `Demandes.jsx` · `Parametres.jsx` · `App.jsx`.

Screens built from: `src/app/AppShell.tsx`, `src/core/auth/pages/{LoginPage,AuthCard}.tsx`, `src/core/settings/{SettingsLayout,pages/ModulesSettingsPage}.tsx`, legacy `_legacy/src/pages/{professionals,dashboard}.tsx`, `_legacy/src/shared/components/{sidebar,topbar,page-header,empty-state}.tsx`, copy from `src/i18n/fr-CA.json`.

Clients, Rendez-vous and Facturation have no source UI yet and are left as explicit placeholders.
