import { describe, expect, it } from 'vitest'
import { couleurDeBranche, teinteDeBranche } from './git-graph-couleurs'

/**
 * « Que les couleurs des branches pop un peu au pif » — demande de l'utilisateur, 2026-09-15.
 *
 * « Au pif » veut dire IMPRÉVISIBLE À L'ŒIL, pas TIRÉE AU SORT : une couleur retirée à chaque rendu
 * ferait changer le graphe de couleurs à chaque rafraîchissement, et une branche suivie des yeux
 * d'une ligne à l'autre deviendrait intraçable. La couleur est donc une FONCTION du nom.
 */
describe('couleur de branche — stable, pas aléatoire', () => {
  it('rend EXACTEMENT la même couleur pour le même nom, appel après appel', () => {
    expect(couleurDeBranche('feat/cockpit')).toBe(couleurDeBranche('feat/cockpit'))
    expect(teinteDeBranche('main')).toBe(teinteDeBranche('main'))
  })

  it('rend une couleur CSS utilisable telle quelle', () => {
    expect(couleurDeBranche('main')).toMatch(/^hsl\(\d{1,3} \d{1,3}% \d{1,3}%\)$/)
  })

  it('étale les teintes : 12 branches réelles donnent au moins 10 teintes distinctes', () => {
    const noms = [
      'main',
      'dev',
      'feat/cockpit',
      'feat/worktree',
      'fix/interlocuteurs',
      'origin/main',
      'agent__run-a894d972d218-1',
      'Feature/EDP/DetailInstance',
      'Feature/EDP/DemandeCycleDeVie',
      'release/1.0',
      'hotfix/urgent',
      'chore/deps'
    ]
    expect(new Set(noms.map(teinteDeBranche)).size).toBeGreaterThanOrEqual(10)
  })

  it('sépare deux branches voisines d’un seul caractère', () => {
    // Le piège d'un hachage trop naïf (somme des codes) : `feat/a` et `feat/b` finissent voisins,
    // et deux branches sœurs deviennent indiscernables — exactement le cas le plus fréquent ici.
    const ecart = Math.abs(teinteDeBranche('feat/a') - teinteDeBranche('feat/b'))
    expect(Math.min(ecart, 360 - ecart)).toBeGreaterThan(25)
  })

  /** CAS LIMITE — nom vide : aucune exception, une couleur valide et stable. */
  it('ne casse pas sur un nom vide', () => {
    expect(couleurDeBranche('')).toMatch(/^hsl\(/)
    expect(couleurDeBranche('')).toBe(couleurDeBranche(''))
  })

  /** CAS LIMITE — nom très long et non-ASCII : le hachage reste borné à un tour de roue. */
  it('reste dans la roue des teintes sur un nom long et accentué', () => {
    const teinte = teinteDeBranche('féature/très-longue-branche-'.repeat(40))
    expect(teinte).toBeGreaterThanOrEqual(0)
    expect(teinte).toBeLessThan(360)
  })

  /** CAS LIMITE — la casse compte comme un nom différent, mais ne doit pas jeter. */
  it('traite deux casses comme deux noms, sans exception', () => {
    expect(() => couleurDeBranche('Main')).not.toThrow()
    expect(couleurDeBranche('Main')).not.toBe(couleurDeBranche('main'))
  })
})
