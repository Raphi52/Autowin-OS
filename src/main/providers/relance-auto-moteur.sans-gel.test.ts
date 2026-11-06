import { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution } from '../gel/execution-hors-fil'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { compilerLeMoteur } from './relance-auto-moteur'

/**
 * LA COMPILATION EN COULISSE NE TIENT PLUS LA FENÊTRE (2026-10-31).
 *
 * Mesure `gels.jsonl`, 2 jours au 2026-10-31 : `spawn electron.exe build` 103,2 s en 5 gels (pire
 * 69,2 s) et `rmSync` du dossier temporaire 47,4 s en 9 gels, depuis `compilerLeMoteur`. Elle se
 * relance dès qu'un fil modifie le moteur, donc plusieurs fois par heure quand plusieurs fils codent.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : `spawn` ou `rmSync` qui revient sur le fil principal.
 *
 * Le faux `electron-vite` écrit un fichier dans `--outDir` et note ce dossier à côté de lui : le
 * test ne dépend ni d'une vraie compilation (longue) ni du contenu du dossier temporaire partagé.
 */
const FAUX_OUTIL = `const fs = require('node:fs')
const path = require('node:path')
const dossier = process.argv[process.argv.indexOf('--outDir') + 1]
fs.writeFileSync(path.join(__dirname, 'dossier.txt'), dossier)
if (process.env.FAUX_ECHEC) {
  process.stderr.write('erreur de compilation inventée')
  process.exit(2)
}
fs.writeFileSync(path.join(dossier, 'index.js'), 'console.log(1)')
`

let racine = ''
const racines: string[] = []

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'aos-moteur-sans-gel-'))
  racines.push(racine)
  const bin = join(racine, 'node_modules', 'electron-vite', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'electron-vite.js'), FAUX_OUTIL)
})
afterEach(() => {
  delete process.env.FAUX_ECHEC
})
afterAll(async () => {
  await arreterFilDExecution()
  await Promise.all(racines.map((r) => supprimerArbre(r)))
})

function dossierDeSortie(): string {
  return readFileSync(join(racine, 'node_modules', 'electron-vite', 'bin', 'dossier.txt'), 'utf8')
}

describe('compilerLeMoteur — hors du fil principal', () => {
  it('compile sans créer de processus sur le fil principal, rend l’empreinte et vide son dossier', async () => {
    const creations = vi.spyOn(
      ChildProcess.prototype as unknown as { spawn: () => unknown },
      'spawn'
    )
    try {
      const resultat = await compilerLeMoteur(racine, process.execPath)
      expect(resultat).toMatchObject({ ok: true })
      expect(resultat.ok && resultat.empreinte).toMatch(/^[0-9a-f]{40}$/)
      expect(creations).not.toHaveBeenCalled()
      expect(existsSync(dossierDeSortie())).toBe(false)
    } finally {
      creations.mockRestore()
    }
  })

  it('une compilation en échec rend sa sortie d’erreur et vide aussi son dossier', async () => {
    process.env.FAUX_ECHEC = '1'
    const resultat = await compilerLeMoteur(racine, process.execPath)
    expect(resultat.ok).toBe(false)
    expect(!resultat.ok && resultat.erreur).toContain('erreur de compilation inventée')
    expect(existsSync(dossierDeSortie())).toBe(false)
  })

  it('un exécutable introuvable se dit « impossible à lancer », pas « arrêtée »', async () => {
    const resultat = await compilerLeMoteur(racine, join(racine, 'absent.exe'))
    expect(resultat.ok).toBe(false)
    expect(!resultat.ok && resultat.erreur).toContain('compilation impossible à lancer')
  })
})
