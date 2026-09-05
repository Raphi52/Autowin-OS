// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * LA DEMANDE : dans la barre du haut du chat, le dossier de travail et la branche doivent etre
 * CLIQUABLES, et permettre de choisir l'un et l'autre depuis cette barre.
 *
 * Avant ce changement les deux etaient des <span> muets : l'information s'affichait, rien ne
 * s'ouvrait. Le test regarde donc ce que l'utilisateur peut FAIRE (cliquer, voir une liste,
 * choisir) et non le balisage pour lui-meme.
 */
describe('ChatView — barre du haut : choisir le dossier et la branche', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('ouvre le choix du dossier de travail depuis la pastille du dossier', async () => {
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([
            conversation('conv-1'),
            { ...conversation('conv-2'), projectPath: 'D:/Projets/Autre' }
          ]),
        conversation: vi.fn().mockResolvedValue({ id: 'conv-1', messages: [] })
      })
    )

    const pastille = harness.container.querySelector<HTMLElement>(
      '[data-testid="chat-project-dot"]'
    )
    expect(pastille).not.toBeNull()
    // Cliquable = un vrai bouton, pas un texte inerte.
    expect(pastille?.tagName).toBe('BUTTON')

    await act(async () => {
      pastille!.click()
    })

    const choix = document.querySelectorAll('[data-testid="conv-project-choice"]')
    expect(choix.length).toBeGreaterThan(0)
    // Et un dossier hors de la liste reste atteignable par le selecteur natif.
    expect(document.querySelector('[data-testid="conv-project-pick"]')).not.toBeNull()
  })

  it('liste les branches et BASCULE quand on en choisit une', async () => {
    const getGitBranches = vi.fn().mockResolvedValue(['main', 'feat/topbar'])
    const checkoutGitBranch = vi.fn().mockResolvedValue({ ok: true, branch: 'feat/topbar' })
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('conv-1')]),
        conversation: vi.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
        getGitState: vi.fn().mockResolvedValue({
          available: true,
          state: { branch: 'main', ahead: 0, behind: 0, changes: [] }
        }),
        getGitBranches,
        checkoutGitBranch
      })
    )

    const branche = harness.container.querySelector<HTMLElement>('[data-testid="chat-git-branch"]')
    expect(branche).not.toBeNull()
    expect(branche?.tagName).toBe('BUTTON')

    await act(async () => {
      branche!.click()
    })

    expect(getGitBranches).toHaveBeenCalled()
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="chat-branch-choice"]')
    )
    expect(items.map((el) => el.dataset.branch)).toEqual(['main', 'feat/topbar'])

    await act(async () => {
      items[1]!.click()
    })

    // La bascule est REELLE : l'application recoit l'ordre, et le menu se ferme sur un succes.
    expect(checkoutGitBranch.mock.calls[0]?.[0]).toBe('feat/topbar')
    expect(document.querySelectorAll('[data-testid="chat-branch-choice"]').length).toBe(0)
  })

  /*
    DEFAUT MESURE : le badge lisait le depot du PROCESSUS (getGitState() sans chemin) alors que le
    menu basculait le depot de la CONVERSATION. Cliquer une branche ne « positionnait » donc jamais
    l'ecran dessus. Le badge et la bascule doivent viser le MEME depot.
  */
  it('lit et bascule le MEME depot que celui de la conversation', async () => {
    const getGitState = vi.fn().mockResolvedValue({
      available: true,
      state: { branch: 'main', ahead: 0, behind: 0, changes: [] }
    })
    const getGitBranches = vi.fn().mockResolvedValue(['main', 'feat/topbar'])
    const checkoutGitBranch = vi.fn().mockResolvedValue({ ok: true, branch: 'feat/topbar' })
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([{ ...conversation('conv-1'), projectPath: 'D:/Projets/Autre' }]),
        conversation: vi.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
        getGitState,
        getGitBranches,
        checkoutGitBranch
      })
    )

    const branche = harness.container.querySelector<HTMLElement>('[data-testid="chat-git-branch"]')
    await act(async () => {
      branche!.click()
    })
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="chat-branch-choice"]')
    )
    await act(async () => {
      items[1]!.click()
    })

    expect(getGitState.mock.calls.at(-1)?.[0]).toBe('D:/Projets/Autre')
    expect(getGitBranches.mock.calls.at(-1)?.[0]).toBe('D:/Projets/Autre')
    expect(checkoutGitBranch.mock.calls.at(-1)?.[1]).toBe('D:/Projets/Autre')
  })

  it('affiche le refus et ne ferme pas le menu quand le depot est sale', async () => {
    const checkoutGitBranch = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'Le depot a 3 fichier(s) non enregistre(s)' })
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('conv-1')]),
        conversation: vi.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
        getGitState: vi.fn().mockResolvedValue({
          available: true,
          state: { branch: 'main', ahead: 0, behind: 0, changes: [] }
        }),
        getGitBranches: vi.fn().mockResolvedValue(['main', 'feat/topbar']),
        checkoutGitBranch
      })
    )

    await act(async () => {
      harness!.container.querySelector<HTMLElement>('[data-testid="chat-git-branch"]')!.click()
    })
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="chat-branch-choice"]')
    )
    await act(async () => {
      items[1]!.click()
    })

    const refus = document.querySelector('[data-testid="chat-branch-refus"]')
    expect(refus?.textContent ?? '').toContain('non enregistre')
    // Le menu reste ouvert : un refus invisible ferait croire a une bascule silencieuse.
    expect(document.querySelectorAll('[data-testid="chat-branch-choice"]').length).toBe(2)
  })
})
