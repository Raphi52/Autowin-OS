import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE SCÉNARIO DE L'UTILISATEUR, ÉCRIT TEL QU'IL L'A DEMANDÉ : « lancer 3 convers sur la même chose,
 * pas d'erreur avant de se lancer au travail, et pas de workspace orphelin à la fin ».
 *
 * POURQUOI CE FICHIER EXISTE. Vingt-deux commits portent déjà sur les copies orphelines, et le
 * problème revient — l'utilisateur dit l'avoir demandé quinze fois. La suite de concurrence compte
 * vingt tests, tous solides et tous sur un chemin d'échec ISOLÉ : crash avant le lien atomique, PID
 * recyclé, hook qui modifie l'index, compensation qui échoue. Aucun ne joue le geste réel.
 *
 * C'est la forme même d'un défaut qui ne meurt pas : chaque correctif reçoit le test de SON chemin,
 * et le scénario que l'utilisateur exécute vraiment n'est couvert par personne. Vingt tests verts
 * ne disaient donc rien sur la question posée.
 *
 * REPRODUIT le 2026-08-24 avec de VRAIS dépôts git : trois conversations sur la même base rendent
 * `merged`, `conflict`, `conflict` — et les deux copies en conflit restaient sur le disque.
 *
 * Ce fichier ne teste aucun chemin interne. Il teste la PROMESSE.
 */

type Appels = {
  preserves: string[]
  restaures: string[]
}

const coordinateur = (
  issues: Record<string, { outcome: string; files?: string[]; reason?: string }>
): { co: RunWorktreeCoordinator; appels: Appels } => {
  const appels: Appels = { preserves: [], restaures: [] }
  const co = new RunWorktreeCoordinator({
    manager: {
      workspacePath: '/repo',
      describe: () => ({
        workspacePath: '/repo',
        baseBranch: 'main',
        baseSha: '1111111'
      }),
      acquire: (id: string) => `/wt/${id}`,
      finalize: (id: string) => issues[id] ?? { outcome: 'merged' },
      changedFiles: () => [],
      listAgentIds: () => [],
      hasActiveProcesses: () => false,
      remove: () => {},
      preserverEtLiberer: (id: string) => {
        appels.preserves.push(id)
        return { outcome: 'preserve-et-libere' }
      },
      restaurerCopieDepuisSecours: (id: string) => {
        appels.restaures.push(id)
        return true
      }
    } as never,
    nowFn: () => 1
  } as never)
  co.arreterLeBalayageAutomatique()
  return { co, appels }
}

const CONFLIT = { outcome: 'conflict', files: ['a.txt'], baseSha: 'b', agentSha: 'a' }

describe('trois conversations sur la même chose', () => {
  it('démarrent toutes les trois sans la moindre erreur avant de se mettre au travail', () => {
    const { co } = coordinateur({})

    const bureaux = ['conv-1', 'conv-2', 'conv-3'].map((id) => co.begin(id, 'Builder', true))

    expect(bureaux).toEqual(['/wt/conv-1', '/wt/conv-2', '/wt/conv-3'])
  })

  it('ne laissent AUCUN workspace derrière elles quand elles se marchent dessus', () => {
    // Le cas mesuré : la première publie, les deux autres partent en conflit. Leurs copies doivent
    // être RANGÉES — travail préservé sur une branche de secours, disque libéré.
    const { co, appels } = coordinateur({ 'conv-2': CONFLIT, 'conv-3': CONFLIT } as never)
    for (const id of ['conv-1', 'conv-2', 'conv-3']) co.begin(id, 'Builder', true)

    for (const id of ['conv-1', 'conv-2', 'conv-3']) co.end(id)

    expect(appels.preserves).toEqual(['conv-2', 'conv-3'])
  })

  it('ne range JAMAIS la copie d’un travail qui a publié — il n’y a rien à sauver', () => {
    // L'entrée qui doit faire échouer un rangement trop zélé : tout s'est bien passé.
    const { co, appels } = coordinateur({})
    co.begin('conv-1', 'Builder', true)

    co.end('conv-1')

    expect(appels.preserves).toEqual([])
  })

  it('rend la copie au moment d’arbitrer — sinon ranger casserait le bouton de résolution', async () => {
    // La contrepartie qui rend la libération légitime. Sans elle, on aurait échangé un dossier qui
    // traîne contre un conflit impossible à trancher : un pire défaut que celui qu'on corrige.
    const { co, appels } = coordinateur({ 'conv-2': CONFLIT } as never)
    co.begin('conv-2', 'Builder', true)
    co.end('conv-2')
    const manager = (co as unknown as { manager: Record<string, unknown> }).manager
    manager.finalizeAsync = vi.fn(async () => ({ outcome: 'merged', publishedSha: 'p' }))

    await co.resolveConflictAsync('conv-2', 'agent')

    expect(appels.restaures).toEqual(['conv-2'])
  })

  it('un run qui n’a RIEN écrit ne laisse pas de bureau derrière lui', () => {
    // MESURÉ dans l'app réelle : trois conversations finissent `ready` / `not-requested` avec
    // `files: 0`, et leurs trois copies restaient sur le disque. Il n'y a aucune décision humaine
    // à prendre au sujet de rien.
    const { co, appels } = coordinateur({})
    co.begin('vide', 'Builder', true)

    co.end('vide', { merge: false } as never)

    expect(appels.preserves).toEqual(['vide'])
  })

  it('un run qui a écrit QUELQUE CHOSE garde son bureau — c’est là qu’une décision existe', () => {
    // L'entrée qui doit faire échouer un rangement trop large.
    const { co, appels } = coordinateur({})
    const manager = (co as unknown as { manager: Record<string, unknown> }).manager
    manager.changedFiles = () => ['a.txt']
    co.begin('avec-travail', 'Builder', true)

    co.end('avec-travail', { merge: false } as never)

    expect(appels.preserves).toEqual([])
  })
})
