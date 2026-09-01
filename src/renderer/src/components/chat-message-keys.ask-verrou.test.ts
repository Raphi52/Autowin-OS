import { describe, expect, it } from 'vitest'
import { askDejaRepondu } from './chat-message-keys'
import type { Msg } from './chat-view-types'

/*
 * VECU (conv-50, 2026-09-01) : l'utilisateur clique une reponse du bloc `ask`, RIEN ne part, et le
 * bloc affiche deja « Répondu ». Cause : le verrou durable se fermait sur N'IMPORTE QUEL message
 * utilisateur posterieur au tour. Un message qui parlait d'autre chose condamnait donc la question,
 * et le clic suivant etait avale en silence. Le verrou doit se fermer sur une VRAIE reponse.
 */
const tourAvecQuestion = (): Msg =>
  ({
    role: 'assistant',
    content: '',
    done: true,
    status: 'completed',
    parts: [
      {
        kind: 'action',
        name: 'ask',
        ok: true,
        actionId: 'a1',
        data: {
          question: 'Une image collée pendant un tour : elle fait quoi ?',
          options: [
            { libelle: 'Elle part tout de suite avec mon orientation' },
            { libelle: 'Elle reste accrochée et part après le tour' },
            { libelle: 'Les deux' }
          ]
        }
      }
    ]
  }) as unknown as Msg

const utilisateur = (content: string): Msg => ({ role: 'user', content }) as unknown as Msg

describe('verrou du bloc ask — seule une vraie réponse ferme la question', () => {
  it('un message utilisateur SANS rapport laisse la question ouverte', () => {
    const fil = [tourAvecQuestion(), utilisateur('ca la met juste dans la barre de prompt...')]
    expect(askDejaRepondu(fil, 0)).toBe(false)
  })

  it("le libellé d'une option ferme la question", () => {
    const fil = [tourAvecQuestion(), utilisateur('Les deux')]
    expect(askDejaRepondu(fil, 0)).toBe(true)
  })

  it('une réponse multiple (liste de puces) ferme la question', () => {
    const fil = [
      tourAvecQuestion(),
      utilisateur('- Les deux\n- Elle part tout de suite avec mon orientation')
    ]
    expect(askDejaRepondu(fil, 0)).toBe(true)
  })

  it('une réponse arrivée APRÈS un message hors sujet ferme quand même la question', () => {
    const fil = [tourAvecQuestion(), utilisateur('autre chose'), utilisateur('Les deux')]
    expect(askDejaRepondu(fil, 0)).toBe(true)
  })

  it('un tour sans question ne verrouille rien', () => {
    const fil = [
      { role: 'assistant', content: 'ok', done: true, status: 'completed', parts: [] },
      utilisateur('Les deux')
    ] as unknown as Msg[]
    expect(askDejaRepondu(fil, 0)).toBe(false)
  })
})
