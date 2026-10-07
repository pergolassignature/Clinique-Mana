import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

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
  // Design §6.2 — core/ and shared/ never depend on modules or the app shell.
  {
    files: ['src/core/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['@/modules/*', '@/app/*'], message: 'core/ and shared/ must not import modules or app (design §6.2).' }],
      }],
    },
  },
  // Design §6.2 — modules talk to each other only through their public index.
  {
    files: ['src/modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/modules/*/*'], message: 'Import another module only via @/modules/<name>; use relative paths inside your own module (design §6.2).' },
          { group: ['@/app/*'], message: 'Modules must not import the app shell (design §6.2).' },
        ],
      }],
    },
  },
)
