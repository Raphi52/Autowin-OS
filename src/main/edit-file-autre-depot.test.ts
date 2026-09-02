import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppCommandBus } from './commands'

/**
 * ECRIRE DANS UN AUTRE DEPOT — le mur mesure en conv-12 (2026-09-02).
 *
 * L'utilisateur travaillait sur `D:\GIT\RigApplication`, sur sa branche, et demandait la
 * modification de `ULT_TT_INPI.cs` en annoncant qu'il compilerait et committerait lui-meme. Les
 * quatre voies d'ecriture ont ete refusees — dont `edit_file` avec « chemin hors du workspace » —
 * apres 4 appels de modele (~1,06 $), pour finir sur un patch a coller a la main.
 *
 * Ce test prouve les deux moities du correctif :
 *   1. le fichier de l'AUTRE depot est reellement modifie sur le disque ;
 *   2. aucun bureau isole n'est ouvert (`worktrees.begin` jamais appele) — la machinerie de
 *      verification vitest d'Autowin ne s'applique pas a un depot .NET etranger.
 */
function osMinimal(executionWorkspace: string): any {
  return {
    executionWorkspace,
    worktrees: {
      begin: vi.fn(() => undefined),
      end: vi.fn(() => ({ outcome: 'merged', agentId: 'command', committed: true }))
    },
    conversations: { get: () => undefined, list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
}

describe('edit_file — cible dans un AUTRE depot', () => {
  it('modifie le fichier externe sur disque, sans ouvrir de bureau isole', async () => {
    const autowin = mkdtempSync(join(tmpdir(), 'aos-workspace-'))
    const autreDepot = mkdtempSync(join(tmpdir(), 'aos-autre-depot-'))
    try {
      const cible = join(autreDepot, 'ULT_TT_INPI.cs')
      writeFileSync(cible, 'var cle = "INPI_MODELE_EMAIL_IMR_REFUS";\n', 'utf8')
      const os = osMinimal(autowin)
      const bus = new AppCommandBus(os, () => {})

      const result = await bus.exec(
        'edit_file',
        {
          path: cible,
          oldText: '"INPI_MODELE_EMAIL_IMR_REFUS"',
          newText: '"INPI_MODELE_EMAIL_IMR_REFUS_MICRO"'
        },
        'conv-12'
      )

      expect(result).toMatchObject({ ok: true, data: { allowed: true } })
      expect(readFileSync(cible, 'utf8')).toContain('INPI_MODELE_EMAIL_IMR_REFUS_MICRO')
      expect(os.worktrees.begin).not.toHaveBeenCalled()
    } finally {
      rmSync(autowin, { recursive: true, force: true })
      rmSync(autreDepot, { recursive: true, force: true })
    }
  })

  it('refuse encore une racine SYSTEME, en le disant', async () => {
    const autowin = mkdtempSync(join(tmpdir(), 'aos-workspace-'))
    try {
      const bus = new AppCommandBus(osMinimal(autowin), () => {})

      const result = await bus.exec(
        'edit_file',
        { path: 'C:/Windows/system.ini', oldText: 'a', newText: 'b' },
        'conv-12'
      )

      expect(result).toMatchObject({ ok: true, data: { allowed: false } })
      expect(String((result.data as { reason?: string }).reason)).toContain('racine système')
    } finally {
      rmSync(autowin, { recursive: true, force: true })
    }
  })
})
