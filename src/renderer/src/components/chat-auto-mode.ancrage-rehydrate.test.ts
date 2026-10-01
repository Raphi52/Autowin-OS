import { describe, expect, it } from 'vitest'
import { derniereDemandeHumaine } from './chat-auto-mode'
import type { Msg } from './chat-view-types'

/**
 * DEFAUT MESURE (conv-470, saisie ts=1789159231523).
 *
 * Le mode auto a envoye « Applique la piece 3… » en l'ancrant sur « Applique la piece 2… », alors
 * que les cinq autres envois automatiques du MEME fil citaient « Voici un besoin observe… ». La
 * demande se lisait sur la fenetre de messages CHARGEE : quand elle ne commence pas au premier
 * message du fil, l'ancre devient le message le plus ancien VISIBLE, et la chaine s'accroche a un
 * maillon intermediaire — exactement ce que l'ancrage devait empecher.
 *
 * L'ancre deja ECRITE dans un envoi automatique est une source plus sure que le haut d'une fenetre
 * tronquee : elle a ete calculee quand la fenetre etait plus large. Depuis le 2026-09-30 (conv-889),
 * l'ancre est la DERNIERE demande de l'utilisateur : un message qu'il tape APRES un envoi automatique
 * reprend la main, et devient l'ancre.
 */
const demande = (texte: string): Msg => ({ role: 'user', content: texte }) as unknown as Msg
const reponse = (texte: string): Msg =>
  ({ role: 'assistant', parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const envoiAuto = (suite: string, ancre: string): string =>
  `${suite}\n\n(Mode auto — tâche initiale de ce fil : « ${ancre} ». Si cette suite s'en éloigne, dis-le et\narrête la chaîne au lieu de dériver.)`

describe('l ancre survit a une fenetre de messages tronquee', () => {
  it('relit l ancre deja portee par le dernier envoi automatique', () => {
    // Fenetre chargee : le message tape (« Voici un besoin… ») est hors de la fenetre.
    const fil = [
      demande(envoiAuto('Applique la piece 2', 'Voici un besoin observé dans Autowin OS')),
      reponse('pièce 2 appliquée')
    ]
    expect(derniereDemandeHumaine(fil)).toBe('Voici un besoin observé dans Autowin OS')
  })

  it('un message tape APRES un envoi automatique reprend la main', () => {
    const fil = [
      demande(envoiAuto('Applique la piece 2', 'Voici un besoin observé dans Autowin OS')),
      reponse('pièce 2 appliquée'),
      demande('Passe plutôt à la pièce 5')
    ]
    expect(derniereDemandeHumaine(fil)).toBe('Passe plutôt à la pièce 5')
  })

  it('sans ancre ecrite, la derniere demande tapee est l ancre', () => {
    expect(derniereDemandeHumaine([demande('la vraie demande'), demande('la suite')])).toBe(
      'la suite'
    )
  })
})
