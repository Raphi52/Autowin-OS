import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, utimesSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { balayerTemporairesOrphelins } from './temporaires-orphelins'

/**
 * MESURE 2026-09-04 : 1 906 dossiers `autowin-os-*` dans le temp de Windows, dont 14 crees
 * AUJOURD'HUI par l'APPLICATION (paires `settings`/`system`, une par appel au CLI claude). Le
 * nettoyage de fin d'appel existe (`nettoyerTemporairesDeLAppel`) mais ne s'execute pas quand le
 * process parent meurt avant la fin du CLI (app fermee, crash). Un balayage borne par l'age
 * recupere ces orphelins-la, et EUX SEULS.
 */
describe('balayage des temporaires orphelins', () => {
  const vieux = (chemin: string, heures: number): void => {
    const t = new Date(Date.now() - heures * 3_600_000)
    utimesSync(chemin, t, t)
  }

  it('supprime un dossier d appel plus vieux que le seuil', () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-orphelins-'))
    const cible = join(racine, 'autowin-os-settings-abc123')
    mkdirSync(cible)
    vieux(cible, 48)
    const res = balayerTemporairesOrphelins(racine, 24 * 3_600_000)
    expect(res.supprimes).toEqual(['autowin-os-settings-abc123'])
    expect(existsSync(cible)).toBe(false)
  })

  it('epargne un dossier recent (appel possiblement en cours)', () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-orphelins-'))
    const cible = join(racine, 'autowin-os-system-def456')
    mkdirSync(cible)
    const res = balayerTemporairesOrphelins(racine, 24 * 3_600_000)
    expect(res.supprimes).toEqual([])
    expect(existsSync(cible)).toBe(true)
  })

  it('n approche pas ce qui n est pas un temporaire d appel', () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-orphelins-'))
    for (const nom of ['autowin-tests-appdata', 'autres-donnees', 'autowin-os-gemini-x']) {
      const c = join(racine, nom)
      mkdirSync(c)
      vieux(c, 999)
    }
    const res = balayerTemporairesOrphelins(racine, 24 * 3_600_000)
    expect(res.supprimes).toEqual([])
    expect(existsSync(join(racine, 'autowin-tests-appdata'))).toBe(true)
  })

  it('ne jette jamais sur une racine illisible', () => {
    expect(() =>
      balayerTemporairesOrphelins(join(tmpdir(), 'racine-absente-xyz-123'), 1)
    ).not.toThrow()
  })
})

describe('point d entree de production', () => {
  it('balayerOrphelinsUneFois supprime un orphelin reel du temp, une seule fois', async () => {
    const { balayerOrphelinsUneFois } = await import('./claude')
    const orphelin = mkdtempSync(join(tmpdir(), 'autowin-os-mcp-'))
    const t = new Date(Date.now() - 72 * 3_600_000)
    utimesSync(orphelin, t, t)
    balayerOrphelinsUneFois()
    expect(existsSync(orphelin)).toBe(false)

    // Deuxieme appel : garde « une fois par process » — le nouvel orphelin survit.
    const second = mkdtempSync(join(tmpdir(), 'autowin-os-mcp-'))
    utimesSync(second, t, t)
    balayerOrphelinsUneFois()
    expect(existsSync(second)).toBe(true)
  })
})
