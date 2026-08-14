import { resolve } from 'path'
import { execSync } from 'node:child_process'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
      rollupOptions: {
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
    plugins: [react()]
  }
})
