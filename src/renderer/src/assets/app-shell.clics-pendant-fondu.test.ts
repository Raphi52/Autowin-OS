import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Sans les commentaires : un commentaire qui CITE une règle ne doit pas compter comme la règle.
const styles = readFileSync('src/renderer/src/assets/app-shell.css', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** Toutes les règles : [sélecteurs un par un, corps]. */
const regles = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selecteurs: m[1].split(',').map((s) => s.trim()),
  corps: m[2]
}))

/** Corps cumulé des règles qui portent EXACTEMENT ce sélecteur. */
function corps(selecteur: string): string {
  return regles
    .filter((r) => r.selecteurs.includes(selecteur))
    .map((r) => r.corps)
    .join('\n')
}

/**
 * DÉFAUT MESURÉ (conv-1322, 2026-10-30) : un second clic rapide sur un onglet était PERDU. Pendant
 * le fondu de vue (`basculerVue`, transition-de-vue.ts), le calque `::view-transition` couvre la
 * fenêtre et livre tout clic à <html>. Copie cachée à 19-25 images/s : 8 seconds clics perdus sur 8
 * entre 0 et 400 ms ; `::view-transition { pointer-events: none }` SEUL n'y changeait rien (8 sur
 * 8). Il faut aussi sortir la page du fondu : configuration du test de référence Chromium
 * (WPT css-view-transitions/input-targets-root-while-render-blocked). Avec les deux, 6 sur 6
 * passent pendant l'animation. Seul le surlignage du menu (`nav-actif`) glisse, il reste nommé.
 */
describe('changement d’onglet — les clics traversent le fondu de vue', () => {
  it('la page n’est pas nommée pendant un fondu de VUE', () => {
    expect(corps(':root.vue-en-transition')).toMatch(/view-transition-name:\s*none\s*;/)
  })

  it('le calque du fondu de vue laisse passer les clics', () => {
    expect(corps(':root.vue-en-transition::view-transition')).toMatch(/pointer-events:\s*none\s*;/)
  })

  it('le surlignage du menu reste nommé : il glisse toujours', () => {
    expect(corps(':root.vue-en-transition .nav-item.active')).toMatch(
      /view-transition-name:\s*nav-actif\s*;/
    )
  })

  it('le cercle du changement de THÈME garde la page nommée (aucune règle non qualifiée)', () => {
    const nonQualifiees = regles.filter(
      (r) =>
        r.selecteurs.some((s) => s === ':root' || s === 'html' || s.startsWith(':root.theme-')) &&
        /view-transition-name:\s*none/.test(r.corps)
    )
    expect(nonQualifiees).toEqual([])
  })
})
