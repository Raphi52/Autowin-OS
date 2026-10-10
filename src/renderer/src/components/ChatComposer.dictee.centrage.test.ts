import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Sans les commentaires : un commentaire qui CITE le micro ne doit pas attirer la règle suivante.
const styles = readFileSync('src/renderer/src/components/ChatView.css', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** Corps de toutes les règles dont le sélecteur vérifie `test`. */
function regles(test: (selecteur: string) => boolean): string[] {
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => test(m[1]))
    .map((m) => m[2])
}

/**
 * DÉFAUT VÉCU (2026-10-10) : « quand je fais ctrl+molette ya certains zoom où le micro est pas
 * centré ». Mesuré dans Electron 44 sur les 26 crans du zoom de l'app (50-300 %) × 40 positions
 * sub-pixel du bouton :
 *  - <svg> de 13 px centré par flex + `translateX(-0.5px)` : 847/1040 positions décalées de
 *    0,5 px ou plus, jusqu'à 2 px. Chromium arrondit la boîte du <svg> à part de celle du rond, et
 *    le décalage fixe, réglé à un seul zoom, s'ajoutait à tous les autres ;
 *  - tracé peint par `mask` étiré à 100 % sur un <span> qui remplit le bouton : 0/1040, pire
 *    écart 0,2 px. Le masque est arrondi exactement comme le rond.
 * Ces gardes verrouillent les deux conditions de ce résultat.
 */
describe('micro du champ de saisie — centré à tous les crans de zoom', () => {
  it('le tracé remplit tout le bouton et y est peint par un masque étiré à 100 %', () => {
    const corps = regles((s) => /\.composer-dictee-trait\s*$/.test(s.trim())).join('\n')
    expect(corps).toMatch(/width:\s*100%/)
    expect(corps).toMatch(/height:\s*100%/)
    expect(corps).toMatch(/background-color:\s*currentColor/)
    expect(corps).toMatch(/mask:\s*url\("data:image\/svg\+xml,[\s\S]*center\s*\/\s*100% 100%/)
  })

  it('aucun décalage réglé à la main sur le micro ni sur son tracé', () => {
    const corps = regles((s) => /composer-dictee(?![-\w])[^,{]*\b(svg|composer-dictee-trait)\b|\.composer-dictee-trait/.test(s))
    expect(corps.length).toBeGreaterThan(0)
    for (const c of corps) expect(c).not.toMatch(/translate/)
  })
})
