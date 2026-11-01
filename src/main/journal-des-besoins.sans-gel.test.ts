import { ChildProcess, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution } from './execution-hors-fil'
import { supprimerArbre } from './fs-supprimer'
import { identiteGitDuDossier } from './journal-des-besoins'

/**
 * L'IDENTITÉ GIT DU JOURNAL DES BESOINS NE CRÉE PLUS DE PROCESSUS SUR LE FIL PRINCIPAL (conv-1413).
 *
 * Mesure `gels.jsonl`, session du 2026-10-31 19:33 → 20:22 UTC : `spawn git config` depuis
 * `journal-des-besoins.ts:61`, 6 appels, 19,3 s de fenêtre figée.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : le `git config` par défaut créé par `execFile` du fil principal.
 */
let depot = ''
beforeAll(() => {
  depot = mkdtempSync(join(tmpdir(), 'aos-besoins-sans-gel-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: depot, windowsHide: true, stdio: 'ignore' })
  }
  git('init', '-q')
  git('config', 'user.name', 'Demandeur 1413')
  git('config', 'user.email', 'd@1413')
})
afterAll(async () => {
  await arreterFilDExecution()
  await supprimerArbre(depot)
})

describe('identiteGitDuDossier — git par défaut', () => {
  it('lit l’identité locale du dépôt sans créer un seul processus sur le fil principal', async () => {
    const creations = vi.spyOn(
      ChildProcess.prototype as unknown as { spawn: () => unknown },
      'spawn'
    )
    try {
      expect(await identiteGitDuDossier(depot)).toEqual({ nom: 'Demandeur 1413', email: 'd@1413' })
      expect(creations).not.toHaveBeenCalled()
    } finally {
      creations.mockRestore()
    }
  })
})
