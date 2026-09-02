import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * LES CONTROLES NATIFS DE L'APPLICATION SONT SOMBRES, DECLARE UNE SEULE FOIS.
 *
 * Sans `color-scheme`, Chromium peint listes deroulantes, champs et barres de defilement en theme
 * CLAIR : le blanc du controle transparait sous les fonds semi-opaques et le texte clair devient
 * illisible (constat utilisateur du 2026-09-02 sur la liste des voix de l'assistant).
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer `color-scheme: dark` de la racine du theme — le
 * defaut redeviendrait latent sur TOUS les controles natifs de l'application.
 */
describe('theme.css — les contrôles natifs suivent le thème sombre', () => {
  const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )

  it('déclare color-scheme: dark sur la racine', () => {
    const racine = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    expect(racine).toMatch(/color-scheme:\s*dark/)
  })
})
