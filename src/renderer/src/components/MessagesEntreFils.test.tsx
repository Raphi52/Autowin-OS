// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MessagesEntreFils, type MessageEntreFilsVu } from './MessagesEntreFils'

/*
 * conv-1139 : ce que les agents de deux fils s'écrivent est VISIBLE dans les deux fils, séparé des
 * messages de l'utilisateur.
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
  it('fil A : bulle envoyée, en attente ; fil B : bulle reçue, remise', async () => {
    poserApi({
      'conv-A': [envoi],
      'conv-B': [{ ...envoi, sens: 'recu', autreFil: 'conv-A', livre: true }]
    })
    const a = await monter('conv-A')
    const bulleA = a.hote.querySelector('[data-message-fil="msg-1"]')
    expect(bulleA?.classList.contains('mef-bulle--envoye')).toBe(true)
    expect(bulleA?.getAttribute('aria-label')).toBe('envoyé à conv-B')
    expect(bulleA?.textContent).toContain('Tu as fini avec RiviereDuProjet.tsx ?')
    expect(bulleA?.textContent).toContain('en attente')
    a.fin()
    const b = await monter('conv-B')
    const bulleB = b.hote.querySelector('[data-message-fil="msg-1"]')
    expect(bulleB?.classList.contains('mef-bulle--recu')).toBe(true)
    expect(bulleB?.getAttribute('aria-label')).toBe('reçu de conv-A')
    expect(bulleB?.textContent).toContain('remis à l’agent')
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

  it('découverte sans preuve : nature « découverte · hypothèse » dans la bulle', async () => {
    poserApi({
      'conv-B': [
        { ...envoi, sens: 'recu', autreFil: 'conv-A', nature: 'decouverte', hypothese: true }
      ]
    })
    const b = await monter('conv-B')
    expect(b.hote.querySelector('.mef-nature')?.textContent).toBe('découverte · hypothèse')
    b.fin()
  })

  /*
   * conv-1139, 2026-10-25 (/draft, proposition 2 « Bulles » choisie) : les messages se lisent
   * comme un petit chat, RANGÉS PAR FIL — un groupe « avec conv-X » par fil correspondant, le
   * groupe le plus récemment actif en bas ; l'avertissement n'accompagne plus que les ordres.
   */
  it('range les messages par fil, groupe le plus récemment actif en bas', async () => {
    const h = (min: number): number => Date.UTC(2026, 9, 25, 7, min)
    poserApi({
      'conv-1141': [
        { ...envoi, id: 'o', sens: 'recu', autreFil: 'conv-1140', nature: 'ordre', at: h(30) },
        { ...envoi, id: 'd', sens: 'recu', autreFil: 'conv-1137', nature: 'decouverte', at: h(33) },
        { ...envoi, id: 'r', sens: 'envoye', autreFil: 'conv-1140', nature: 'reponse', at: h(35) },
        { ...envoi, id: 'i', sens: 'recu', autreFil: 'conv-1137', nature: 'info', at: h(41) }
      ]
    })
    const v = await monter('conv-1141')
    const groupes = Array.from(v.hote.querySelectorAll('.mef-groupe'))
    expect(groupes.map((g) => g.querySelector('.mef-avec')?.textContent)).toEqual([
      'avec conv-1140',
      'avec conv-1137'
    ])
    const ids = (g: Element): Array<string | null> =>
      Array.from(g.querySelectorAll('[data-message-fil]')).map((b) =>
        b.getAttribute('data-message-fil')
      )
    expect(ids(groupes[0])).toEqual(['o', 'r'])
    expect(ids(groupes[1])).toEqual(['d', 'i'])
    v.fin()
  })

  it('l’avertissement « pas ton accord » n’accompagne que les ordres', async () => {
    poserApi({
      'conv-A': [
        { ...envoi, id: 'o', sens: 'recu', nature: 'ordre' },
        { ...envoi, id: 'q', sens: 'recu', nature: 'question' }
      ]
    })
    const a = await monter('conv-A')
    const avert = 'pas ton accord pour publier ou détruire'
    expect(a.hote.querySelector('[data-message-fil="o"]')?.textContent).toContain(avert)
    expect(a.hote.querySelector('[data-message-fil="q"]')?.textContent).not.toContain(avert)
    expect(a.hote.textContent?.split(avert).length).toBe(2)
    a.fin()
  })

  it('au-delà de max : les plus anciens sont annoncés en tête', async () => {
    poserApi({
      'conv-A': [1, 2, 3].map((n) => ({ ...envoi, id: `m${n}`, at: envoi.at + n }))
    })
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    await act(async () => {
      racine.render(<MessagesEntreFils conversationId="conv-A" max={2} />)
    })
    expect(hote.querySelector('.mef > :first-child')?.textContent).toBe('1 message plus ancien')
    expect(hote.querySelector('[data-message-fil="m1"]')).toBeNull()
    act(() => racine.unmount())
  })
})
