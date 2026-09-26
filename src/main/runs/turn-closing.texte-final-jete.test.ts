import { describe, expect, it } from 'vitest'
import { closingTurnDelivery } from './turn-closing'

/**
 * LE TEXTE FINAL D'UN TOUR QUI A DEJA PARLE ETAIT JETE.
 *
 * MESURE le 2026-09-11 sur `conv-471`. Le tour avait diffuse quatre courtes phrases entre ses
 * appels d'outils (222 caracteres) -- ce que la consigne « jamais de fil muet » demande -- puis le
 * process principal a ete relance pendant sa redaction. A la reprise, le pilote a bien produit son
 * texte final ; `shouldPersistClosingText` l'a refuse au seul motif que des deltas avaient ete vus,
 * et le compte-rendu -- bloc de cloture compris -- n'a jamais atteint le fil. L'utilisateur a lu
 * « je lance les tests » puis plus rien, et ne pouvait pas savoir si le travail etait fini.
 *
 * Le motif de ce refus (« le done reprend ce qui a deja ete dit ») n'est vrai que pour un tour qui
 * n'a parle qu'une fois. La vraie protection anti-duplication existe deja un cran plus bas : on
 * retranche ce qui a deja ete dit et on ne publie que le RESTE. C'est elle qui doit decider.
 */
const DEJA = 'Je lance les tests.'
const SUITE = '\n\n✅ Fait\nLes 33 tests passent.'

describe('cloture d un tour qui a deja parle', () => {
  it('publie la SUITE quand le texte final prolonge ce qui a deja ete dit', () => {
    const livraison = closingTurnDelivery('t1', DEJA + SUITE, DEJA)
    expect(livraison?.durable.text).toBe(SUITE.trim())
    // Durable et live portent le MEME texte : persister sans afficher est le defaut d origine.
    expect(livraison?.live.text).toBe(livraison?.durable.text)
  })

  it('publie le texte ENTIER quand le texte final ne reprend pas le prefixe', () => {
    const livraison = closingTurnDelivery('t1', SUITE.trim(), DEJA)
    expect(livraison?.durable.text).toBe(SUITE.trim())
  })

  it('ne republie RIEN quand tout a deja ete dit — la garde anti-doublon tient toujours', () => {
    expect(closingTurnDelivery('t1', DEJA, DEJA)).toBeUndefined()
  })

  it('ne republie RIEN quand le texte final est deja CONTENU dans ce qui a ete diffuse', () => {
    expect(closingTurnDelivery('t1', 'les tests.', DEJA)).toBeUndefined()
  })

  it('ne livre rien quand le texte final est vide', () => {
    expect(closingTurnDelivery('t1', '   ', DEJA)).toBeUndefined()
  })

  it('livre toujours le texte d un tour qui n avait RIEN diffuse', () => {
    expect(closingTurnDelivery('t1', SUITE.trim(), '')?.durable.text).toBe(
      SUITE.trim()
    )
  })
})
