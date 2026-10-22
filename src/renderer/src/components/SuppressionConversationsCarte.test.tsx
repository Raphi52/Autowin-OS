// @vitest-environment happy-dom
/**
 * Carte « Supprimer la conversation ? » / « Supprimer N conversations ? » (conv-1078, 2026-10-22,
 * « Implémenter la 2 · En-tête en ligne »).
 *
 * Ce que ces tests verrouillent :
 *  - la carte NOMME les fils qui partent, avec leurs messages, et le surtitre en donne le total ;
 *  - au-delà de trois fils, deux lignes puis « + N autres » qui compte AUSSI un fil absent de la liste
 *    chargée : la carte ne promet jamais moins que ce qui sera supprimé ;
 *  - « Garder » garde le focus ; seul le bouton rouge supprime ; un clic à côté de la carte garde ;
 *  - la carte est rendue dans `body`, hors du panneau du chat : dedans, la poignée de largeur de la
 *    liste des fils passait au-dessus d'elle et prenait les clics sur « Supprimer » (conv-1078).
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : lister moins de fils que la sélection sans « + N autres »,
 * ou donner le focus au bouton irréversible.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuppressionConversationsCarte } from './SuppressionConversationsCarte'
import { resumerSuppression } from './suppression-conversations'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fil = (id: string, title: string, messageCount: number) => ({ id, title, messageCount })

describe('resumerSuppression', () => {
  it('liste jusqu’à trois fils en entier', () => {
    const r = resumerSuppression([fil('a', 'A', 2), fil('b', 'B', 18), fil('c', 'C', 11)], 3)
    expect(r.lignes.map((l) => l.titre)).toEqual(['A', 'B', 'C'])
    expect(r.autres).toBeNull()
    expect(r.messages).toBe(31)
  })

  it('au-delà, deux fils puis le reste regroupé avec ses messages', () => {
    const r = resumerSuppression(
      [fil('a', 'A', 2), fil('b', 'B', 18), fil('c', 'C', 11), fil('d', 'D', 6)],
      4
    )
    expect(r.lignes.map((l) => l.titre)).toEqual(['A', 'B'])
    expect(r.autres).toEqual({ nombre: 2, messages: 17 })
    expect(r.messages).toBe(37)
  })

  it('un fil sélectionné mais absent de la liste chargée compte quand même', () => {
    const r = resumerSuppression([fil('a', 'A', 2), fil('b', 'B', 3)], 4)
    expect(r.lignes).toHaveLength(2)
    expect(r.autres?.nombre).toBe(2)
  })

  it('lit le nombre de messages sur la liste quand le compteur manque', () => {
    const r = resumerSuppression([{ id: 'a', title: 'A', messages: [1, 2, 3] }], 1)
    expect(r.lignes[0].messages).toBe(3)
  })
})

describe('SuppressionConversationsCarte', () => {
  let hote: HTMLDivElement
  let racine: Root

  beforeEach(() => {
    hote = document.createElement('div')
    document.body.appendChild(hote)
    racine = createRoot(hote)
  })

  afterEach(() => {
    act(() => racine.unmount())
    hote.remove()
  })

  function rendre(props: Parameters<typeof SuppressionConversationsCarte>[0]): void {
    act(() => racine.render(createElement(SuppressionConversationsCarte, props)))
  }
  const texte = (sel: string): string => document.body.querySelector(sel)?.textContent ?? ''
  const boutons = (): HTMLButtonElement[] => [...document.body.querySelectorAll('button')]

  it('une conversation : son titre, ses messages, et « Garder » prend le focus', () => {
    const onGarder = vi.fn()
    const onSupprimer = vi.fn()
    rendre({ fils: [fil('a', '/draft une plus jolie popup', 2)], total: 1, onGarder, onSupprimer })
    expect(texte('h2')).toBe('Supprimer la conversation ?')
    expect(texte('.delete-confirm-kicker')).toBe('CONVERSATION · 2 MSG')
    expect(texte('.delete-confirm-fil-titre')).toBe('/draft une plus jolie popup')
    expect(texte('.delete-confirm-fil-nombre')).toBe('2 msg')
    expect(boutons().map((b) => b.textContent)).toEqual([
      'Supprimer définitivement',
      'Garder la conversation'
    ])
    expect(document.activeElement?.textContent).toBe('Garder la conversation')
    act(() => boutons()[1].click())
    expect(onGarder).toHaveBeenCalledTimes(1)
    expect(onSupprimer).not.toHaveBeenCalled()
  })

  it('un lot : total en surtitre, deux fils puis « + 2 autres », bouton « Supprimer les 4 »', () => {
    const onSupprimer = vi.fn()
    rendre({
      fils: [fil('a', 'A', 2), fil('b', 'B', 18), fil('c', 'C', 11), fil('d', 'D', 6)],
      total: 4,
      onGarder: vi.fn(),
      onSupprimer
    })
    expect(texte('h2')).toBe('Supprimer 4 conversations ?')
    expect(texte('.delete-confirm-kicker')).toBe('SÉLECTION · 4 FILS · 37 MSG')
    const lignes = [...document.body.querySelectorAll('.delete-confirm-fil')].map(
      (li) => li.textContent
    )
    expect(lignes).toEqual(['A2 msg', 'B18 msg', '+ 2 autres17 msg'])
    expect(boutons()[0].textContent).toBe('Supprimer les 4')
    act(() => boutons()[0].click())
    expect(onSupprimer).toHaveBeenCalledTimes(1)
  })

  it('se rend dans body, hors du conteneur qui la déclare', () => {
    rendre({ fils: [fil('a', 'A', 1)], total: 1, onGarder: vi.fn(), onSupprimer: vi.fn() })
    expect(hote.querySelector('.delete-confirm-layer')).toBeNull()
    expect(document.body.querySelector('.delete-confirm-layer')?.parentElement).toBe(document.body)
  })

  it('un clic hors de la carte garde, un clic dans la carte ne ferme rien', () => {
    const onGarder = vi.fn()
    rendre({ fils: [fil('a', 'A', 1)], total: 1, onGarder, onSupprimer: vi.fn() })
    act(() => (document.body.querySelector('.delete-confirm-card') as HTMLElement).click())
    expect(onGarder).not.toHaveBeenCalled()
    act(() => (document.body.querySelector('.delete-confirm-layer') as HTMLElement).click())
    expect(onGarder).toHaveBeenCalledTimes(1)
  })

  it('affiche l’erreur d’une suppression en lot', () => {
    rendre({
      fils: [fil('a', 'A', 1), fil('b', 'B', 1)],
      total: 2,
      erreur: 'refus du disque',
      onGarder: vi.fn(),
      onSupprimer: vi.fn()
    })
    expect(texte('.c-danger')).toBe('refus du disque')
  })
})
