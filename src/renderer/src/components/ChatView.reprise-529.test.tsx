// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * Quand le fournisseur renvoie 529 (« surchargé »), la demande n'a produit AUCUNE réponse. Au lieu
 * de laisser l'utilisateur retaper son message, on rejoue la même demande dans une COPIE de la
 * conversation prise juste avant elle — au plus 3 fois. L'échec d'origine reste visible.
 */
describe('reprise automatique après un 529', () => {
  let harness: ChatHarness | null = null

  const err529 =
    'API Claude surchargée (529) — abandon après 10/10 tentatives, aucune réponse. Réessayez.'

  const source = (): Record<string, unknown> => ({
    id: 'A',
    title: 'A',
    provider: 'codex',
    updatedAt: 1,
    messages: [
      { role: 'user', content: 'u1', ts: 1, messageId: 'm1' },
      {
        role: 'assistant',
        content: 'a1',
        ts: 1,
        messageId: 'm2',
        parentMessageId: 'm1',
        turnId: 't1',
        status: 'completed',
        parts: [{ kind: 'text', text: 'a1' }]
      }
    ]
  })
  const copie = {
    id: 'A-fork',
    title: 'A (fork)',
    provider: 'codex',
    updatedAt: 2,
    messages: [{ role: 'user', content: 'u1', ts: 1, messageId: 'f1' }]
  }

  beforeEach(() => installRafShim())
  afterEach(async () => {
    vi.useRealTimers()
    await harness?.unmount()
    harness = null
  })

  async function envoyer(api: Record<string, unknown>): Promise<void> {
    harness = await mountChat(api)
    await harness.click('.conv-pick')
    await harness.type('ma demande')
    // rAF/cAF sont shimés par le harnais sur des propriétés non assignables : les faire truquer
    // par vitest jette. On ne truque que les timers, sur lesquels le shim s'appuie déjà.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    await act(async () => {
      harness!
        .textarea()
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        )
      await Promise.resolve()
      await Promise.resolve()
    })
    /*
     * 5 s + 15 s + 30 s d'attentes, plus la marge des rAF : tout se joue en temps simulé. Chaque
     * reprise n'arme SON attente qu'apres la cloture du tour precedent — donc apres le drain en
     * cours. On rejoue le drain autant de fois qu'il y a de reprises possibles, sinon seule la
     * premiere partirait.
     */
    for (let tour = 0; tour < 5; tour++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
  }

  it('forke au dernier message AVANT la demande et la rejoue dans la copie', async () => {
    const fork = vi.fn().mockResolvedValue(copie)
    const pilotChat = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: err529 })
      .mockResolvedValue({ ok: true })
    await envoyer(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValueOnce([source()])
          .mockResolvedValue([source(), copie]),
        conversation: vi.fn().mockResolvedValue(source()),
        conversationsFork: fork,
        pilotChat
      })
    )
    // La copie part du dernier message AVANT la demande ratée : sinon la demande y serait en double.
    expect(fork).toHaveBeenCalledWith('A', 'm2')
    // La MÊME demande est rejouée, dans la copie.
    expect(pilotChat).toHaveBeenCalledTimes(2)
    expect(pilotChat.mock.calls[1][1]).toBe('A-fork')
    /*
     * Le texte rejoué est bien celui de la demande ratée. L'HISTORIQUE, lui, est celui de la COPIE
     * et non celui du fil d'origine : la reprise passe par l'envoi normal dans la conversation
     * copiée, qui s'arrête juste avant la demande. Exiger deux enveloppes identiques au caractère
     * reviendrait à exiger que la copie porte la demande ratée en double.
     */
    const dernier = (appel: unknown): string | undefined =>
      (appel as Array<{ content?: string }>).at(-1)?.content
    expect(dernier(pilotChat.mock.calls[1][0])).toBe(dernier(pilotChat.mock.calls[0][0]))
  })

  it('s arrête à 3 reprises et laisse la panne visible', async () => {
    // Chaque reprise crée SA copie, et la liste des conversations doit la contenir : la reprise
    // rouvre la copie par son id avant de rejouer dedans.
    const copies: Array<Record<string, unknown>> = []
    const fork = vi.fn(async () => {
      const nouvelle = { ...copie, id: `A-fork-${fork.mock.calls.length}` }
      copies.push(nouvelle)
      return nouvelle
    })
    const pilotChat = vi.fn().mockResolvedValue({ ok: false, error: err529 })
    await envoyer(
      chatApi({
        conversations: vi.fn(async () => [source(), ...copies]),
        conversation: vi.fn().mockResolvedValue(source()),
        conversationsFork: fork,
        pilotChat
      })
    )
    expect(fork).toHaveBeenCalledTimes(3)
    expect(pilotChat).toHaveBeenCalledTimes(4) // 1 demande + 3 reprises
    expect(harness!.container.textContent ?? '').toContain('529')
  })

  it('ne reprend PAS un échec ordinaire', async () => {
    const fork = vi.fn().mockResolvedValue(copie)
    const pilotChat = vi.fn().mockResolvedValue({ ok: false, error: 'tests rouges' })
    await envoyer(
      chatApi({
        conversations: vi.fn().mockResolvedValue([source()]),
        conversation: vi.fn().mockResolvedValue(source()),
        conversationsFork: fork,
        pilotChat
      })
    )
    expect(fork).not.toHaveBeenCalled()
    expect(pilotChat).toHaveBeenCalledTimes(1)
  })
})
