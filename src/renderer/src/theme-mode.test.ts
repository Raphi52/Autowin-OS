// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEMES,
  THEME_MODE_PAR_DEFAUT,
  THEME_MODE_STORAGE_KEY,
  appliquerThemeMode,
  ecrireThemeMode,
  lireThemeMode
} from './theme-mode'

/**
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : changer le thème par défaut (Holographique depuis le
 * 2026-10-11, conv-269), rendre le mode clair par défaut, oublier de poser
 * `data-theme` sur la racine, ou retirer les surcharges claires de `theme-modes.css` — dans les
 * trois cas l'interrupteur de Settings · Interface ne changerait rien à l'écran.
 */
describe('mode d’affichage sombre / clair', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-base')
  })

  /*
   * HOLOGRAPHIQUE PAR DEFAUT depuis le 2026-10-11 (conv-269, « le mode holographique est le mode
   * par defaut de autowin os desormais »). ENTREE QUI DOIT FAIRE ECHOUER CES CAS : remettre le
   * sombre en defaut, ou confondre le defaut avec l etat NU (le defaut retirerait alors
   * l attribut et l ecran resterait sombre).
   */
  it('démarre en Holographique quand rien n’est mémorisé', () => {
    expect(THEME_MODE_PAR_DEFAUT).toBe('nebuleuse-verre')
    expect(lireThemeMode()).toBe('nebuleuse-verre')
  })

  it('pose Holographique sur la racine au démarrage d’un poste neuf', () => {
    appliquerThemeMode(lireThemeMode())
    expect(document.documentElement.getAttribute('data-theme')).toBe('nebuleuse-verre')
    expect(document.documentElement.hasAttribute('data-base')).toBe(false)
  })

  it('garde le sombre pour un poste qui l’a CHOISI', () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'sombre')
    expect(lireThemeMode()).toBe('sombre')
    appliquerThemeMode(lireThemeMode())
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('ignore une valeur mémorisée invalide', () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'galaxy')
    expect(lireThemeMode()).toBe('nebuleuse-verre')
  })

  /*
   * SIX THEMES RETIRES le 2026-10-11 (conv-231, « supprime les theme nebula les 2 themes rose
   * versaille ardoise et parchemin »). Un poste qui en avait memorise un retombe sur le defaut.
   * ENTREE QUI DOIT FAIRE ECHOUER CE CAS : remettre l un d eux dans le registre ou sa feuille.
   */
  it('n’offre plus les six themes retires, et retombe sur le defaut si l’un etait memorise', () => {
    const retires = ['obsidian-nebula', 'solar-rose', 'rose-poudre', 'black-versailles', 'ardoise', 'parchemin']
    const css = readFileSync('src/renderer/src/assets/theme-modes.css', 'utf8')
    for (const id of retires) {
      expect(THEMES.map((t) => t.id)).not.toContain(id)
      expect(css).not.toContain(`data-theme='${id}'`)
      localStorage.setItem(THEME_MODE_STORAGE_KEY, id)
      expect(lireThemeMode()).toBe('nebuleuse-verre')
    }
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

  /*
   * LA BASE, pas seulement le nom. Toutes les surcharges claires visent data-base=clair : si
   * appliquerThemeMode cesse de poser cet attribut, Ardoise, Parchemin et Rose poudre heritent du
   * fond clair SANS les corrections de texte -- gris pale sur blanc, defaut mesure le 2026-09-07.
   * Rien ne le verrouillait jusqu ici : retirer ces trois lignes laissait la suite VERTE.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CES DEUX CAS : ne plus poser data-base, ou le poser pour tous.
   */
  it('pose la BASE du theme a cote de son nom, pour un theme clair NOMME', function () {
    ecrireThemeMode('holographique-clair')
    expect(document.documentElement.getAttribute('data-theme')).toBe('holographique-clair')
    expect(document.documentElement.getAttribute('data-base')).toBe('clair')
  })

  it('ne laisse AUCUNE base derriere lui quand on repasse a un theme sombre', function () {
    ecrireThemeMode('holographique-clair')
    ecrireThemeMode('nebuleuse-verre')
    expect(document.documentElement.getAttribute('data-theme')).toBe('nebuleuse-verre')
    expect(document.documentElement.hasAttribute('data-base')).toBe(false)
  })
  /*
   * `prefers-color-scheme` doit suivre la BASE du theme Autowin, pas Windows. Defaut constate le
   * 2026-10-08 (conv-111) : Windows clair + Autowin sombre -> le HTML du fil ecrivait en bleu marine
   * sur noir. ENTREE QUI DOIT FAIRE ECHOUER CE CAS : ne plus appeler `setColorScheme`, ou envoyer
   * `light` pour un theme sombre NOMME (nebuleuse-verre) ou `dark` pour un clair NOMME (holographique-clair).
   */
  it('annonce au processus principal le schema de couleurs de la BASE du theme', function () {
    const recus: string[] = []
    const g = globalThis as { api?: unknown }
    const avant = g.api
    g.api = { setColorScheme: (s: string) => (recus.push(s), Promise.resolve(true)) }
    try {
      appliquerThemeMode('sombre')
      appliquerThemeMode('holographique-clair')
      appliquerThemeMode('nebuleuse-verre')
      appliquerThemeMode('malvoyant-clair')
    } finally {
      g.api = avant
    }
    expect(recus).toEqual(['dark', 'light', 'dark', 'light'])
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
