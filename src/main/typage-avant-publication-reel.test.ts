import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supprimerArbre } from './fs-supprimer'
import { delierLesDependances } from './store/dependances-copie-agent'
import { typerCeQuiPart, typeurTsc } from './typage-avant-publication'

/**
 * LE CAS `9d6bb850` REJOUÉ POUR DE VRAI (conv-954, 2026-10-15) : vrai dépôt git, vraie copie propre
 * (`ouvrirCopieDeBase`), vrai `tsc`. Une fonction prend un paramètre de plus ; son appelant, modifié
 * lui aussi dans l'arbre, ne part PAS. L'arbre compile, ce qui part ne compile pas.
 */

const DEPOT_AUTOWIN = resolve(__dirname, '..', '..')
const ouverts: string[] = []

afterEach(() => {
  for (const depot of ouverts.splice(0)) {
    // Le lien vers les modules d'abord, et sans jamais le suivre : `supprimerArbre` ne traverse pas
    // une jonction, mais on ne lui laisse pas le choix.
    delierLesDependances(depot)
    supprimerArbre(resolve(depot, '..'))
  }
})

function git(depot: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: depot,
    windowsHide: true,
    stdio: 'ignore'
  })
}

function ecrire(depot: string, fichier: string, contenu: string): void {
  mkdirSync(resolve(depot, fichier, '..'), { recursive: true })
  writeFileSync(join(depot, fichier), contenu)
}

/** Dépôt minimal : un projet `tsconfig.node.json`, `a.ts` exporte `aligne`, `b.ts` l'appelle. */
function depotMinimal(dejaRouge = false): string {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'aw-typage-')))
  const depot = join(parent, 'depot')
  mkdirSync(depot)
  ouverts.push(depot)
  ecrire(
    depot,
    'tsconfig.node.json',
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true, types: [] },
      include: ['src/main/**/*']
    })
  )
  ecrire(depot, '.gitignore', 'node_modules\n')
  ecrire(depot, 'src/main/a.ts', 'export function aligne(chemin: string): string {\n  return chemin\n}\n')
  ecrire(depot, 'src/main/b.ts', "import { aligne } from './a'\nexport const r = aligne('x')\n")
  if (dejaRouge) ecrire(depot, 'src/main/c.ts', "export const n: number = 'deja rouge'\n")
  git(depot, 'init', '-q')
  git(depot, 'add', '-A')
  git(depot, 'commit', '-q', '-m', 'base')
  // Les modules du dépôt Autowin (pour `typescript`), reliés comme le fait une copie d'agent.
  symlinkSync(join(DEPOT_AUTOWIN, 'node_modules'), join(depot, 'node_modules'), 'junction')
  // L'ARBRE : le paramètre ajouté ET son appelant mis à jour — l'arbre compile.
  ecrire(depot, 'src/main/a.ts', 'export function aligne(chemin: string, args: string): string {\n  return chemin + args\n}\n')
  ecrire(depot, 'src/main/b.ts', "import { aligne } from './a'\nexport const r = aligne('x', 'y')\n")
  return depot
}

const typer = typeurTsc(process.execPath)

describe('typage de ce qui part, sur un vrai dépôt (cas 9d6bb850)', () => {
  it('publier la fonction SANS son appelant est refusé, avec l’erreur de l’appelant', async () => {
    const depot = depotMinimal()
    const verdict = await typerCeQuiPart({ repo: depot, fichiers: ['src/main/a.ts'], typer })
    expect(verdict).toMatchObject({ statut: 'echec', projets: ['node'] })
    if (verdict.statut !== 'echec') return
    expect(verdict.erreurs).toHaveLength(1)
    expect(verdict.erreurs[0]).toMatch(/^src\/main\/b\.ts: TS2554: /)
  }, 120_000)

  it('publier la fonction AVEC son appelant passe', async () => {
    const depot = depotMinimal()
    expect(await typerCeQuiPart({ repo: depot, fichiers: ['src/main/a.ts', 'src/main/b.ts'], typer })).toEqual({
      statut: 'vert',
      projets: ['node']
    })
  }, 120_000)

  it('une erreur déjà au dernier commit ne bloque pas une publication saine, elle est comptée', async () => {
    const depot = depotMinimal(true)
    expect(await typerCeQuiPart({ repo: depot, fichiers: ['src/main/a.ts', 'src/main/b.ts'], typer })).toEqual({
      statut: 'vert',
      projets: ['node'],
      dejaRouges: 1
    })
  }, 120_000)
})
