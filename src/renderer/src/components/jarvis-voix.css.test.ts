import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * LA LISTE DES VOIX NE DOIT PAS SE LIRE BLANC SUR BLANC (constat utilisateur du 2026-09-02).
 *
 * Cause reelle : sans `color-scheme`, Chromium peint les controles natifs en theme CLAIR. Le fond
 * declare a 5 % d'opacite laissait donc passer le blanc du controle, et la liste deroulante
 * s'ouvrait blanche avec un texte clair — illisible.
 *
 * Le schema de couleurs des controles natifs est declare A LA RACINE (theme.css, verrouille par
 * theme.css.test.ts). Ce test-ci garde le complement propre au widget : un fond OPAQUE, car un
 * voile semi-transparent laissait passer le blanc du controle.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : redonner un fond transparent ou semi-transparent au
 * select, a ses `option` ou au champ du nom.
 */
describe('HomeView.css — la liste des voix de Jarvis est lisible', () => {
  const css = readFileSync(new URL('./HomeView.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )

  /** Le corps d'une regle, sans regex construite a la volee : on decoupe entre ses accolades. */
  const corpsDeLaRegle = (selecteur: string): string => {
    const debut = css.indexOf(selecteur + ' {')
    expect(debut, `la règle ${selecteur} doit exister`).toBeGreaterThan(-1)
    return css.slice(debut + selecteur.length + 2, css.indexOf('}', debut))
  }

  it('donne un fond OPAQUE à la liste et à ses items', () => {
    for (const selecteur of [
      '.jarvis__audio-champ select',
      '.jarvis__audio-champ select option',
      ".jarvis__audio-champ input[type='text']"
    ]) {
      expect(corpsDeLaRegle(selecteur), `${selecteur} doit poser un fond opaque`).toMatch(
        /background:\s*#[0-9a-f]{3,8}\s*;/i
      )
    }
  })
})

/**
 * LE WIDGET DOIT DEFILER (constat utilisateur du 2026-09-02 : « ce widget doit etre scrollable »).
 *
 * Cause reelle : `.jarvis` etait en `overflow: hidden` avec une hauteur imposee. Reglages deplies,
 * la liste des voix, les curseurs et le bouton d'essai passaient sous le bord et devenaient
 * INATTEIGNABLES — rien ne permettait d'y descendre.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : remettre `overflow: hidden` sur `.jarvis`.
 */
describe('HomeView.css — le widget Jarvis defile', () => {
  const css = readFileSync(new URL('./HomeView.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
  const corps = ((): string => {
    const debut = css.indexOf('.jarvis {')
    expect(debut, 'la règle .jarvis doit exister').toBeGreaterThan(-1)
    return css.slice(debut, css.indexOf('}', debut))
  })()

  it('laisse le contenu vertical defiler au lieu de le couper', () => {
    expect(corps).toMatch(/overflow-y:\s*auto\s*;/)
    expect(corps, 'un overflow global caché reprendrait le découpage').not.toMatch(
      /overflow:\s*hidden\s*;/
    )
  })
})
