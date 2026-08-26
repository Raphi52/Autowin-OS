import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: ['**/node_modules', '**/dist', '**/out', 'Audit/**', '.autowin-data/**']
  },
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
      ...eslintPluginReactRefresh.configs.vite.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          /*
           * `ignoreRestSiblings` couvre la DESTRUCTURATION POUR OMISSION : l'idiome
           * `const { cle: _ignoree, ...reste } = objet`, qui retire une cle sans jamais la lire --
           * ne PAS la lire est tout son propos. Trois sites legitimes du depot etaient signales en
           * erreur (`_score`, `_vivant`, `_ignore`), et un `npm test` qui inclut le lint ne pouvait
           * donc pas conclure.
           *
           * La regle continue d'attraper les vraies variables inutilisees : elle ne se tait que la
           * ou un `...reste` rend l'omission EXPLICITE. Posee ici et non dans le bloc des tests --
           * ces trois sites sont en PRODUCTION.
           */
          ignoreRestSiblings: true
        }
      ]
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
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // Mocks IPC dynamiques : leurs signatures imitent l'API Electron sans propager `any` au produit.
    files: ['src/main/commands.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  },
  {
    // Doubles de flux asynchrones volontairement vides pour tester les branches sans événement.
    files: [
      'src/main/orchestrator.context-dedup.test.ts',
      'src/main/orchestrator.execution.test.ts',
      'src/main/orchestrator.hooks.test.ts',
      'src/main/orchestrator.lean-fast.test.ts',
      'src/main/orchestrator.provider-identity.test.ts',
      'src/main/orchestrator.resume-skips-paid-phases.test.ts',
      'src/main/orchestrator.workflow-override.test.ts',
      'src/main/orchestrator.worktree-flip.test.ts'
    ],
    rules: { 'require-yield': 'off' }
  },
  eslintConfigPrettier
)
