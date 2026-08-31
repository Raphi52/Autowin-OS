// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ChatMosaic, type ChatMosaicWindow } from './ChatMosaic'

/**
 * COUT DU STREAMING EN MOSAIQUE — le gel mesure (conv-1581).
 *
 * Pendant qu'UNE fenetre streame, ChatView refabrique `fenetresMosaique` (nouvel objet par
 * fenetre) a chaque frame. Sans memo, TOUTES les fenetres se re-rendent : leurs fils entiers ET
 * leur `ChatComposer` (palettes `/` et `@`, pieces jointes) sont reconstruits 60 fois par seconde,
 * multiplie par le nombre de fenetres ouvertes. C'est le meme defaut que conv-1464 (gel a la
 * frappe), jamais applique a la mosaique.
 *
 * Ce test compte les rendus du composer de la fenetre INACTIVE.
 */
const fenetre = (
  id: string,
  titre: string,
  messages: ChatMosaicWindow['messages'],
  busy = false
): ChatMosaicWindow => ({ id, title: titre, messages, busy })

const rendus = new Map<string, number>()
function ComposerCompteur({ id }: { id: string }): React.JSX.Element {
  rendus.set(id, (rendus.get(id) ?? 0) + 1)
  return <textarea data-testid={`composer-${id}`} aria-label={`Message pour ${id}`} />
}
// Rappels STABLES : c'est le contrat que ChatView doit tenir (useCallback) pour que le memo morde.
const rendreComposer = (id: string): React.ReactNode => <ComposerCompteur id={id} />
const onClose = (): void => {}
const onOuvrirSeule = (): void => {}
const onNouvelleConversation = (): void => {}

function vue(fenetres: ChatMosaicWindow[]): React.JSX.Element {
  return (
    <ChatMosaic
      fenetres={fenetres}
      onClose={onClose}
      onOuvrirSeule={onOuvrirSeule}
      rendreComposer={rendreComposer}
      onNouvelleConversation={onNouvelleConversation}
    />
  )
}

describe('ChatMosaic — cout du streaming', () => {
  it('une fenetre INCHANGEE ne se re-rend pas quand une AUTRE streame', () => {
    rendus.clear()
    const filB = [{ role: 'user', content: 'bonjour b' }] as ChatMosaicWindow['messages']
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    act(() => {
      root.render(vue([fenetre('a', 'Alpha', [{ role: 'user', content: 'x' }], true), fenetre('b', 'Beta', filB)]))
    })
    expect(rendus.get('b')).toBe(1)
    const avantA = rendus.get('a') ?? 0

    // 10 frames de streaming sur A : fil de A qui grossit, objets de fenetre TOUS refabriques.
    for (let i = 0; i < 10; i++) {
      const filA = Array.from({ length: i + 2 }, (_, k) => ({ role: 'user', content: `x${k}` }))
      act(() => {
        root.render(
          vue([
            fenetre('a', 'Alpha', filA as ChatMosaicWindow['messages'], true),
            // MEME contenu, MEME reference de fil : rien de B n'a bouge.
            fenetre('b', 'Beta', filB)
          ])
        )
      })
    }

    // B n'a aucune raison de se redessiner...
    expect(rendus.get('b')).toBe(1)
    // ...mais A, elle, DOIT suivre son stream : un memo qui ne compare que l'id la figerait.
    expect(rendus.get('a')).toBeGreaterThan(avantA)

    // Et B se redessine des que SON etat change (busy) — sinon la pastille « occupe » ne s'allume plus.
    act(() => {
      root.render(
        vue([
          fenetre('a', 'Alpha', [{ role: 'user', content: 'x' }], true),
          fenetre('b', 'Beta', filB, true)
        ])
      )
    })
    expect(rendus.get('b')).toBe(2)
  })
})
