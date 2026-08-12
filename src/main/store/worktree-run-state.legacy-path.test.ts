import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorktreeRunStateStore } from './worktree-run-state'

/**
 * UN CHEMIN ABSOLU NE SURVIT PAS À UN DÉMÉNAGEMENT.
 *
 * Mesuré le 2026-08-12 sur les données réelles : sur 218 enregistrements de bureaux, 52 sont
 * rendus « bloqués · state-unreadable » — soit exactement les 52 dont le `worktreePath` pointe
 * encore vers `C:\\Users\\…\\AppData\\Roaming\\autowin-os\\worktrees\\…`, l'emplacement d'AVANT le
 * passage au stockage portable `.autowin-data`. La migration a recopié les fichiers d'état sans
 * réécrire le chemin absolu qu'ils portent, donc `isRecord` les rejette pour toujours : 52 bureaux
 * définitivement illisibles, dont du travail vert jamais republié.
 *
 * C'est la cicatrice déjà connue de `claude-accounts.ts` (« l'état persistait `dir` en chemin
 * ABSOLU ; quand le userData a déménagé, un chemin absolu ne survit pas »), jamais appliquée ici.
 *
 * La réécriture reste STRICTE : on n'accepte un chemin étranger que si son dernier segment est
 * exactement `agent__<runId>`. Un chemin qui désigne autre chose reste illisible — on répare un
 * déménagement, on n'invente pas une identité.
 */
const ecrireEtat = (racine: string, runId: string, worktreePath: string): void => {
  const dossier = join(racine, '.runs')
  mkdirSync(dossier, { recursive: true })
  writeFileSync(
    join(dossier, `${runId}.json`),
    JSON.stringify({
      version: 1,
      repoId: 'depot-test',
      runId,
      agentName: 'Agent',
      worktreePath,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      verdict: 'green',
      publication: 'blocked',
      files: [{ path: 'src/renderer/src/components/Vue.tsx', kind: 'mod' }],
      createdAtMs: 1,
      updatedAtMs: 2
    }),
    'utf8'
  )
}

const nouvelleRacine = (): string => mkdtempSync(join(tmpdir(), 'wt-state-'))

describe('déménagement du dossier de données', () => {
  it('lit un état écrit avant la migration vers le stockage portable', () => {
    const racine = nouvelleRacine()
    const runId = 'run-0fef0aa544b4-1'
    ecrireEtat(
      racine,
      runId,
      `C:\\Users\\raphael.vilain\\AppData\\Roaming\\autowin-os\\worktrees\\68fe8b086ee864a1\\agent__${runId}`
    )
    const store = new WorktreeRunStateStore(racine, 'depot-test')
    const lu = store.get(runId)
    expect(lu?.attentionReason).toBeUndefined()
    expect(lu?.verdict).toBe('green')
    // Le chemin est ramené sous la racine COURANTE : c'est là que le bureau vit désormais.
    expect(lu?.worktreePath).toBe(join(racine, `agent__${runId}`))
  })

  it('n’invente pas une identité : un chemin qui désigne autre chose reste illisible', () => {
    const racine = nouvelleRacine()
    const runId = 'run-1d55262f187d-1'
    ecrireEtat(racine, runId, 'C:\\ailleurs\\agent__run-UN-AUTRE-BUREAU')
    const store = new WorktreeRunStateStore(racine, 'depot-test')
    expect(store.get(runId)?.attentionReason).toBe('state-unreadable')
  })

  it('laisse intact un état déjà écrit sous la racine courante', () => {
    const racine = nouvelleRacine()
    const runId = 'run-deja-bon-1'
    ecrireEtat(racine, runId, join(racine, `agent__${runId}`))
    const store = new WorktreeRunStateStore(racine, 'depot-test')
    const lu = store.get(runId)
    expect(lu?.attentionReason).toBeUndefined()
    expect(lu?.worktreePath).toBe(join(racine, `agent__${runId}`))
  })
})
