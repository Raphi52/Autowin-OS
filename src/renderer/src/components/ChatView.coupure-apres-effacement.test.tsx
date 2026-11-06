// @vitest-environment happy-dom
/**
 * 2026-10-31, saisie ts 1793470923242 : « quand j'ai envoyé mon message ça a suppr la
 * réponse du tour d'avant ». Le fil enregistré portait trois consignes écrites pendant le tour : la
 * 1re avec une coupure à 51 sur une réponse réduite à 50 parts par un effacement, les deux autres
 * sans coupure du tout. Relu, le fil remontait toute la réponse AU-DESSUS des trois consignes.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

describe('ChatView — fil relu dont la coupure est périmée ou absente', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function texteDuFil(messages: Parameters<typeof conversation>[1]): Promise<string> {
    const fil = conversation('A', messages)
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([fil]),
        conversation: vi.fn().mockResolvedValue(fil)
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    return h.container.textContent ?? ''
  }

  it('coupure au-delà de la réponse et consignes sans coupure : on coupe à l’heure de chaque consigne', async () => {
    const texte = await texteDuFil([
      { role: 'user', content: 'fais une video', messageId: 'm1', ts: 500 },
      {
        role: 'assistant',
        messageId: 'm2',
        status: 'completed',
        content: '',
        parts: [
          { kind: 'text', streamId: 'lectures:retenue', text: 'COMPREHENSION', at: 1000 },
          { kind: 'text', streamId: '0:0:bloc-a', text: 'TRAVAIL-A', at: 2000 },
          { kind: 'text', streamId: '0:0:bloc-b', text: 'TRAVAIL-B', at: 3500 },
          { kind: 'text', streamId: '1:0', text: 'CONCLUSION-FINALE', at: 5000 }
        ]
      },
      {
        role: 'user',
        content: 'CONSIGNE-UN',
        messageId: 'm3',
        orientation: true,
        coupeLaReponse: 51,
        ts: 1800
      },
      { role: 'user', content: 'CONSIGNE-DEUX', messageId: 'm4', orientation: true, ts: 3000 },
      { role: 'user', content: 'CONSIGNE-TROIS', messageId: 'm5', orientation: true, ts: 4000 }
    ])
    const ordre = [
      'COMPREHENSION',
      'CONSIGNE-UN',
      'TRAVAIL-A',
      'CONSIGNE-DEUX',
      'TRAVAIL-B',
      'CONSIGNE-TROIS',
      'CONCLUSION-FINALE'
    ].map((mot) => texte.indexOf(mot))
    expect(ordre.every((rang) => rang >= 0)).toBe(true)
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre)
  })

  it('coupure à 0 (tout ce qui la précédait a été effacé) : la réponse entière passe SOUS la consigne', async () => {
    const texte = await texteDuFil([
      { role: 'user', content: 'fais une video', messageId: 'm1' },
      {
        role: 'assistant',
        messageId: 'm2',
        status: 'completed',
        content: '',
        parts: [{ kind: 'text', streamId: '1:0', text: 'CONCLUSION-FINALE' }]
      },
      {
        role: 'user',
        content: 'CONSIGNE-UN',
        messageId: 'm3',
        orientation: true,
        coupeLaReponse: 0
      }
    ])
    expect(texte.indexOf('CONSIGNE-UN')).toBeGreaterThanOrEqual(0)
    expect(texte.indexOf('CONCLUSION-FINALE')).toBeGreaterThan(texte.indexOf('CONSIGNE-UN'))
  })
})
