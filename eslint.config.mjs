import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', 'Audit/**'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // Configuration et utilitaires JavaScript : TypeScript ne peut pas y garantir les annotations de retour.
    files: ['**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // Tests et probes non expédiés : privilégier l'inférence des doubles et callbacks locaux.
    files: ['**/*.test.{ts,tsx}', 'scripts/**/*.{mts,ts}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    // Mocks IPC dynamiques : leurs signatures imitent l'API Electron sans propager `any` au produit.
    files: ['src/main/commands.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  },
  {
    // Doubles de flux asynchrones volontairement vides pour tester les branches sans événement.
    files: ['src/main/orchestrator.execution.test.ts'],
    rules: { 'require-yield': 'off' }
  },
  eslintConfigPrettier
)
