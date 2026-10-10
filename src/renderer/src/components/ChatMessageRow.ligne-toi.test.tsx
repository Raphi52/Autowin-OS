// @vitest-environment happy-dom
/**
 * Ligne « Toi » RETIRÉE au-dessus des messages de l'utilisateur (conv-227, 2026-10-11 : « Enlève
 * aussi la ligne « TOI » au-dessus de mes messages dans tous les thèmes », après la ligne
 * « Agent »). Elle vivait dans ChatMessageRow, commun à tous les thèmes.
 *
 * Ce qu'elle portait d'autre ne doit pas partir avec elle :
 *  - l'heure d'écriture (montrée au survol) passe dans la rangée de boutons sous la bulle ;
 *  - l'étiquette « orienté en cours de tour » garde son en-tête, sans « Toi » ;
 *  - l'état d'un message envoyé pendant un tour (DirectiveReceiptRow) reste lisible.
 *
 * Entrées qui feraient échouer une correction fausse : « Toi » masqué par CSS dans un seul thème
 * (il resterait dans le DOM), l'heure supprimée avec la ligne, ou un en-tête vide qui laisse une
 * bande blanche au-dessus de la bulle.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow, DirectiveReceiptRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

async function rendre(element: ReturnType<typeof createElement>): Promise<Element> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(element)
  })
  const copie = host.cloneNode(true) as Element
  await act(async () => root.unmount())
  host.remove()
  return copie
}

function messageUtilisateur(extra: Record<string, unknown> = {}): Msg {
  return {
    role: 'user',
    content: 'bonjour',
    ts: Date.UTC(2026, 9, 11, 8, 30),
    messageId: 'u1',
    ...extra
  } as unknown as Msg
}

describe('ligne Toi du fil', () => {
  it("n'est plus rendue au-dessus d'un message ordinaire, sans en-tête vide", async () => {
    const hote = await rendre(createElement(ChatMessageRow, { message: messageUtilisateur() } as never))
    const message = hote.querySelector('.msg.user')
    expect(message, 'le message doit exister').not.toBeNull()
    expect(message?.querySelector('.msg-role')).toBeNull()
    expect(message?.querySelector('.msg-meta')).toBeNull()
    expect(message?.textContent).not.toContain('Toi')
    expect(message?.querySelector('.msg-bulle')?.textContent).toBe('bonjour')
  })

  it("garde l'heure, désormais dans la rangée de boutons sous la bulle", async () => {
    const hote = await rendre(createElement(ChatMessageRow, { message: messageUtilisateur() } as never))
    const heure = hote.querySelector('.msg.user .msg-turn-actions .msg-time')
    expect(heure, "l'heure du message doit rester").not.toBeNull()
    expect(heure?.getAttribute('data-heure-complete')).toBeTruthy()
  })

  it("garde l'étiquette d'orientation, sans « Toi »", async () => {
    const hote = await rendre(
      createElement(ChatMessageRow, { message: messageUtilisateur({ orientation: true }) } as never)
    )
    const entete = hote.querySelector('.msg.user > .msg-meta')
    expect(entete?.querySelector('.msg-orientation-tag')?.textContent).toBe('orienté en cours de tour')
    expect(entete?.textContent).not.toContain('Toi')
  })

  it("garde l'état d'un message envoyé pendant un tour, sans « Toi »", async () => {
    const hote = await rendre(
      createElement(DirectiveReceiptRow, {
        receipt: { id: 'r1', text: 'orientation', status: 'sent' }
      } as never)
    )
    const recu = hote.querySelector('.directive-receipt')
    expect(recu?.querySelector('.msg-role')).toBeNull()
    expect(recu?.textContent).not.toContain('Toi')
    expect(recu?.querySelector('.directive-receipt-status')?.textContent).toContain('Reçue')
  })
})
