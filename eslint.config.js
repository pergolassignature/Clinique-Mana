import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Design §6.2 — the layers.
const CORE_SHARED_LAYERS = [
  { group: ['@/modules', '@/modules/*', '@/app', '@/app/*'], message: 'core/ and shared/ must not import modules or app (design §6.2).' },
  { regex: '^(\\.\\./)+(modules|app)(/|$)', message: 'core/ and shared/ must not import modules or app (design §6.2).' },
  { regex: '^src/', message: 'Use the @/ alias, not baseUrl paths.' },
]
const APP_LAYERS = [
  { group: ['@/modules/*/*'], message: 'Import modules only via their public index @/modules/<name> (design §6.2).' },
  { regex: '^(\\.\\./)+modules/', message: 'Import modules only via their public index @/modules/<name> (design §6.2).' },
]
const MODULE_LAYERS = [
  { group: ['@/modules/*/*'], message: 'Import another module only via @/modules/<name>; use relative paths inside your own module (design §6.2).' },
  { group: ['@/app/*'], message: 'Modules must not import the app shell (design §6.2).' },
]

// The login page's JS: the entry chunk and what it imports statically. Taken from the build (the
// entry chunk's modules); `scripts/check-entry-chunk.mjs` checks the built result. Signed-in code
// reaches these files only through a dynamic import() (lazyPage), which this rule does not see.
const ENTRY_MESSAGE =
  'On the login page\'s entry chunk: signed-in code (date libraries, shell, palette, settings, users) loads through a dynamic import (lazyPage), never a static one.'
const ENTRY_RESTRICTIONS = [
  { group: ['date-fns', 'date-fns/*', 'date-fns-tz', 'date-fns-tz/*', 'cmdk'], message: ENTRY_MESSAGE },
  // `@/shared/lib/timezone` pulls date-fns in; clinic-timezone.ts is the date-fns-free part.
  { regex: '(^@/shared/lib/|^\\./)timezone$', message: `${ENTRY_MESSAGE} Use @/shared/lib/clinic-timezone.` },
  { group: ['@/app/shell', '@/app/shell/*', './shell', './shell/*', '@/app/AuthenticatedApp', './AuthenticatedApp', '@/app/AppShell', './AppShell'], message: ENTRY_MESSAGE },
  {
    group: ['@/core/settings/*', '!@/core/settings/paths', '!@/core/settings/sections', '@/core/users', '@/core/users/*', '@/core/account/*', '@/core/audit/*'],
    message: ENTRY_MESSAGE,
  },
]
const ENTRY_FILES = {
  coreShared: [
    'src/core/auth/**/*.{ts,tsx}',
    'src/core/access/AccessProvider.tsx',
    'src/core/access/access.ts',
    'src/core/access/access-context.ts',
    'src/core/access/api.ts',
    'src/core/access/guards.tsx',
    'src/core/modules/types.ts',
    'src/core/settings/paths.ts',
    'src/core/settings/sections.ts',
    'src/core/supabase/client.ts',
    'src/shared/components/ErrorBoundary.tsx',
    'src/shared/components/FullPageMessage.tsx',
    'src/shared/lib/app-update.ts',
    'src/shared/lib/clinic-timezone.ts',
    'src/shared/lib/lazy-page.ts',
    'src/shared/lib/router-future.ts',
    'src/shared/lib/sentry-scrub.ts',
    'src/shared/lib/unsaved-changes-registry.ts',
    'src/shared/lib/use-page-title.ts',
    'src/shared/lib/utils.ts',
    'src/shared/ui/button.tsx',
    'src/shared/ui/field-classes.ts',
    'src/shared/ui/input.tsx',
    'src/shared/ui/label.tsx',
    'src/shared/ui/read-only-context.ts',
    'src/shared/ui/sonner.tsx',
  ],
  app: ['src/app/App.tsx', 'src/app/modules.ts', 'src/app/public-pages.ts', 'src/app/route-preload.ts'],
  // A module's public index and manifest are read at boot (ALL_MODULES); its pages are lazy.
  modules: ['src/modules/*/index.ts', 'src/modules/*/manifest.ts'],
  other: ['src/main.tsx', 'src/i18n/index.ts'],
}
const restrict = (...patternSets) => ({ 'no-restricted-imports': ['error', { patterns: patternSets.flat() }] })
const TESTS = ['**/*.test.{ts,tsx}']

export default tseslint.config(
  { ignores: ['dist', '_legacy', 'supabase/functions', 'src/core/supabase/database.types.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // shadcn primitives export their variants (buttonVariants, badgeVariants, toast) next to the component.
  {
    files: ['src/shared/ui/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // Design §6.2 — core/ and shared/ never depend on modules or the app shell.
  {
    files: ['src/core/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    rules: restrict(CORE_SHARED_LAYERS),
  },
  // Design §6.2 — the app shell uses modules only through their public index.
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: restrict(APP_LAYERS),
  },
  // Design §6.2 — modules talk to each other only through their public index.
  {
    files: ['src/modules/**/*.{ts,tsx}'],
    rules: restrict(MODULE_LAYERS),
  },
  // The login page's entry chunk stays small (perf R4). Each block repeats its layer's patterns:
  // a later no-restricted-imports replaces an earlier one for the same file.
  { files: ENTRY_FILES.coreShared, ignores: TESTS, rules: restrict(CORE_SHARED_LAYERS, ENTRY_RESTRICTIONS) },
  { files: ENTRY_FILES.app, ignores: TESTS, rules: restrict(APP_LAYERS, ENTRY_RESTRICTIONS) },
  { files: ENTRY_FILES.modules, ignores: TESTS, rules: restrict(MODULE_LAYERS, ENTRY_RESTRICTIONS) },
  { files: ENTRY_FILES.other, ignores: TESTS, rules: restrict(ENTRY_RESTRICTIONS) },
)
