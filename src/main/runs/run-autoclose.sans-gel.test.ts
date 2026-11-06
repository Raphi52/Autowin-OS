import { ChildProcess, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution } from '../gel/execution-hors-fil'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { captureCloseBaseline, defaultGitRunner } from './run-autoclose'

/**
 * LES `git` DE FIN DE TOUR NE SONT PLUS CRÉÉS SUR LE FIL PRINCIPAL (2026-10-31).
 *
 * Mesure `gels.jsonl`, session du 2026-10-31 19:33 → 20:22 UTC : `spawn git rev-parse` et
 * `spawn git status` depuis `run-autoclose.ts:532`, appelés par `chat-turn-publication.ts:136/138`
 * et `photo-du-code.ts:78/98` — 65 s de fenêtre figée, pire 19,9 s. Ce lanceur sert chaque
 * publication de tour, la photo du code et `garder-un-essai.ts`.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : `defaultGitRunner` qui repasse par `execFile` du fil principal.
 */
let depot = ''
beforeAll(() => {
  depot = mkdtempSync(join(tmpdir(), 'aos-autoclose-sans-gel-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: depot, windowsHide: true, stdio: 'ignore' })
  }
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  writeFileSync(join(depot, 'a.txt'), 'a')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'init')
  writeFileSync(join(depot, 'b.txt'), 'b')
})
afterAll(async () => {
  await arreterFilDExecution()
  await supprimerArbre(depot)
})

describe('defaultGitRunner', () => {
  it('photographie le dépôt sans créer un seul processus sur le fil principal', async () => {
    const creations = vi.spyOn(
      ChildProcess.prototype as unknown as { spawn: () => unknown },
      'spawn'
    )
    try {
      const photo = await captureCloseBaseline(depot, undefined)
      expect(photo.project).toContain('b.txt')
      expect(photo.projectHead).toMatch(/^[0-9a-f]{40}$/)
      expect(creations).not.toHaveBeenCalled()
    } finally {
      creations.mockRestore()
    }
  })

  it('ajoute l’environnement de la commande à celui du processus', async () => {
    const git = await defaultGitRunner()
    const sortie = await git(['var', 'GIT_AUTHOR_IDENT'], depot, {
      env: { GIT_AUTHOR_NAME: 'Marque 1413', GIT_AUTHOR_EMAIL: 'm@m' }
    })
    expect(sortie).toContain('Marque 1413 <m@m>')
  })
})
