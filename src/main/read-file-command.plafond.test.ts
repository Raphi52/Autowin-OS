import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { enumererFichiersLisibles, enumererFichiersLisiblesDetail } from './read-file-command'

/**
 * LA RECHERCHE S'ARRÊTAIT AU PLAFOND EN SILENCE, AU FOND D'UN SEUL ARBRE.
 *
 * Mesuré le 2026-09-22 (conv-782) : `find_in_files` avec `dir: D:/AutoWinOS` n'a pas trouvé
 * `.arena/arenagame/lance-bras.sh`, qui existait. Le parcours en PROFONDEUR avait rempli les
 * 20 000 fichiers du plafond avec `bench/runs/` (≈ 17 000 fichiers de copies d'essais) et laissé
 * 10 dossiers jamais visités — et la réponse portait `tronque: false`.
 * Deux corrections : parcours PAR NIVEAUX (le peu profond passe avant le fond d'un gros arbre)
 * et un drapeau `incomplet` quand le plafond coupe l'énumération.
 */
describe('enumererFichiersLisibles — plafond atteint', () => {
  function arbre(): string {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-plafond-'))
    const profond = join(racine, 'bench/runs/r1/copie/src/a/b')
    mkdirSync(profond, { recursive: true })
    for (let i = 0; i < 30; i++) writeFileSync(join(profond, `f${i}.ts`), 'x', 'utf8')
    mkdirSync(join(racine, '.arena/arenagame'), { recursive: true })
    writeFileSync(join(racine, '.arena/arenagame/lance-bras.sh'), 'cible', 'utf8')
    return racine
  }

  it('un fichier peu profond est vu avant le fond d’un gros arbre', () => {
    const racine = arbre()
    try {
      expect(enumererFichiersLisibles(racine, '', 10)).toContain('.arena/arenagame/lance-bras.sh')
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('le plafond atteint est SIGNALÉ, jamais silencieux', () => {
    const racine = arbre()
    try {
      const d = enumererFichiersLisiblesDetail(racine, '', 10)
      expect(d.fichiers.length).toBe(10)
      expect(d.incomplet).toBe(true)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('CONTRE-EXEMPLE — sous le plafond, rien n’est signalé', () => {
    const racine = arbre()
    try {
      const d = enumererFichiersLisiblesDetail(racine)
      expect(d.fichiers.length).toBe(31)
      expect(d.incomplet).toBe(false)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
