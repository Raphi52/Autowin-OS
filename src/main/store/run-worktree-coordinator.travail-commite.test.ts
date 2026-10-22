import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

/*
 * UN TRAVAIL DÉJÀ COMMITÉ DANS LA COPIE N'EST PAS UNE COPIE VIDE (conv-1074, 2026-10-22).
 *
 * Vécu : run-bc699a65bae7-1, juge 88/100, fusion refusée `base-dirty` (7 fichiers du commit
 * modifiés sans être commités dans le dépôt réel). L'agent avait commité ses 35 fichiers DANS sa
 * copie, puis lancé `git -C D:/AutoWinOS fetch` et `status` sur le dépôt réel. La mesure de la copie
 * ne lisait que `git status` : vide. L'orchestrateur a donc conclu à une livraison par Git externe
 * (`externalGitMutationDelivered`, orchestrator.ts), le run a été déclaré intégré, et la cause
 * `base-dirty` n'a jamais atteint le journal du RUN.md — seul « Commit demande sans identite Git
 * publiee verifiable » y figurait.
 *
 * Vrais dépôts git en tmp : sous la charge de la suite complète, ces I/O dépassent les 5 s par
 * défaut (voir worktree-manager.publication.test.ts) ; trois tests courts, budget à 60 s.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

afterEach(nettoyerRacines)

function copieDeRun(runId: string): { co: RunWorktreeCoordinator; copie: string } {
  const repo = tempRepo()
  const co = new RunWorktreeCoordinator({ manager: manager(repo), nowFn: () => 1 })
  const copie = co.begin(runId, 'Builder', true)
  if (!copie) throw new Error('la copie du run n’a pas été créée')
  return { co, copie }
}

describe('coordinateur — la mesure de la copie compte le travail déjà commité', () => {
  it('copie dont l’agent a commité son travail (git status vide) → la mesure nomme ses fichiers', async () => {
    const { co, copie } = copieDeRun('run-commite')
    writeFileSync(join(copie, 'b.txt'), 'travail de l’agent\n')
    git(copie, 'add', '-A')
    git(copie, 'commit', '-q', '-m', 'travail de l’agent')
    expect(git(copie, 'status', '--porcelain')).toBe('')

    await expect(co.fichiersChangesDeLaCopie('run-commite')).resolves.toEqual(['b.txt'])
  })

  it('travail commité ET fichier libre → les deux, sans doublon', async () => {
    const { co, copie } = copieDeRun('run-mixte')
    writeFileSync(join(copie, 'b.txt'), 'commité\n')
    git(copie, 'add', '-A')
    git(copie, 'commit', '-q', '-m', 'commité')
    writeFileSync(join(copie, 'b.txt'), 'commité puis retouché\n')
    writeFileSync(join(copie, 'c.txt'), 'libre\n')

    const mesure = await co.fichiersChangesDeLaCopie('run-mixte')
    expect([...mesure].sort()).toEqual(['b.txt', 'c.txt'])
  })

  it('copie sans aucun travail → vide : la livraison par Git externe reste possible', async () => {
    const { co } = copieDeRun('run-vide')
    await expect(co.fichiersChangesDeLaCopie('run-vide')).resolves.toEqual([])
  })
})
