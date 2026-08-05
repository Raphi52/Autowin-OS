import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { workspaceIsolationNotice } from '../orchestrator'

/**
 * Régression du 2026-08-04 : un agent a réussi un `git stash` sur le dépôt réel, puis a conclu
 * « mon cwd est un worktree donc mon stash y est local, je ne peux rien certifier » et a rapporté
 * un ÉCHEC. Le raisonnement est faux (`refs/stash` est partagé entre worktrees) — mais rien ne le
 * lui disait : il a deviné sa propre topologie, et mal.
 *
 * Les autres correctifs du jour rendent le gate satisfiable ; aucun ne rend l'agent lucide sur
 * l'endroit où il se trouve. C'est le rôle de ce bloc, et de ces tests.
 */
describe('le bloc « où tu travailles »', () => {
  const BASE = 'C:/Amitel/Autowin OS'
  const WORKTREE = 'C:/Amitel/Autowin OS/.../worktrees/68fe/agent__run-73d5-1'

  it('reste VIDE quand le run tourne dans le dépôt de base', () => {
    // Sinon on paierait ce texte en contexte sur la majorité des runs, pour rien.
    expect(workspaceIsolationNotice(BASE, BASE)).toBe('')
  })

  it('reste vide si l’un des deux chemins manque', () => {
    expect(workspaceIsolationNotice('', BASE)).toBe('')
    expect(workspaceIsolationNotice(WORKTREE, '')).toBe('')
  })

  it('nomme les DEUX emplacements, pour que l’agent cesse de les deviner', () => {
    const notice = workspaceIsolationNotice(WORKTREE, BASE)
    expect(notice).toContain(WORKTREE)
    expect(notice).toContain(BASE)
  })

  it('dit explicitement que le stash est PARTAGÉ — le fait exact qui manquait', () => {
    const notice = workspaceIsolationNotice(WORKTREE, BASE)
    expect(notice).toMatch(/refs\/stash/)
    expect(notice).toMatch(/partag/i)
  })

  it('donne la forme d’action sur le dépôt réel, pas seulement l’avertissement', () => {
    const notice = workspaceIsolationNotice(WORKTREE, BASE)
    expect(notice).toContain(`git -C "${BASE}"`)
  })

  it('exige de CONSTATER après coup, au lieu de déduire', () => {
    const notice = workspaceIsolationNotice(WORKTREE, BASE)
    expect(notice).toMatch(/status --porcelain/)
    expect(notice).toMatch(/stash list/)
  })

  it('avertit qu’un run non vert ne fusionne pas la copie', () => {
    expect(workspaceIsolationNotice(WORKTREE, BASE)).toMatch(/non fusionn|que si le run/i)
  })
})

describe('le bloc est réellement CÂBLÉ dans les prompts', () => {
  // Un bloc parfait mais jamais injecté est du théâtre : on vérifie les points de montage.
  const source = readFileSync(join(__dirname, '..', 'orchestrator.ts'), 'utf8')

  it('est monté partout où un cwd de travail isolé est connu', () => {
    const mounts = [...source.matchAll(/name: 'workspaceIsolation'/g)]
    expect(mounts.length).toBeGreaterThanOrEqual(2)
  })

  it('est alimenté par le cwd du run et le workspace de base, pas par des constantes', () => {
    expect(source).toContain('workspaceIsolationNotice(workCwd, this.deps.executionWorkspace)')
  })
})
