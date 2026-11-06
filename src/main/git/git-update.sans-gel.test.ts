import { ChildProcess, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution } from '../gel/execution-hors-fil'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { checkForUpdate } from './git-update'

/**
 * LA VÉRIFICATION DE MISE À JOUR NE CRÉE PLUS SES `git` SUR LE FIL PRINCIPAL (2026-10-31).
 *
 * Mesure `gels.jsonl`, session du 2026-10-31 19:33 → 20:22 UTC : `spawn git diff` (8 appels, 67 s,
 * pire 22,9 s) et `spawn git fetch` (19,6 s) depuis `git-update.ts:28`, sous `ipc:update:check`
 * (7 gels, 68 s). La sonde tourne toutes les 3 minutes et lance jusqu'à 7 `git` : chacun tenait la
 * fenêtre le temps de sa création.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : le lanceur par défaut qui repasse par `execFile` du fil principal.
 */
let depot = ''
beforeAll(() => {
  depot = mkdtempSync(join(tmpdir(), 'aos-maj-sans-gel-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: depot, windowsHide: true, stdio: 'ignore' })
  }
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  writeFileSync(join(depot, 'a.txt'), 'a')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'init')
})
afterAll(async () => {
  await arreterFilDExecution()
  await supprimerArbre(depot)
})

describe('checkForUpdate — lanceur par défaut', () => {
  it('interroge git sans créer un seul processus sur le fil principal', async () => {
    const creations = vi.spyOn(
      ChildProcess.prototype as unknown as { spawn: () => unknown },
      'spawn'
    )
    try {
      const statut = await checkForUpdate(depot)
      // Dépôt sans distant : rien à annoncer, mais git a bien été interrogé (sinon pas d'erreur fetch).
      expect(statut.available).toBe(false)
      expect(statut.behind).toBe(0)
      expect(creations).not.toHaveBeenCalled()
    } finally {
      creations.mockRestore()
    }
  })
})
