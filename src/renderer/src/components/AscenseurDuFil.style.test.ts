import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./AscenseurDuFil.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** Corps de la règle dont le sélecteur contient `morceau` (commentaires retirés). */
const regle = (morceau: string): string => {
  for (const m of styles.matchAll(/([^{}]+){([^}]*)}/g)) if (m[1].includes(morceau)) return m[2]
  return ''
}
const ms = (valeur: string): number =>
  valeur.endsWith('ms') ? parseFloat(valeur) : parseFloat(valeur) * 1000

/**
 * LA CARTE NE PASSE JAMAIS SUR LE TEXTE PENDANT LE DÉFILEMENT (conv-1193, 2026-10-28 : « la
 * scrollbar repasse là en overlay pendant que je scroll au lieu de décaler »).
 *
 * Le fil se poussait en 800 ms par une transition de `padding-right` : chaque image relance la mise
 * en page du fil ENTIER. Mesuré dans l'app (copie cachée, conv-1139, 45 000 px de fil) : 130 à
 * 240 ms par image pendant la poussée, soit ~7 images/s. Les aperçus et la carte, eux, s'animent sans
 * attendre la mise en page : ils apparaissaient sur un texte pas encore poussé (aperçus posés sur le
 * texte immobile pendant 470 ms, page occupée 0,6 s).
 * Donc : à l'ouverture, la place est réservée D'UN COUP, dans la même image où la carte commence à
 * se dévoiler ; au repli, le texte ne reprend sa largeur qu'une fois la carte rentrée.
 * Happy-dom ne calcule aucune mise en page : la règle est vérifiée dans la feuille ; la preuve à
 * l'écran est la sonde image par image (D:/tmp/sonde-overlay).
 */
describe('ascenseur du fil — la conversation est décalée avant que la carte ne s’ouvre', () => {
  const ouvert = regle("[data-ascenseur='deplie']")
  const repos = regle('.chat-scroll.chat-scroll--ascenseur,')

  it('à l’ouverture, la marge réservée s’applique sans transition', () => {
    expect(ouvert).toMatch(/padding-right:\s*var\(--adf-reserve/)
    expect(ouvert).toMatch(/transition:\s*none/)
  })

  it('au repli, le texte reprend sa largeur d’un coup, seulement après que la carte est rentrée', () => {
    const transition = /transition:\s*padding-right\s+([\d.]+m?s)\s+\S+\s+([\d.]+m?s)/.exec(repos)
    expect(transition, repos).not.toBeNull()
    const [, duree, delai] = transition!
    expect(ms(duree)).toBe(0)
    // La carte rentre par `clip-path` et s'efface par `opacity` (délai compris) : le plus long des deux.
    const carte = regle('.adf-carte')
    const fin = Math.max(
      ...[
        ...carte.matchAll(/(?:clip-path|opacity)\s+([\d.]+m?s)(?:\s+[^\s,;]+)?(?:\s+([\d.]+m?s))?/g)
      ].map((m) => ms(m[1]) + (m[2] ? ms(m[2]) : 0))
    )
    expect(fin).toBeGreaterThan(0)
    expect(ms(delai)).toBeGreaterThanOrEqual(fin)
  })
})
