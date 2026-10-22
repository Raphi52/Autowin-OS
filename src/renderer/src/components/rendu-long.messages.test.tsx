// @vitest-environment happy-dom
/**
 * conv-1077 (2026-10-22) : `renderer:vue-chat-fil` = 28 gels pour 62,4 s depuis le 15/10 (pire 7,6 s),
 * mais le fil était mesuré D'UN BLOC (`<VueMesuree id="chat-fil" bloc>`, ChatView.tsx) : rien ne
 * disait QUEL message coûtait. On mesure donc message par message (clé, rôle, taille — jamais le
 * texte) et le gel du fil emporte les plus lourds.
 * fix-ok: entrée qui fait échouer si le correctif est faux — lignes qui ne notent plus leur rendu (réinjection 2026-10-22 : 3 rouges, « expected [] to deeply equal ['recent'] »).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  messagesLesPlusLourds,
  noterRendu,
  noterRenduMessage,
  oublierRendusRecents,
  signalerRenduLong
} from './rendu-long'
import { VueMesuree } from './VueMesuree'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

type Appel = [number, string | undefined, unknown]
const canal = (vus: Appel[]): { signalerGelRenderer: (...a: unknown[]) => number } => ({
  signalerGelRenderer: (...a: unknown[]) => vus.push(a as Appel)
})

afterEach(() => {
  oublierRendusRecents()
  delete (window as unknown as { api?: unknown }).api
})

describe('rendu du fil mesuré message par message (conv-1077)', () => {
  it('le gel du fil emporte les messages les plus lourds, cumulés par message, 5 au plus', () => {
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si le gel du fil partait sans ses messages : un rendu
    // long de `chat` dominé par `chat-fil`, avec un message de 52 000 signes à 2 500 ms.
    noterRendu('chat-fil', 2_900)
    noterRenduMessage({ cle: 'm-2', role: 'user', taille: 40, ms: 3 })
    noterRenduMessage({ cle: 'm-7', role: 'assistant', taille: 52_000, ms: 1_500 })
    noterRenduMessage({ cle: 'm-7', role: 'assistant', taille: 52_000, ms: 1_000 })
    for (let i = 0; i < 6; i++) noterRenduMessage({ cle: `p-${i}`, role: 'user', taille: 1, ms: 1 })
    const vus: Appel[] = []
    expect(signalerRenduLong('chat', 3_000, 1_000, canal(vus))).toBe(true)
    expect(vus).toHaveLength(1)
    const [ms, etiquette, detail] = vus[0]!
    expect([ms, etiquette]).toEqual([3_000, 'vue-chat-fil'])
    const messages = (detail as { messages: Array<{ cle: string; ms: number; rendus: number }> })
      .messages
    expect(messages).toHaveLength(5)
    expect(messages[0]).toEqual({
      cle: 'm-7',
      role: 'assistant',
      taille: 52_000,
      ms: 2_500,
      rendus: 2
    })
    expect(messages[1]?.cle).toBe('m-2')
  })

  it('jumeau : un rendu long dominé par un AUTRE bloc que le fil part sans détail de messages', () => {
    noterRendu('chat-saisie', 2_900)
    noterRenduMessage({ cle: 'm-7', role: 'assistant', taille: 52_000, ms: 10 })
    const vus: Appel[] = []
    expect(signalerRenduLong('chat', 3_000, 1_000, canal(vus))).toBe(true)
    expect(vus).toEqual([[3_000, 'vue-chat-saisie']])
  })

  it('un message hors de la fenêtre récente (2 s) n’est plus accusé', () => {
    noterRenduMessage({ cle: 'ancien', role: 'user', taille: 9, ms: 50 }, 1_000)
    noterRenduMessage({ cle: 'recent', role: 'user', taille: 9, ms: 5 }, 4_000)
    expect(messagesLesPlusLourds(5, 4_000).map((m) => m.cle)).toEqual(['recent'])
  })

  it('de bout en bout : chaque ligne du fil se mesure, et le gel du fil nomme ses messages', async () => {
    const vus: Appel[] = []
    ;(window as unknown as { api: unknown }).api = canal(vus)
    // Rendu volontairement lent DANS le fil : il fait dépasser le seuil (1 s) au rendu de la vue.
    function Lent(): ReactElement {
      const debut = performance.now()
      while (performance.now() - debut < 1_050) {
        // attente active voulue
      }
      return createElement('span', null, 'lent')
    }
    const court = { role: 'user', content: 'salut', messageId: 'm-court' } as unknown as Msg
    const long = {
      role: 'assistant',
      content: '',
      parts: [{ kind: 'text', text: 'x'.repeat(5_000) }],
      done: true,
      messageId: 'm-long',
      turnId: 't1'
    } as unknown as Msg
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <VueMesuree id="chat">
          <VueMesuree id="chat-fil" bloc>
            <ChatMessageRow message={court} conversationId="A" />
            <ChatMessageRow message={long} conversationId="A" />
            <Lent />
          </VueMesuree>
        </VueMesuree>
      )
    })
    await act(async () => root.unmount())
    host.remove()
    const gel = vus.find((v) => v[1] === 'vue-chat-fil')
    expect(gel, 'le rendu du fil doit être signalé').toBeDefined()
    const cles = (gel![2] as { messages: Array<{ cle: string; role: string; taille: number }> })
      .messages
    expect(cles.map((m) => m.cle).sort()).toEqual(['m-court', 'm-long'])
    expect(cles.find((m) => m.cle === 'm-long')).toMatchObject({ role: 'assistant', taille: 5_000 })
    expect(cles.find((m) => m.cle === 'm-court')).toMatchObject({ role: 'user', taille: 5 })
  }, 15_000)
})
