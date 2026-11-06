import { ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution } from '../gel/execution-hors-fil'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { readGitState } from '../git/git-read-main'
import { typeurTsc } from './typage-avant-publication'

/**
 * LECTURES GIT ET TYPAGE NE CRÉENT PLUS LEUR PROCESSUS SUR LE FIL PRINCIPAL (conv-1413, 2026-10-31).
 *
 * Mesure `gels.jsonl`, session du 2026-10-31 depuis 19:33 UTC : `spawn git status` 11,8 s et
 * `spawn git diff` 9,1 s depuis `git-read-main.ts`, `spawn electron.exe` 16 s depuis
 * `typage-avant-publication.ts`.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : l'un de ces lanceurs qui repasse par `execFile` ou `spawn` du fil
 * principal.
 */
const dossiers: string[] = []

afterAll(async () => {
  await arreterFilDExecution()
  await Promise.all(dossiers.map((d) => supprimerArbre(d)))
})

function espionDesCreations(): { mockRestore(): void; mock: { calls: unknown[] } } {
  return vi.spyOn(ChildProcess.prototype as unknown as { spawn: () => unknown }, 'spawn')
}

describe('readGitState', () => {
  it('lit le dépôt sans créer un seul processus sur le fil principal', async () => {
    const creations = espionDesCreations()
    try {
      const etat = await readGitState(process.cwd(), 1)
      expect(etat.available).toBe(true)
      expect(creations.mock.calls).toHaveLength(0)
    } finally {
      creations.mockRestore()
    }
  })
})

describe('typeurTsc', () => {
  function fauxTsc(corps: string): string {
    const racine = mkdtempSync(join(tmpdir(), 'aos-typeur-sans-gel-'))
    dossiers.push(racine)
    const lib = join(racine, 'node_modules', 'typescript', 'lib')
    mkdirSync(lib, { recursive: true })
    writeFileSync(join(lib, 'tsc.js'), corps)
    return racine
  }

  it('type sans créer de processus sur le fil principal, et rend le code 0', async () => {
    const creations = espionDesCreations()
    try {
      const resultat = await typeurTsc(process.execPath)(fauxTsc(''), 'node')
      expect(resultat).toMatchObject({ lancee: true, exitCode: 0 })
      expect(creations.mock.calls).toHaveLength(0)
    } finally {
      creations.mockRestore()
    }
  })

  it('un typage rouge rend son code de sortie et ses erreurs', async () => {
    const racine = fauxTsc(`console.log('a.ts(1,1): error TS2322: inventée'); process.exit(2)`)
    const resultat = await typeurTsc(process.execPath)(racine, 'node')
    expect(resultat).toMatchObject({ lancee: true, exitCode: 2 })
    expect(resultat.sortie).toContain('TS2322')
  })

  it('un exécutable introuvable se dit « impossible à lancer »', async () => {
    const resultat = await typeurTsc(join(tmpdir(), 'absent-aos.exe'))(fauxTsc(''), 'node')
    expect(resultat.lancee).toBe(false)
    expect(resultat.raison).toContain('tsc impossible à lancer')
  })
})
