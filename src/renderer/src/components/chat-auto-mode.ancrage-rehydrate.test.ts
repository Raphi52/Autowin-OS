import { describe, expect, it } from 'vitest'
import { tacheInitiale } from './chat-auto-mode'
import type { Msg } from './chat-view-model'

/**
 * DEFAUT MESURE (conv-470, saisie ts=1789159231523).
 *
 * Le mode auto a envoye « Applique la piece 3… » en l'ancrant sur « Applique la piece 2… », alors
 * que les cinq autres envois automatiques du MEME fil citaient « Voici un besoin observe… ». La
 * tache initiale se lisait sur la fenetre de messages CHARGEE : quand elle ne commence pas au
 * premier message du fil, l'ancre devient le message le plus ancien VISIBLE, et la chaine
 * s'accroche a un maillon intermediaire — exactement ce que l'ancrage devait empecher.
 *
 * L'ancre deja ECRITE dans un message precedent est une source plus sure que le haut d'une fenetre
 * tronquee : elle a ete calculee quand la fenetre etait plus large.
 */
const demande = (texte: string): Msg => ({ role: 'user', content: texte }) as unknown as Msg

describe('la tache initiale survit a une fenetre de messages tronquee', () => {
  it('relit l ancre deja portee par un message precedent', () => {
    const fil = [
      demande(
        "Applique la piece 2\n\n(Mode auto — tâche initiale de ce fil : « Voici un besoin observé dans Autowin OS ». Si cette suite s'en éloigne, dis-le et\narrête la chaîne au lieu de dériver.)"
      ),
      demande('Applique la piece 3')
    ]
    expect(tacheInitiale(fil)).toBe('Voici un besoin observé dans Autowin OS')
  })

  it('sans ancre ecrite, le premier message reste la tache', () => {
    expect(tacheInitiale([demande('la vraie demande'), demande('la suite')])).toBe(
      'la vraie demande'
    )
  })
})
