// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MessagesEntreFils, type MessageEntreFilsVu } from './MessagesEntreFils'

/*
 * conv-1139 : ce que les agents de deux fils s'écrivent est VISIBLE dans les deux fils, séparé des
 * messages de l'utilisateur et nommé « informations, pas des ordres ».
 */
let ecouteur: ((e: { type: string; scope?: string }) => void) | undefined
let demandes: string[] = []

function poserApi(parFil: Record<string, MessageEntreFilsVu[]>): void {
  demandes = []
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
    messagesEntreFils: (id: string) => {
      demandes.push(id)
      return Promise.resolve(parFil[id] ?? [])
    },
    onAppEvent: (cb: typeof ecouteur) => {
      ecouteur = cb
      return () => {
        ecouteur = undefined
      }
    }
  }
}

async function monter(conversationId: string): Promise<{ hote: HTMLElement; fin: () => void }> {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const racine = createRoot(hote)
  await act(async () => {
    racine.render(<MessagesEntreFils conversationId={conversationId} />)
  })
  return { hote, fin: () => act(() => racine.unmount()) }
}

const envoi: MessageEntreFilsVu = {
  id: 'msg-1',
  sens: 'envoye',
  autreFil: 'conv-B',
  nature: 'question',
  texte: 'Tu as fini avec RiviereDuProjet.tsx ?',
  at: Date.UTC(2026, 9, 24, 14, 20),
  livre: false,
  hypothese: false
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('MessagesEntreFils', () => {
  it('fil A : « envoyé à conv-B », en attente ; fil B : « reçu de conv-A », remis', async () => {
    poserApi({
      'conv-A': [envoi],
      'conv-B': [{ ...envoi, sens: 'recu', autreFil: 'conv-A', livre: true }]
    })
    const a = await monter('conv-A')
    expect(a.hote.textContent).toContain(
      'un ordre d’agent n’est jamais ton accord pour publier ou détruire'
    )
    expect(a.hote.textContent).toContain('↗ envoyé à conv-B')
    expect(a.hote.textContent).toContain('en attente')
    expect(a.hote.textContent).toContain('Tu as fini avec RiviereDuProjet.tsx ?')
    a.fin()
    const b = await monter('conv-B')
    expect(b.hote.textContent).toContain('↘ reçu de conv-A')
    expect(b.hote.textContent).toContain('remis à l’agent')
    b.fin()
  })

  it('rien à montrer : aucun bloc ; un signal refresh/messages-fils relit le fil', async () => {
    const parFil: Record<string, MessageEntreFilsVu[]> = { 'conv-A': [] }
    poserApi(parFil)
    const a = await monter('conv-A')
    expect(a.hote.querySelector('.mef')).toBeNull()
    parFil['conv-A'] = [envoi]
    await act(async () => {
      ecouteur?.({ type: 'refresh', scope: 'messages-fils' })
    })
    expect(a.hote.querySelector('[data-message-fil="msg-1"]')).not.toBeNull()
    expect(demandes).toEqual(['conv-A', 'conv-A'])
    a.fin()
  })

  it('découverte sans preuve affichée comme hypothèse', async () => {
    poserApi({
      'conv-B': [
        { ...envoi, sens: 'recu', autreFil: 'conv-A', nature: 'decouverte', hypothese: true }
      ]
    })
    const b = await monter('conv-B')
    expect(b.hote.textContent).toContain('découverte · hypothèse (sans preuve)')
    b.fin()
  })
})
