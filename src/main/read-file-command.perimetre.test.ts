import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { enumererFichiersLisibles } from './read-file-command'

/**
 * LE PÉRIMÈTRE DE RECHERCHE IN-APP BALAYAIT LES DONNÉES ET LES ARTEFACTS D'AUDIT.
 *
 * Mesuré en pilotant l'app le 2026-08-19 : un scout lancé dans le chat a rendu comme candidat
 * « bouton ＋ Source future, ancrage
 * Audit/workspaces/20260813-…/app-data/autowin-os/Cache/Cache_Data/f_000075:292 » — un blob BINAIRE
 * du cache Chrome, lu comme du texte, présenté à l'utilisateur comme du code à corriger.
 *
 * `DOSSIERS_EXCLUS` couvrait `.git`, `node_modules`, `dist`, `out`, `coverage` : les artefacts de
 * BUILD. Il ignorait `.autowin-data` (le magasin vivant : conversations, runs, worktrees, cache
 * Electron) et `Audit` (les espaces de preuve, qui contiennent eux-mêmes des profils applicatifs
 * complets). Deux dossiers qui ne sont pas du code, pèsent lourd, et polluent chaque recherche.
 *
 * L'exclusion porte sur l'ÉNUMÉRATION seule : `read_file` a son propre chemin de décision
 * (`decideRead`), donc une lecture CIBLÉE dans ces dossiers reste possible. On refuse de les
 * BALAYER, pas d'y regarder quand on sait ce qu'on cherche.
 */
describe('enumererFichiersLisibles — le balayage évite les données et les preuves', () => {
  function arbre(): string {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-perimetre-'))
    for (const dossier of [
      'src/main',
      '.autowin-data/autowin-os/Cache/Cache_Data',
      'Audit/workspaces/20260813-x/rose-proof-profile/app-data/autowin-os/Cache',
      'node_modules/paquet',
      'graphify-out'
    ]) {
      mkdirSync(join(racine, dossier), { recursive: true })
    }
    writeFileSync(join(racine, 'src/main/vrai.ts'), 'export const x = 1', 'utf8')
    writeFileSync(
      join(racine, '.autowin-data/autowin-os/Cache/Cache_Data/f_000075'),
      'blob',
      'utf8'
    )
    writeFileSync(join(racine, '.autowin-data/conversations.json'), '{}', 'utf8')
    writeFileSync(
      join(racine, 'Audit/workspaces/20260813-x/rose-proof-profile/app-data/autowin-os/Cache/f_1'),
      'blob',
      'utf8'
    )
    writeFileSync(join(racine, 'node_modules/paquet/index.js'), 'x', 'utf8')
    writeFileSync(join(racine, 'graphify-out/graph.json'), '{}', 'utf8')
    return racine
  }

  it('n’énumère ni le magasin vivant ni les espaces de preuve', () => {
    const racine = arbre()
    try {
      const fichiers = enumererFichiersLisibles(racine)
      expect(fichiers).toContain('src/main/vrai.ts')
      expect(fichiers.filter((f) => f.startsWith('.autowin-data'))).toEqual([])
      expect(fichiers.filter((f) => f.startsWith('Audit/'))).toEqual([])
      expect(fichiers.filter((f) => f.startsWith('graphify-out'))).toEqual([])
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('CONTRE-EXEMPLE — les exclusions de build tiennent toujours', () => {
    const racine = arbre()
    try {
      expect(enumererFichiersLisibles(racine).filter((f) => f.startsWith('node_modules'))).toEqual(
        []
      )
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('CONTRE-EXEMPLE — un sous-dossier explicitement demandé reste énumérable', () => {
    const racine = arbre()
    try {
      // On refuse de BALAYER le magasin, pas d'y regarder quand l'appelant le nomme.
      expect(enumererFichiersLisibles(racine, '.autowin-data').length).toBeGreaterThan(0)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
