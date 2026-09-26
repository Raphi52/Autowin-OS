// @vitest-environment happy-dom
/**
 * « TRAITER » DOIT OUVRIR UNE CONVERSATION NEUVE — pas écrire dans celle où l'on était.
 *
 * Symptôme rapporté le 2026-09-12 : « j'ai cliqué sur traiter dans le bandeau et ça m'a pas ouvert
 * une nouvelle conversation ». Le clic n'était pas mort : le `/salvage` partait dans la
 * conversation courante.
 *
 * La cause tenait à UNE valeur figée. `traiterTravauxNonPublies` ouvre un fil neuf (`newConv()`
 * remet `activeRef.current` à null) puis envoie le prompt à l'image suivante. Mais `send` lisait sa
 * destination dans `activeId` — la variable capturée au rendu du bouton, donc encore l'ANCIENNE
 * conversation. `activeRef.current`, lui, est mis à jour de façon synchrone partout où l'active
 * change : c'est la seule source fiable.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si la correction est défaite : reprendre `activeId` dans
 * `send` — `pilotChat` repartirait alors sur la conversation « A ».
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

let harnais: ChatHarness | undefined
beforeAll(() => installRafShim())
afterEach(async () => {
  await harnais?.unmount()
  harnais = undefined
})

const attendreLesTours = async (): Promise<void> => {
  for (let tour = 0; tour < 40; tour += 1) await new Promise((resolu) => setTimeout(resolu, 0))
}

describe('bandeau « travail jamais publié » — le bouton « Traiter »', () => {
  it('envoie le /salvage dans une conversation NEUVE, jamais dans la conversation ouverte', async () => {
    const conversationsCreate = vi.fn().mockResolvedValue({
      id: 'NEUVE',
      title: '/salvage',
      provider: 'codex',
      messages: []
    })
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const api = chatApi({
      conversationsCreate,
      pilotChat,
      getWorktreeActivity: vi.fn().mockResolvedValue([
        {
          agentId: 'a1',
          travailNonPublie: true,
          fichiersNonPublies: ['src/main/index.ts'],
          dateNonPublie: '2026-09-11'
        }
      ])
    })
    harnais = await mountChat(api)
    // La vue s'ouvre sur la conversation existante « A » : c'est elle qui ne doit PAS recevoir.
    expect(
      harnais.container.querySelector('[data-testid="chat-travail-non-publie"]'),
      'le bandeau doit s’afficher pour qu’on puisse cliquer'
    ).not.toBeNull()

    await harnais.click('[data-testid="chat-travail-non-publie-traiter"]')
    await attendreLesTours()

    expect(conversationsCreate, 'une conversation neuve doit être créée').toHaveBeenCalled()
    const cibles = pilotChat.mock.calls.map((appel) => appel[0]?.conversationId ?? appel[0])
    expect(cibles, 'le prompt ne doit pas partir dans la conversation ouverte').not.toContain('A')
  })
})
