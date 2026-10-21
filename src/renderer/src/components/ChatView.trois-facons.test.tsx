// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { canonicalProjectPath } from '../../../shared/project-path'

/**
 * « ESSAIE 3 FAÇONS » DE BOUT EN BOUT (conv-1038, 2026-10-21). Un bouton de la zone de saisie
 * prend la demande tapée, ouvre trois copies séparées du code (main), trois branches du fil — une
 * par copie —, envoie à chacune la demande avec une façon imposée, et ouvre les trois en mosaïque.
 *
 * Les entrées qui font échouer une version fausse : deux branches rattachées à la MÊME copie (elles
 * écriraient l'une sur l'autre) ; une branche qui recevrait la demande sans sa façon imposée ; une
 * demande vide (rien ne doit partir, aucune copie ne doit s'ouvrir) ; une branche REVENUE SANS sa
 * copie (rangement après coup en échec, `setProject` → `null`) — la version en deux appels lui
 * envoyait quand même la demande, et l'agent travaillait alors dans le dossier PARTAGÉ (conv-1038).
 *
 * fix-ok: cause mesurée (conv-1038, rejeu du 2026-10-21) — chaque branche était rattachée à sa copie par un 2e appel non relu. Ce test la fait naître avec son dossier (`fork(…, { dossier })`) et exige la relecture : sans la relecture, « une branche revenue SANS sa copie » est rouge ; avec un fork sans dossier, « trois branches, chacune dans SA copie » est rouge.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const fil = (id: string, title = id): Record<string, unknown> => ({
  id,
  title,
  provider: 'codex',
  updatedAt: 1,
  messages: [
    { role: 'user', content: 'refonte', ts: 1, messageId: `${id}-m1` },
    {
      role: 'assistant',
      content: 'ok',
      ts: 1,
      messageId: `${id}-m2`,
      turnId: `${id}-t1`,
      status: 'completed',
      parts: [{ kind: 'text', text: 'ok' }]
    }
  ]
})

const CHEMINS = ['D:/essais/essai__A-5-1', 'D:/essais/essai__A-5-2', 'D:/essais/essai__A-5-3']

describe('ChatView — « Essaie 3 façons »', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>

  // Le main range chaque branche à sa création (`ConversationStore.fork`, chemin CANONISÉ).
  // `sansCopie` : la branche de ce rang revient sans sa copie (processus principal d'avant).
  async function monter(sansCopie?: number): Promise<void> {
    window.localStorage.clear()
    const branches = ['A-1', 'A-2', 'A-3'].map((id) => fil(id, 'Refonte'))
    let rang = 0
    api = chatApi({
      conversations: vi
        .fn()
        .mockResolvedValueOnce([fil('A', 'Refonte')])
        .mockResolvedValue([fil('A', 'Refonte'), ...branches]),
      conversation: vi.fn(async (id: string) => fil(id, 'Refonte')),
      conversationsFork: vi.fn(
        async (_id: string, _ancre: string, options?: { dossier?: string }) => {
          const branche = branches[rang]
          rang += 1
          return rang !== sansCopie && options?.dossier
            ? { ...branche, projectPath: canonicalProjectPath(options.dossier) }
            : branche
        }
      ),
      conversationsSetProject: vi.fn().mockResolvedValue(null),
      conversationsRename: vi.fn(async (id: string, title: string) => ({ id, title })),
      conversationEssaisEnParallele: vi
        .fn()
        .mockResolvedValue({ ok: true, quand: 5, chemins: CHEMINS }),
      pilotChat: vi.fn().mockResolvedValue({ ok: true, messages: [] })
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
  }

  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  async function cliquerTroisFacons(): Promise<void> {
    const bouton = h!.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Essaie 3 façons"]'
    )
    expect(bouton).not.toBeNull()
    await act(async () => {
      bouton!.click()
      for (let i = 0; i < 12; i += 1) await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }

  it('trois branches, chacune dans SA copie, chacune avec SA façon, ouvertes en mosaïque', async () => {
    await monter()
    await h!.type('refais le carnet du fil')
    await cliquerTroisFacons()

    expect(api.conversationEssaisEnParallele).toHaveBeenCalledWith('A', 3)
    expect(api.conversationsFork).toHaveBeenCalledTimes(3)
    expect((api.conversationsFork as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['A', 'A-m2', { dossier: CHEMINS[0] }],
      ['A', 'A-m2', { dossier: CHEMINS[1] }],
      ['A', 'A-m2', { dossier: CHEMINS[2] }]
    ])
    expect(api.conversationsSetProject).not.toHaveBeenCalled()
    expect(api.conversationsRename).toHaveBeenCalledWith('A-2', 'Refonte — façon 2/3')

    const envois = (api.pilotChat as ReturnType<typeof vi.fn>).mock.calls.map((appel) => ({
      fil: appel[1] as string,
      texte: (appel[0] as Array<{ content: string }>).at(-1)?.content ?? ''
    }))
    expect(envois.map((envoi) => envoi.fil).sort()).toEqual(['A-1', 'A-2', 'A-3'])
    for (const envoi of envois) {
      const rang = Number(envoi.fil.slice(-1))
      expect(envoi.texte.startsWith('refais le carnet du fil')).toBe(true)
      expect(envoi.texte).toContain(`Essai ${rang}/3`)
    }
    expect(h!.container.querySelector('[data-testid="chat-mosaic"]')).not.toBeNull()
    expect(h!.textarea()?.value ?? '').toBe('')
    // L'avis (copies, coût) s'affiche EN MOSAÏQUE : il n'existait que dans la vue du fil unique.
    expect(
      h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent
    ).toContain('Coût : 3 tours')
  })

  it('une branche revenue SANS sa copie ne reçoit rien ; les deux autres partent, l’avis le dit', async () => {
    await monter(2)
    await h!.type('refais le carnet du fil')
    await cliquerTroisFacons()

    const envois = (api.pilotChat as ReturnType<typeof vi.fn>).mock.calls.map((appel) => ({
      fil: appel[1] as string,
      texte: (appel[0] as Array<{ content: string }>).at(-1)?.content ?? ''
    }))
    expect(envois.map((envoi) => envoi.fil).sort()).toEqual(['A-1', 'A-3'])
    // La 3e garde SA façon (titre « façon 3/3 ») : le trou laissé par la 2e ne décale rien.
    expect(envois.find((envoi) => envoi.fil === 'A-3')?.texte).toContain('Essai 3/3')
    expect(h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent).toMatch(
      /pas pu être rattachée/
    )
  })

  it('sans demande tapée : rien ne part, aucune copie ne s’ouvre, la raison est dite', async () => {
    await monter()
    await cliquerTroisFacons()
    expect(api.conversationEssaisEnParallele).not.toHaveBeenCalled()
    expect(api.pilotChat).not.toHaveBeenCalled()
    expect(h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent).toMatch(
      /demande/i
    )
  })
})
