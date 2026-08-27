import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * L'INTÉGRATION QUI JETTE DOIT DIRE POURQUOI.
 *
 * Mesuré le 2026-08-27 (conv-1427) : un run vert — rouge→vert prouvé, typecheck exit 0, juge
 * VALIDE — a fini en `red` sur `merge-failed`, avec pour seule explication « La finalisation Git a
 * échoué de façon inattendue. » Un `catch` sans paramètre avalait l'exception : ni le `RUN.md`, ni
 * le `causal-trace`, ni l'utilisateur n'ont jamais su ce qui avait échoué. 2,47 $ et 1,97 M tokens
 * de travail correct ont dû être récupérés à la main.
 *
 * Le défaut n'est pas que l'intégration échoue — ça, ça arrive. C'est qu'elle échoue MUETTE : la
 * cause réelle est la seule chose qui rend le run réparable, et c'était la seule chose jetée.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import { nettoyerRacines, roots, tempRepo } from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

describe('finalisation : une exception inattendue reste diagnosticable', () => {
  it('reporte le message de l’exception dans `detail` au lieu d’une phrase constante', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)

    const SENTINELLE = 'EPERM: git a été tué par l’antivirus'
    const tryGitFn = (dir: string, args: string[]): { code: number; stdout: string; stderr: string } => {
      // Seul le merge d'intégration jette : tout le reste du chemin doit rester réel, sinon on
      // testerait un scénario que la production ne produit jamais.
      if (args.includes('merge') && args.includes('--no-edit')) throw new Error(SENTINELLE)
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    const path = wm.acquire('builder')
    writeFileSync(join(path, 'a.txt'), 'travail de l’agent\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    const detail = (res as { detail?: string }).detail ?? ''
    // Ce que la phrase constante ne portait pas : de quoi réparer.
    expect(detail).toContain(SENTINELLE)
  })
})
