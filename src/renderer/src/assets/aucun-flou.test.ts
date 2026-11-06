import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * AUCUN EFFET DE FLOU DANS L'INTERFACE (2026-11-05, « enleve les effets de flou »).
 * Le flou de fond (`backdrop-filter`) et le flou d'un calque (`filter: blur`) se recalculent sur la
 * carte graphique à chaque image où quelque chose bouge derrière eux : c'est le coût que
 * l'utilisateur voulait retirer pour alléger le GPU. Les thèmes l'avaient déjà perdu ;
 * il en restait quinze dans les écrans eux-mêmes.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST : un `backdrop-filter` autre que `none` dans n'importe
 * quelle feuille de l'interface, un `filter` qui contient `blur(`, ou un `backdropFilter` écrit
 * dans le style d'un composant.
 * Hors champ, volontairement : les `filter = 'blur(…)'` des toiles du décor (quartier-scene.ts,
 * home-decor-avenue-voitures.ts) sont appliqués UNE fois, à la fabrication d'une image, et ne
 * coûtent plus rien ensuite.
 */
const RACINE = fileURLToPath(new URL('../..', import.meta.url))

function fichiers(extensions: RegExp): string[] {
  return (readdirSync(RACINE, { recursive: true }) as string[])
    .filter((chemin) => extensions.test(chemin) && !/\.test\.tsx?$/.test(chemin))
    .map((chemin) => join(RACINE, chemin))
}

describe("aucun effet de flou dans l'interface", () => {
  it('aucune feuille de style ne floute un fond ou un calque', () => {
    const feuilles = fichiers(/\.css$/)
    expect(feuilles.length).toBeGreaterThan(50)
    const fautifs: string[] = []
    for (const feuille of feuilles) {
      postcss.parse(readFileSync(feuille, 'utf8')).walkDecls((d) => {
        const valeur = d.value.trim()
        const flouDeFond =
          /(^|-)backdrop-filter$/.test(d.prop) && valeur !== 'none' && !/^none\b/.test(valeur)
        const flouDeCalque = /(^|-)filter$/.test(d.prop) && /blur\(/.test(valeur)
        if (flouDeFond || flouDeCalque) {
          const ligne = d.source?.start?.line ?? 0
          fautifs.push(`${feuille.slice(RACINE.length)}:${ligne} ${d.prop}: ${valeur}`)
        }
      })
    }
    expect(fautifs).toEqual([])
  })

  it('aucun composant ne pose un flou de fond dans son style', () => {
    const fautifs = fichiers(/\.tsx$/).filter((f) =>
      /backdropFilter\s*:/.test(readFileSync(f, 'utf8'))
    )
    expect(fautifs).toEqual([])
  })
})
