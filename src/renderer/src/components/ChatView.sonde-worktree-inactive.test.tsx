// @vitest-environment happy-dom
/**
 * LA SONDE WORKTREE NE TOURNE QUE QUAND LE CHAT EST À L'ÉCRAN.
 *
 * `App.tsx` garde la vue Chat MONTÉE quand on passe sur un autre onglet (`isActive={tab==='chat'}`).
 * Le relevé `getWorktreeActivity` tournait donc toutes les 30 s pour une vue invisible : un IPC vers
 * le main — qui énumère des worktrees git — payé pour rien, en concurrence avec l'onglet actif.
 *
 * Entrées qui doivent faire échouer ces tests si la correction est fausse : (a) `isActive={false}`
 * suivi d'un tick de 31 s — aucun appel ne doit être fait ; (b) `isActive` non passé (défaut de la
 * vue = active) — l'appel doit avoir lieu, sinon la correction a simplement éteint le bandeau.
 */
import { act, createElement } from 'react'
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
  vi.useRealTimers()
})

describe('sonde worktree — gouvernée par isActive', () => {
  it('vue INACTIVE : aucun getWorktreeActivity, même après un tick de 31 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const getWorktreeActivity = vi.fn().mockResolvedValue([])
    harnais = await mountChat(chatApi({ getWorktreeActivity }), { isActive: false })
    expect(getWorktreeActivity).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(getWorktreeActivity, 'une vue invisible ne sonde pas les worktrees').not.toHaveBeenCalled()
  })

  it('vue ACTIVE (défaut) : la sonde tourne bien', async () => {
    const getWorktreeActivity = vi.fn().mockResolvedValue([])
    harnais = await mountChat(chatApi({ getWorktreeActivity }))
    expect(getWorktreeActivity).toHaveBeenCalled()
  })
})
