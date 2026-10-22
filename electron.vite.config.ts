import { resolve } from 'path'
import { execSync } from 'node:child_process'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { pluginScene3d } from './src/renderer/scene-3d/page-scene-3d.mjs'
import { pluginArchiveCartesGels } from './scripts/gels-cartes-archive.mjs'

/**
 * IDENTITE DE BUILD, injectee au build et affichee en bas a gauche de l'app.
 *
 * L'utilisateur ne savait pas quelle version il lançait (« ca lance une vieille version sans le
 * dire »). Le NOMBRE DE COMMITS (`git rev-list --count HEAD`) est le seul compteur qui INCREMENTE
 * tout seul : +1 a chaque commit, monotone, et il mappe l'historique — « build 2481 » est toujours
 * plus recent que « build 2480 ». Le SHA court leve toute ambiguite. Toute panne git (CI, hors depot)
 * retombe sur des valeurs neutres plutot que de casser le build.
 */
function identiteBuild(): { nombre: string; sha: string } {
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      return ''
    }
  }
  return {
    nombre: git('rev-list --count HEAD') || '0',
    sha: git('rev-parse --short HEAD') || 'nogit'
  }
}

const build = identiteBuild()

export default defineConfig({
  main: {
    build: {
      /*
       * LES CARTES DE SOURCES, POUR QUE LE JOURNAL DES GELS NOMME UN FICHIER QUI EXISTE.
       *
       * Mesure du 2026-09-12 : 46 des 60 blocages non attribues portaient bien leur appelant, mais
       * en coordonnees de build (`chunks/worktree-manager-C3-Z8-U7.js:494:39`) — une ligne qu'aucun
       * fichier du depot ne contient. Sans carte, la capture de l'appelant ne fait economiser
       * aucune fouille. Les `.map` restent a cote du bundle et ne changent rien a l'execution.
       */
      sourcemap: true,
      rollupOptions: {
        /*
         * ET ON LES GARDE APRES LA CONSTRUCTION SUIVANTE (conv-1055, 2026-10-22). Chaque build
         * reecrit ces `.map` : un gel d'hier pointait vers un morceau disparu et restait
         * « (non resolu) ». Le greffon archive les cartes de CE bundle hors de `out/`, datees, pour
         * que `scripts/gels-classement.mjs` retrouve celles du code qui tournait au moment du gel.
         */
        plugins: [pluginArchiveCartesGels()],
        input: {
          index: resolve('src/main/index.ts'),
          'brain-worker': resolve('src/main/viz/brain-worker.ts'),
          'worktree-operation-worker': resolve('src/main/store/worktree-operation-worker.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  preload: {},
  renderer: {
    // Remplacement litteral au build : le renderer ne peut pas lire git, on lui grave l'identite ici.
    define: {
      __BUILD_NUMBER__: JSON.stringify(build.nombre),
      __BUILD_SHA__: JSON.stringify(build.sha)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // `scene-3d.html` : la page isolee ou tournent les blocs ```threejs du fil (Bloc3D.tsx).
    plugins: [react(), pluginScene3d({ dossier: resolve('src/renderer/scene-3d') })]
  }
})
