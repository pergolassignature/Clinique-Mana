# 0003 — Module manifests, activation and settings registry

**Status:** Accepted · **Date:** 2026-10-06 (amended 2026-10-07) · **Design:** [§3](../plans/2026-10-06-foundation-rebuild-design.md#3-settings-and-module-activation), [§6.2](../plans/2026-10-06-foundation-rebuild-design.md#62-module-isolation-rules-build-module-by-module-without-breaking-the-rest)

## Context
The app grows module by module (Professionnels first, then Services, Clients, Demandes…). Adding, changing or disabling one module must not break another, and settings pages must not be a hard-coded admin list (PS Hub's weakness).

## Decision
- Each module declares a **manifest** (`src/modules/<key>/manifest.ts`: routes, nav item, settings sections, `dependsOn`) registered in `ALL_MODULES`. Keys are English and equal `public.modules.key`.
- Activation per org lives in **`org_modules`**; dependencies in `module_dependencies`. `set_module_enabled` enforces them; `get_my_access().modules` tells the app which manifests to load.
- The **settings page** is built from core sections plus enabled modules' sections, each in its own error boundary.
- **Import boundaries** (ESLint): modules only through `@/modules/<key>` (their `index.ts`); `core/` and `shared/` never import modules or the app.
- Edge functions of a module call `requireModule()`.

## Consequences
- A disabled module has no route, menu entry, settings section, permission or edge-function access.
- Cross-module reads go through views/RPCs published by the owner.

## Alternatives
- **Feature flags in code / env:** not per organisation and invisible to the database.
- **Hard-coded routes and settings menu:** every module would edit shared files.
