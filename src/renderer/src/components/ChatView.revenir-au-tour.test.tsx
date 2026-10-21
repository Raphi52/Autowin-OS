// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { canonicalProjectPath } from '../../../shared/project-path'

/**
 * « REVENIR À CE TOUR, CODE ET FIL » (conv-1038, 2026-10-21 — décision « branches-rewind », étape 2).
 * Sous chacun de ses messages, l'utilisateur peut repartir de l'état du début de ce tour : le CODE
 * rouvert dans une copie séparée (le dossier partagé ne bouge pas) et le FIL arrêté juste avant le
 * message, ce fil travaillant dans cette copie. Le texte du message attend dans la saisie ; rien
 * n'est envoyé.
 *
 * Les entrées qui font échouer une version fausse : une copie qui ne serait pas rattachée au fil
 * (le tour suivant écrirait dans le dossier partagé) ; un tour sans photo (aucune branche ne doit
 * être créée, la raison doit être dite) ; une branche REVENUE SANS sa copie, quand le rangement
 * après coup échoue (`setProject` rend `null`) — mesuré le 2026-10-21 : la version en deux appels
 * ouvrait quand même la branche et annonçait « Ce fil y travaille ». Le dossier part donc AVEC la
 * branche (`fork(…, { dossier })`), et la réponse est relue.
 *
 * fix-ok: cause mesurée (conv-1038, rejeu du 2026-10-21) — la branche était rattachée à sa copie par un 2e appel non relu. Entrée qui fait rougir une version fausse : un fork qui rend la branche SANS `projectPath`. Sans la relecture, « branche revenue SANS sa copie » est rouge ; avec un fork sans dossier, « RATTACHÉ à cette copie » est rouge.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const source = (): Record<string, unknown> => ({
  id: 'A',
  title: 'A',
  provider: 'codex',
  updatedAt: 1,
  messages: [
    { role: 'user', content: 'première demande', ts: 1, messageId: 'm1' },
    {
      role: 'assistant',
      content: 'a1',
      ts: 1,
      messageId: 'm2',
      turnId: 't1',
      status: 'completed',
      parts: [{ kind: 'text', text: 'a1' }]
    },
    { role: 'user', content: 'seconde demande', ts: 2, messageId: 'm3' },
    {
      role: 'assistant',
      content: 'a2',
      ts: 2,
      messageId: 'm4',
      turnId: 't2',
      status: 'completed',
      parts: [{ kind: 'text', text: 'a2' }]
    }
  ]
})

const copie = {
  id: 'A-copie',
  title: 'A (fork)',
  provider: 'codex',
  updatedAt: 3,
  messages: (source().messages as unknown[]).slice(0, 2)
}

const CHEMIN = 'D:/donnees/retours-de-tour/retour__A-3050'

describe('ChatView — « Revenir à ce tour, code et fil »', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>

  // Le main range la branche à sa création (`ConversationStore.fork`) et rend le chemin CANONISÉ ;
  // `rattache: false` simule une branche revenue sans sa copie (processus principal d'avant).
  async function monter(retour: unknown, rattache = true): Promise<void> {
    api = chatApi({
      conversations: vi.fn().mockResolvedValueOnce([source()]).mockResolvedValue([source(), copie]),
      conversation: vi.fn(async (id: string) => (id === 'A-copie' ? copie : source())),
      conversationsFork: vi.fn(
        async (_id: string, _ancre: string, options?: { dossier?: string }) => ({
          ...copie,
          ...(rattache && options?.dossier
            ? { projectPath: canonicalProjectPath(options.dossier) }
            : {})
        })
      ),
      conversationsSetProject: vi.fn().mockResolvedValue(null),
      conversationRevenirAuTour: vi.fn().mockResolvedValue(retour)
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
  }

  beforeEach(() => window.localStorage.clear())
  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  function boutons(): HTMLButtonElement[] {
    return [
      ...h!.container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Revenir à ce tour, code et fil"]'
      )
    ]
  }

  async function cliquer(bouton: HTMLButtonElement): Promise<void> {
    await act(async () => {
      bouton.click()
      for (let i = 0; i < 8; i += 1) await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('un bouton sous chaque message de l’utilisateur', async () => {
    await monter({ ok: true, chemin: CHEMIN, deja: false, quand: 3_050 })
    expect(boutons()).toHaveLength(2)
  })

  it('code rouvert dans une copie, fil arrêté avant le message et RATTACHÉ à cette copie', async () => {
    await monter({ ok: true, chemin: CHEMIN, deja: false, quand: 3_050 })
    await cliquer(boutons()[1])
    expect(api.conversationRevenirAuTour).toHaveBeenCalledWith('A', 'm3')
    expect(api.conversationsFork).toHaveBeenCalledWith('A', 'm2', { dossier: CHEMIN })
    expect(api.conversationsSetProject).not.toHaveBeenCalled()
    expect(
      h!.container
        .querySelector('[data-testid="chat-view"]')
        ?.getAttribute('data-active-conversation-id')
    ).toBe('A-copie')
    expect(h!.textarea().value).toBe('seconde demande')
    expect(
      h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent
    ).toContain(CHEMIN)
    expect(api.pilotChat).not.toHaveBeenCalled()
  })

  it('branche revenue SANS sa copie : rien ne s’ouvre, rien n’attend, la raison est dite', async () => {
    await monter({ ok: true, chemin: CHEMIN, deja: false, quand: 3_050 }, false)
    await cliquer(boutons()[1])
    expect(
      h!.container
        .querySelector('[data-testid="chat-view"]')
        ?.getAttribute('data-active-conversation-id')
    ).toBe('A')
    expect(h!.textarea().value).toBe('')
    const avis =
      h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent ?? ''
    expect(avis).toMatch(/pas pu être rattachée/)
    expect(avis).not.toMatch(/Ce fil y travaille/)
    expect(api.pilotChat).not.toHaveBeenCalled()
  })

  it('tour sans photo : aucune branche, la raison est dite', async () => {
    await monter({ ok: false, raison: 'Aucune photo du code pour ce tour.' })
    await cliquer(boutons()[1])
    expect(api.conversationsFork).not.toHaveBeenCalled()
    expect(api.conversationsSetProject).not.toHaveBeenCalled()
    expect(
      h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent
    ).toContain('Aucune photo du code pour ce tour.')
  })
})
