import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * LA VUE MAINTENANCE DÉFILE, ET AUCUN BLOC NE S'ÉCRASE (conv-1402, 2026-10-31 : « la vue maintenance
 * doit être scrollable, quand j'ouvre latence ça cache les tickets »).
 *
 * Constat à la capture, 1440 x 900 : Latence ouvert, le titre des tickets reste seul, leur liste est
 * à zéro de haut et le bas du panneau est coupé sans barre de défilement. Deux causes qui se
 * cumulent : `.view-page` coupe ce qui dépasse, et `.maint-tickets` était le seul bloc autorisé à
 * rétrécir, donc tout le surplus de Latence retombait sur lui.
 *
 * Ce test lit la feuille : happy-dom ne calcule aucune mise en page. La hauteur réelle se prouve à la
 * capture (`scripts/ui-capture.mjs --code-dev --view tests`).
 *
 * ENTRÉES QUI DOIVENT LE FAIRE ÉCHOUER : retirer `.view-page.tests-view`, ou remettre `flex: 0 1 auto`
 * sur `.maint-tickets`.
 */
const ICI = fileURLToPath(new URL('.', import.meta.url))
const feuille = postcss.parse(readFileSync(join(ICI, 'TestsView.css'), 'utf8'))

function declaration(selecteur: string, propriete: string): string | undefined {
  let valeur: string | undefined
  feuille.walkRules((regle) => {
    if (!regle.selectors.includes(selecteur)) return
    regle.walkDecls(propriete, (d) => {
      valeur = d.value
    })
  })
  return valeur
}

/** Le deuxième nombre du raccourci `flex` : 0 interdit au bloc de rétrécir. */
function retrecissement(selecteur: string): string | undefined {
  return declaration(selecteur, 'flex')?.split(/\s+/)[1]
}

describe('Vue Maintenance : le cadre défile, les blocs gardent leur hauteur', () => {
  it('le défilement est posé avec une priorité qui passe devant le overflow du cadre commun', () => {
    // `.tests-view` seul aurait la même priorité que `.view-page` : l'ordre de chargement des
    // feuilles trancherait, et les deux classes sont sur le même élément.
    expect(declaration('.view-page.tests-view', 'overflow-y')).toBe('auto')
  })

  it('aucun bloc de la vue ne rétrécit pour faire de la place à un autre', () => {
    expect(declaration('.tests-view > *', 'flex-shrink')).toBe('0')
    // Ces deux-là posent leur propre `flex` : plus bas dans la feuille, ils repasseraient devant.
    expect(retrecissement('.maint-tickets')).toBe('0')
    expect(retrecissement('.tests-body')).toBe('0')
  })
})
