import { describe, expect, it } from 'vitest'
import { WorktreeRunStateStore } from './worktree-run-state'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * RÉSOUDRE UN CONFLIT NE DOIT PAS ÊTRE IMPOSSIBLE.
 *
 * Mesuré le 2026-08-12 en cliquant réellement la résolution sur les trois conflits en attente :
 * les trois rendent « Manifeste de bureau invalide: run-… ». La fonctionnalité est morte-née.
 *
 * Cause : `resolveConflictAsync` passe la publication à `integrating` (l. 942) SANS effacer
 * `conflictBaseSha` / `conflictAgentSha`, alors que `isRecord` n'autorise ces deux champs QUE
 * lorsque `publication === 'blocked'` ET `verdict === 'green'`. Le premier `save()` de la
 * résolution viole donc l'invariant qu'il vient lui-même de rendre faux.
 *
 * Les SHA de conflit décrivent l'état BLOQUÉ ; une fois la résolution engagée ils ne décrivent
 * plus rien. Les effacer est la lecture juste — et les SHA nécessaires à la fusion vivent dans des
 * champs distincts (`publicationAgentSha`, `publicationBaseSha`), remplis par `onIntegrated`.
 */
const SHA = 'a'.repeat(40)

const enregistrementEnConflit = (runId: string, racine: string) => ({
  version: 1 as const,
  repoId: 'depot-test',
  runId,
  agentName: 'Agent',
  worktreePath: join(racine, `agent__${runId}`),
  baseBranch: 'main',
  baseSha: SHA,
  verdict: 'green' as const,
  publication: 'blocked' as const,
  conflictFile: 'src/a.ts',
  conflictBaseSha: 'b'.repeat(40),
  conflictAgentSha: 'c'.repeat(40),
  files: [{ path: 'src/a.ts', kind: 'mod' as const }],
  createdAtMs: 1,
  updatedAtMs: 2
})

describe('manifeste pendant la résolution d’un conflit', () => {
  it('accepte l’état bloqué porteur des deux SHA de conflit', () => {
    const racine = mkdtempSync(join(tmpdir(), 'wt-conflit-'))
    try {
      const store = new WorktreeRunStateStore(racine, 'depot-test')
      expect(() => store.save(enregistrementEnConflit('run-a', racine))).not.toThrow()
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('accepte le passage à « integrating » une fois les SHA de conflit effacés', () => {
    const racine = mkdtempSync(join(tmpdir(), 'wt-conflit-'))
    try {
      const store = new WorktreeRunStateStore(racine, 'depot-test')
      const base = enregistrementEnConflit('run-b', racine)
      const enResolution = {
        ...base,
        publication: 'integrating' as const,
        conflictFile: undefined,
        conflictBaseSha: undefined,
        conflictAgentSha: undefined
      }
      expect(() => store.save(enResolution)).not.toThrow()
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('REFUSE « integrating » tant que les SHA de conflit traînent — l’invariant qui piégeait', () => {
    const racine = mkdtempSync(join(tmpdir(), 'wt-conflit-'))
    try {
      const store = new WorktreeRunStateStore(racine, 'depot-test')
      const piege = { ...enregistrementEnConflit('run-c', racine), publication: 'integrating' as const }
      expect(() => store.save(piege)).toThrow(/Manifeste de bureau invalide/)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
