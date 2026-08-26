// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

/**
 * LE LISERÉ DORÉ DU BLOC DE CLÔTURE, signalé par l'utilisateur : « des fois il s'affiche pas et des
 * fois il encadre tout ce qui vient après la ligne recommandé ».
 *
 * Deux défauts symétriques, tous deux dans `splitFinalSummary` — un d'OUVERTURE, un de FERMETURE :
 *
 *   OUVERTURE. `FINAL_SUMMARY_LABELS` n'accepte que le titre markdown et le gras en préfixe. Deux
 *   formes réelles échappent donc à la détection et ne reçoivent aucun cadre : le bloc écrit en
 *   PUCES, et surtout le bloc RÉTROGRADÉ par le main — sur un run non validé, `⚠️ Fait — AUTO-DÉCLARÉ`
 *   remplace `✅ Fait`, et l'émoji n'est plus reconnu. Le cadre disparaissait donc exactement sur
 *   les réponses où l'état est le plus important à lire.
 *
 *   FERMETURE. `summary: lines.slice(markerIndex)` prend TOUT jusqu'à la fin du texte. Il n'existe
 *   aucune borne de fin : la moindre ligne écrite après « 👉 Recommandé » — une note, un bloc de
 *   code, un avertissement d'Autowin — se retrouve enfermée dans le liseré.
 *
 * Un cadre qui borne mal ment sur ce qu'il désigne : soit il n'attire pas l'œil là où il faut, soit
 * il présente comme « résumé final » du contenu qui n'en fait pas partie.
 */

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const rendre = (texte: string): HTMLElement | null => {
  act(() => root.render(createElement(Markdown, { text: texte, highlightFinalSummary: true })))
  return container.querySelector('.md-final-summary')
}

const trio = (fait: string): string =>
  [
    fait,
    '1. Corrigé le défaut.',
    '📍 Maintenant — état courant.',
    '⏳ Reste à faire — rien.',
    '👉 Recommandé — relancer.'
  ].join('\n')

describe('le liseré du bloc de clôture s’ouvre et se ferme au bon endroit', () => {
  it('OUVRE sur la forme nominale', () => {
    expect(rendre(trio('✅ Fait'))?.textContent).toContain('Recommandé')
  })

  it('OUVRE sur un bloc RÉTROGRADÉ par le main (⚠️ au lieu de ✅)', () => {
    // C'est la forme que produit `demoteUnvalidatedSuccessClaims` sur un run non validé.
    const cadre = rendre(trio('⚠️ Fait — AUTO-DÉCLARÉ, non validé (ARRÊTÉ au contrôle final)'))
    expect(cadre?.textContent).toContain('Recommandé')
  })

  it('OUVRE sur un bloc écrit en PUCES', () => {
    const enPuces = trio('✅ Fait')
      .split('\n')
      .map((l) => (/^[✅📍⏳👉⚠]/u.test(l) ? `- ${l}` : l))
      .join('\n')
    expect(rendre(enPuces)?.textContent).toContain('Recommandé')
  })

  it('FERME après la recommandation : ce qui suit reste HORS du cadre', () => {
    const avecSuite = [
      trio('✅ Fait'),
      '',
      '⚠️ Travail NON fusionné : il reste dans la copie isolée.',
      'Une seconde ligne qui ne fait pas partie du résumé.'
    ].join('\n')

    const cadre = rendre(avecSuite)

    expect(cadre?.textContent).toContain('Recommandé')
    expect(cadre?.textContent).not.toContain('Travail NON fusionné')
    expect(cadre?.textContent).not.toContain('seconde ligne')
    // Et la suite doit rester visible dans la réponse, pas disparaître avec la borne.
    expect(container.textContent).toContain('Travail NON fusionné')
  })

  it('garde la recommandation MULTI-LIGNES dans le cadre', () => {
    // L'autre bord de la fermeture : couper au premier saut de ligne amputerait un conseil long.
    const recoLongue = [trio('✅ Fait'), 'Suite immédiate de la recommandation.'].join('\n')
    expect(rendre(recoLongue)?.textContent).toContain('Suite immédiate')
  })
})
