// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_MODE_STORAGE_KEY,
  appliquerThemeMode,
  ecrireThemeMode,
  lireThemeMode
} from './theme-mode'

/**
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : rendre le mode clair par défaut, oublier de poser
 * `data-theme` sur la racine, ou retirer les surcharges claires de `theme-modes.css` — dans les
 * trois cas l'interrupteur de Settings · Interface ne changerait rien à l'écran.
 */
describe('mode d’affichage sombre / clair', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('démarre en sombre quand rien n’est mémorisé', () => {
    expect(lireThemeMode()).toBe('sombre')
  })

  it('ignore une valeur mémorisée invalide', () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'galaxy')
    expect(lireThemeMode()).toBe('sombre')
  })

  it('mémorise le clair et le pose sur la racine du document', () => {
    ecrireThemeMode('clair')
    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('clair')
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')
    expect(lireThemeMode()).toBe('clair')
  })

  it('revient au sombre en retirant l’attribut, sans laisser d’état bâtard', () => {
    ecrireThemeMode('clair')
    ecrireThemeMode('sombre')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(lireThemeMode()).toBe('sombre')
  })

  it('ne casse pas si le document est absent', () => {
    expect(() => appliquerThemeMode('clair')).not.toThrow()
  })

  it('la feuille de style porte bien des surcharges pour le mode clair', () => {
    // Chemin depuis la racine du dépôt : sous happy-dom, `import.meta.url` n'est pas un `file:`.
    const css = readFileSync('src/renderer/src/assets/theme-modes.css', 'utf8')
    // LA BASE, PAS LE NOM. Les surcharges claires visaient `data-theme=clair`, donc le seul
    // theme nomme ainsi. Mesure a l ecran le 2026-09-07 : Ardoise, Parchemin et Rose poudre
    // heritaient du fond clair SANS les corrections de texte -- gris pale sur blanc, illisible.
    // Elles visent desormais `data-base=clair`, pose par `appliquerThemeMode` d apres le
    // registre : tout theme de base claire en profite sans etre nomme nulle part.
    //
    // ENTREE QUI DOIT FAIRE ECHOUER CE CAS : reattacher une surcharge au NOM d un theme.
    // Le defaut reviendrait pour le theme clair suivant, en silence.
    expect(css).toMatch(/:root\[data-base='clair'\]/)
    expect(css).not.toMatch(/:root\[data-theme='clair'\]/)
    // Les contrôles natifs (listes, champs, ascenseurs) doivent suivre, sinon fond blanc sous
    // texte clair — exactement le défaut corrigé le 2026-09-02 dans theme.css.
    expect(css).toMatch(/color-scheme:\s*light/)
    for (const variable of ['--bg-0', '--text', '--line', '--text-dim']) {
      expect(css).toContain(`${variable}:`)
    }
  })
})
