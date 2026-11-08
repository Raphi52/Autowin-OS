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
 * LA BRANCHE D'UN FIL DANS SA COPIE. La copie n'est sur aucune branche : son travail entre, à la fin
 * de chaque tour, dans la branche active du dossier principal. Un développeur qui y travaille sur la
 * branche de son work item doit lire CETTE branche dans l'en-tête, seule, sans « (detached) » ni
 * mention de la copie.
 */
const DEPOT = 'D:/Projets/Autowin'
const COPIE = 'D:/Projets/Autowin/.autowin-data/autowin-os/copies-de-fil/conv-1'

describe('ChatView — branche affichée pour un fil qui travaille dans sa copie', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('montre la branche du dossier principal, là où le travail arrive', async () => {
    const getGitBranch = vi.fn((cwd?: string) =>
      Promise.resolve({
        available: true,
        state: { branch: cwd === COPIE ? '(detached)' : 'wi-1234' }
      })
    )
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([
          {
            ...conversation('conv-1'),
            projectPath: COPIE,
            copieDuFil: { chemin: COPIE, depot: DEPOT, dossierAvant: DEPOT }
          }
        ]),
        conversation: vi.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
        getGitBranch
      })
    )
    await act(async () => {
      await Promise.resolve()
    })

    const badge = harness.container.querySelector<HTMLElement>('[data-testid="chat-git-branch"]')
    // Tous les fils travaillent dans une copie : le badge montre la branche seule, sans mention.
    expect((badge?.textContent ?? '').trim()).toBe('wi-1234')
    expect(badge?.title ?? '').toContain('wi-1234')
    expect(getGitBranch.mock.calls.at(-1)?.[0]).toBe(DEPOT)
  })

  it('un fil hors copie garde sa branche cliquable, lue dans son dossier', async () => {
    const getGitBranch = vi.fn().mockResolvedValue({ available: true, state: { branch: 'main' } })
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([{ ...conversation('conv-1'), projectPath: DEPOT }]),
        conversation: vi.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
        getGitBranch
      })
    )

    const badge = harness.container.querySelector<HTMLElement>('[data-testid="chat-git-branch"]')
    expect(badge?.tagName).toBe('BUTTON')
    expect(badge?.textContent ?? '').toContain('main')
    expect(badge?.textContent ?? '').not.toContain('copie du fil')
    expect(getGitBranch.mock.calls.at(-1)?.[0]).toBe(DEPOT)
  })
})
