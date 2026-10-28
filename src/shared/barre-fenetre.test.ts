import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HAUTEUR_BOUTONS_FENETRE } from './barre-fenetre'

/**
 * Le gris de survol des boutons de fenêtre (dessinés par Windows) débordait de 4 px sur le haut
 * de la vue : boutons de 28 px, vue qui commence à 24 px (constaté le 2026-10-28, conv-1223).
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : remonter `HAUTEUR_BOUTONS_FENETRE` au-dessus de `--s5`,
 * changer la marge du haut de `.main`, ou remettre une hauteur en dur dans `window.ts` / `index.ts`.
 */
const racine = join(__dirname, '..', '..')
const lire = (chemin: string): string => readFileSync(join(racine, chemin), 'utf8')

describe('hauteur des boutons de fenêtre', () => {
  it('tient dans la marge du haut de la vue (.main padding = --s5)', () => {
    const theme = lire('src/renderer/src/assets/theme.css')
    const s5 = theme.match(/--s5:\s*(\d+)px/)
    expect(s5, '--s5 introuvable dans theme.css').not.toBeNull()
    expect(HAUTEUR_BOUTONS_FENETRE).toBeLessThanOrEqual(Number(s5![1]))

    const shell = lire('src/renderer/src/assets/app-shell.css')
    const main = shell.match(/\n\.main \{[^}]*\}/)
    expect(main, 'règle .main introuvable dans app-shell.css').not.toBeNull()
    expect(main![0]).toMatch(/\bpadding:\s*var\(--s5\);/)
  })

  /*
   * SOUS 100 % DE ZOOM, les boutons (en pixels d'écran) deviennent plus hauts que var(--s5) (en
   * pixels de page) : la marge du haut doit suivre leur hauteur convertie au zoom, que Chromium
   * donne par `env(titlebar-area-height)` (mesuré le 2026-10-28, conv-1223 : 30 px à 80 %).
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER : remettre var(--s5) en haut de `.main` ou du menu, dans
   * app-shell.css ou dans un thème qui redéfinit la marge du menu.
   */
  it('la marge du haut de la vue et du menu suit le zoom', () => {
    const theme = lire('src/renderer/src/assets/theme.css')
    expect(theme).toMatch(
      /--marge-haut-vue:\s*max\(var\(--s5\),\s*env\(titlebar-area-height,\s*0px\)\);/
    )

    const shell = lire('src/renderer/src/assets/app-shell.css')
    expect(shell.match(/\n\.main \{[^}]*\}/)![0]).toMatch(/padding-top:\s*var\(--marge-haut-vue\);/)
    expect(shell.match(/\n\.rail \{[^}]*\}/)![0]).toMatch(
      /margin-block:\s*var\(--marge-haut-vue\)\s+var\(--s5\);/
    )
    expect(shell.match(/\n\.shell::before \{[^}]*\}/)![0]).toMatch(
      /height:\s*var\(--marge-haut-vue\);/
    )

    for (const fichier of ['theme-nebuleuse-verre.css', 'theme-holographique-clair.css']) {
      const regle = lire(`src/renderer/src/assets/${fichier}`).match(
        /\.theme-serious \.rail \{[^}]*\}/
      )
      expect(regle, `règle du menu introuvable dans ${fichier}`).not.toBeNull()
      expect(regle![0]).toMatch(/margin:\s*var\(--marge-haut-vue\)\s/)
    }
  })

  it('est la même valeur à la création de la fenêtre et au changement de thème', () => {
    const fenetre = lire('src/main/window.ts')
    const index = lire('src/main/index.ts')
    expect(fenetre).toMatch(/titleBarOverlay:\s*\{[^}]*height:\s*HAUTEUR_BOUTONS_FENETRE\b/)
    expect(index).toMatch(/setTitleBarOverlay\(\{[^}]*height:\s*HAUTEUR_BOUTONS_FENETRE\b/)
    for (const source of [fenetre, index]) {
      expect(source).not.toMatch(/(titleBarOverlay:\s*\{|setTitleBarOverlay\(\{)[^}]*height:\s*\d/)
    }
  })
})
