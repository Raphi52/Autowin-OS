import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import {
  AGE_COPIE_DE_BASE_ORPHELINE_MS,
  balayerCopiesDeBaseOrphelines,
  ouvrirCopieDeBase
} from './comparaison-a-la-base'

/**
 * COPIES DE BASE ABANDONNÉES DANS `%TEMP%` (conv-1583, 2026-11-05, scout de conv-1576).
 *
 * Relevé du 05/11 : quatre `%TEMP%\aw-base-*` du 04/11 toujours sur le disque et toujours inscrites
 * dans `git worktree list` ; `aw-base-92mlRA\copie\node_modules` était encore une jonction vers
 * `D:\AutoWinOS\node_modules`. `fermer()` ne tourne pas quand le processus meurt avant (app relancée
 * pendant une publication, test coupé), et rien d'autre ne les retirait.
 *
 * Ces tests ABANDONNENT une vraie copie (`ouvrirCopieDeBase` sans `fermer()`) dans une racine jetable,
 * jamais dans le `%TEMP%` réel : le balayage d'un test ne doit pas toucher aux copies d'une
 * publication en cours sur ce poste.
 *
 * L'ENTRÉE QUI FERAIT ÉCHOUER UN BALAYAGE FAUX : la copie abandonnée porte une jonction vers le
 * `node_modules` du dépôt, qui contient `paquet/index.js`. Un balayage qui suivrait la jonction
 * (`git worktree remove --force`, ou une suppression récursive qui traverse les liens) viderait ce
 * fichier ; un balayage sans `git worktree prune` laisserait l'inscription dans `git worktree list`.
 */

const aNettoyer: string[] = []
afterEach(() => {
  for (const dossier of aNettoyer.splice(0)) supprimerArbre(dossier)
})

function git(depot: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'core.autocrlf=false',
      ...args
    ],
    { cwd: depot, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
}

/** Un dépôt commité avec un `node_modules` non suivi, et une racine jetable pour ses copies. */
function banc(): { depot: string; racine: string; module: string } {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'aw-balayage-base-')))
  aNettoyer.push(parent)
  const depot = join(parent, 'depot')
  const racine = join(parent, 'temp')
  mkdirSync(join(depot, 'src'), { recursive: true })
  mkdirSync(racine)
  writeFileSync(join(depot, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(depot, '.gitignore'), 'node_modules\n')
  const module = join(depot, 'node_modules', 'paquet', 'index.js')
  mkdirSync(dirname(module), { recursive: true })
  writeFileSync(module, 'module.exports = 1\n')
  git(depot, 'init', '-q')
  git(depot, 'add', '-A')
  git(depot, 'commit', '-q', '-m', 'base')
  return { depot, racine, module }
}

/** Ouvre une copie de base comme une publication, puis l'abandonne (processus mort avant `fermer`). */
async function copieAbandonnee(
  depot: string,
  racine: string,
  ageMs: number
): Promise<{ parent: string; chemin: string }> {
  const copie = await ouvrirCopieDeBase(depot, racine)
  const parent = dirname(copie.chemin)
  const date = new Date(Date.now() - ageMs)
  utimesSync(parent, date, date)
  return { parent, chemin: copie.chemin }
}

const inscrite = (depot: string, chemin: string): boolean =>
  git(depot, 'worktree', 'list', '--porcelain')
    .toLowerCase()
    .includes(chemin.replace(/\\/g, '/').toLowerCase())

describe('balayerCopiesDeBaseOrphelines — copies de base laissées par un processus mort', () => {
  it('retire la copie abandonnée, sa jonction et son inscription, sans toucher aux modules du dépôt', async () => {
    const { depot, racine, module } = banc()
    const vieille = await copieAbandonnee(depot, racine, AGE_COPIE_DE_BASE_ORPHELINE_MS + 60_000)
    // Le décor du relevé : jonction posée, copie inscrite.
    expect(lstatSync(join(vieille.chemin, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(inscrite(depot, vieille.chemin)).toBe(true)

    const bilan = await balayerCopiesDeBaseOrphelines({ racine })

    expect(bilan.echecs).toEqual([])
    expect(bilan.supprimees).toEqual([vieille.parent])
    expect(existsSync(vieille.parent)).toBe(false)
    expect(inscrite(depot, vieille.chemin)).toBe(false)
    // Le geste à ne jamais faire : vider la cible de la jonction.
    expect(existsSync(module)).toBe(true)
  })

  it('laisse intacte une copie plus jeune que la borne : une publication peut encore s’en servir', async () => {
    const { depot, racine, module } = banc()
    const recente = await copieAbandonnee(depot, racine, AGE_COPIE_DE_BASE_ORPHELINE_MS - 60_000)

    const bilan = await balayerCopiesDeBaseOrphelines({ racine })

    expect(bilan).toEqual({ supprimees: [], echecs: [] })
    expect(lstatSync(join(recente.chemin, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(inscrite(depot, recente.chemin)).toBe(true)
    expect(existsSync(module)).toBe(true)
  })

  it('ne touche qu’aux dossiers `aw-base-*`, même vieux', async () => {
    const { racine } = banc()
    const etranger = join(racine, 'autre-outil-abc')
    mkdirSync(etranger)
    writeFileSync(join(etranger, 'garde.txt'), 'à un autre programme\n')
    const date = new Date(Date.now() - 10 * AGE_COPIE_DE_BASE_ORPHELINE_MS)
    utimesSync(etranger, date, date)

    const bilan = await balayerCopiesDeBaseOrphelines({ racine })

    expect(bilan).toEqual({ supprimees: [], echecs: [] })
    expect(existsSync(join(etranger, 'garde.txt'))).toBe(true)
  })

  it('une racine illisible ne lève rien : le démarrage ne dépend pas de ce ménage', async () => {
    const bilan = await balayerCopiesDeBaseOrphelines({
      racine: join(tmpdir(), 'racine-absente-aw-base-xyz')
    })
    expect(bilan).toEqual({ supprimees: [], echecs: [] })
  })
})
