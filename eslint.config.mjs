import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    /*
     * `tests/fixtures/arena-conv-126` est une COPIE FIGEE d'un run reel : sa valeur de preuve
     * tient a sa fidelite octet pour octet a l'original (voir le README du dossier). La reformater
     * -- meme un simple retour a la ligne de prettier -- casserait cette fidelite. On l'exclut donc
     * du lint plutot que de la corriger.
     *
     * `bench/runs` et les dossiers `essais` de `.arena` sont des copies de travail GENEREES par les bancs et les
     * arenas (ignorees par git : bench/.gitignore, .arena/arenagame/.gitignore). `bench/runs`
     * contenait 6 copies completes de `src` : 13 957 des 16 442 fichiers lintes, et plus de 400 s
     * pour un lint sans cache (mesure du 2026-09-23).
     */
    ignores: [
      'bench/runs/**',
      // Déclarations que Claude Code écrit dans un mod à chaque chargement (--plugin-dir), propres à
      // la version installée et non suivies (mods/autowin/.gitignore) : pas du code d'Autowin.
      'mods/*/.claude-plugin/types/**',
      '.arena/**/essais/**',
      // Copies de bras extraites pour la notation juge (ex. juge-t4/bras/, non suivies par git) :
      // meme nature generee que essais/, 8 erreurs de lint le 2026-09-26.
      '.arena/**/bras/**',
      // Banc arenagame SORTI du depot le 2026-09-26 (commit e889422f, .gitignore:81) : usage personnel,
      // garde sur le disque local mais plus suivi. Le lint du depot ne doit pas le noter : ses
      // nouveaux dossiers (juge-iso/, hd/) rendaient le lint rouge le 2026-09-27 (2 erreurs).
      '.arena/arenagame/**',
      '**/node_modules',
      '**/dist',
      '**/out',
      'Audit/**',
      '.autowin-data/**',
      // Brouillons de session et maquettes, hors suivi git (.gitignore:10 et :71, ajoute le
      // 2026-10-10) : 3734 erreurs de lint le 2026-10-11, dont 0 dans src/. Les 9 fichiers deja
      // suivis sous .autowin-tmp/ sont des PNG/HTML/JSON/CSS, qu'eslint ne lit pas.
      '.autowin-tmp/**',
      'artifacts/**',
      'tests/fixtures/arena-conv-126/**',
      // Archives d'une entreprise (`entreprise/<nom>/archives/`) : copies FIGEES de bancs et d'audits
      // passes, gardees telles quelles. Meme raison que la fixture ci-dessus : ne pas les reformater.
      'entreprise/*/archives/**'
    ]
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
    // Les mods (mods/*/hooks/*.js) sont des modules ES du même genre : le CLI les charge tels quels.
    files: ['**/*.mjs', 'mods/**/*.js'],
    /*
     * DECLARER LE LANGAGE, plutot que de faire taire la regle qui s'en plaint.
     *
     * Ces fichiers sont des modules ES et emploient l'`await` de premier niveau. Parses comme des
     * SCRIPTS, leurs portees sont mal resolues : `no-undef` signalait des variables declarees au
     * niveau du module (`GESTE` de `cdp-accueil-3d-proof.mjs`) comme non definies, alors que
     * `node --check` accepte le fichier. Un faux positif qui vient d'une lacune de configuration,
     * pas du code -- et qui empechait `npm test` de conclure.
     */
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Meme convention que pour les `.ts` : un `_` en tete dit « volontairement non lu ».
      // Sans cette reprise, la regle venait du preset SANS options, et un outil de diagnostic
      // garde expres (`_contenus`) etait signale comme un oubli.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ]
    }
  },
  {
    /*
     * Même règle pour les scripts COMMONJS (`.cjs`), chargés par Node ou Electron avant tout
     * TypeScript : `require` y EST la syntaxe d'import, et TypeScript ne peut pas y garantir les
     * annotations de retour. Sans ce bloc, `scripts/menu-demarrer-dev.cjs` (9d6bb850, conv-954)
     * rendait le lint rouge le 2026-10-16 : 7 erreurs, toutes de ces deux règles.
     */
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs'
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
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
      'src/main/orchestrator.overload-retry.test.ts',
      'src/main/orchestrator.provider-identity.test.ts',
      'src/main/orchestrator.resume-skips-paid-phases.test.ts',
      'src/main/orchestrator.workflow-override.test.ts',
      'src/main/orchestrator.worktree-flip.test.ts'
    ],
    rules: { 'require-yield': 'off' }
  },
  eslintConfigPrettier
)
