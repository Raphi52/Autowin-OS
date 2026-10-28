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

/**
 * LE TEXTE NE SE RÉAGENCE JAMAIS QUAND LA CARTE S'OUVRE (conv-1193, 2026-10-28 : « je veux pas que
 * ça envoie des mots à la ligne comme ça »).
 *
 * Deux demandes à tenir ensemble : la carte ne passe pas sur le texte (conv-1114, puis conv-1193
 * « la scrollbar repasse là en overlay pendant que je scroll au lieu de décaler »), ET le texte ne
 * change pas de largeur — sinon les lignes se recoupent à l'ouverture, des mots passent à la ligne
 * suivante, puis reviennent au repli. La seule forme qui tient les deux : la place de la carte
 * ouverte est réservée EN PERMANENCE à droite du fil, et l'ouverture n'y change rien.
 * (Avant : marge 12 px au repos, 80 px carte ouverte — poussée en 800 ms, puis d'un coup.)
 * Happy-dom ne calcule aucune mise en page : la règle est vérifiée dans la feuille.
 */
describe('ascenseur du fil — la largeur du texte ne dépend pas de la carte', () => {
  const repos = regle('.chat-scroll.chat-scroll--ascenseur,')

  // Carte de 36 px + 8 d'écart : largeur divisée par 2 (conv-1202, « divise par 2 la largeur de la
  // barre […] pour gagner de la place pour le contenu du chat ») — avant 72 + 8 = 80 px.
  it('la place de la carte ouverte est réservée au repos', () => {
    expect(repos).toMatch(/padding-right:\s*var\(--adf-reserve,\s*44px\)\s*!important/)
  })

  it('la carte ouverte fait 36 px, et la réserve par défaut 44 px', () => {
    expect(regle('.adf.is-deplie')).toMatch(/width:\s*36px/)
    expect(regle('@property --adf-reserve')).toMatch(/initial-value:\s*44px/)
  })

  it('aucune règle ne change la marge du fil quand la carte s’ouvre', () => {
    for (const m of styles.matchAll(/([^{}]+){([^}]*)}/g))
      if (m[1].includes('data-ascenseur')) expect(m[2], m[1]).not.toMatch(/padding/)
  })

  it('aucune transition de marge : rien ne bouge à l’ouverture ni au repli', () => {
    expect(styles).not.toMatch(/transition:[^;]*padding/)
  })
})
