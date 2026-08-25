// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BureauxConserves } from './BureauxConserves'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LES BUREAUX CONSERVÉS DOIVENT AVOIR UNE PRISE.
 *
 * DÉFAUT MESURÉ le 2026-08-25 : 16 bureaux agents enregistrés, 527 Mo, jamais nettoyés — dont 10
 * portant la MÊME édition non compilable, et un portant des tests neufs jamais publiés. Le
 * mécanisme de secours faisait son travail (bureau conservé, ref posée, rien perdu) mais PERSONNE
 * ne pouvait rien en faire : `WorktreeView` n'exposait que « choisir un dépôt » et « rafraîchir ».
 *
 * PIRE : deux messages de refus déjà poussés (`f80cc4e9`) disaient « Reprends-le depuis le panneau
 * Worktrees » et « bouton de nettoyage ». Ces gestes n'existaient pas. Un message qui oriente vers
 * l'impossible coûte plus cher qu'un refus nu — il fait perdre du temps avant de laisser au même mur.
 *
 * LES ACTIONS, ELLES, EXISTAIENT DÉJÀ côté IPC (`discardHeldWorktree`, `retryWorktreeRecovery`,
 * `getPatchTravailNonPublie`) — seulement câblées dans le panneau bench, jamais ici. Ce composant
 * ne crée aucune capacité : il branche l'existante là où le message l'annonce.
 */
let container: HTMLDivElement
let root: Root

type ApiDouble = {
  getTravauxNonPublies: ReturnType<typeof vi.fn>
  getPatchTravailNonPublie: ReturnType<typeof vi.fn>
  retryWorktreeRecovery: ReturnType<typeof vi.fn>
  discardHeldWorktree: ReturnType<typeof vi.fn>
}

function poserApi(surcharge: Partial<ApiDouble> = {}): ApiDouble {
  const api: ApiDouble = {
    getTravauxNonPublies: vi.fn().mockResolvedValue([
      { agentId: 'run-thinking-1', date: '2026-08-24', fichiers: ['a.ts', 'b.test.ts'] },
      { agentId: 'command-edit-casse', date: '2026-08-25', fichiers: ['WorkflowsPanel.tsx'] }
    ]),
    getPatchTravailNonPublie: vi.fn().mockResolvedValue({ patch: 'diff --git a b', tronque: false }),
    retryWorktreeRecovery: vi.fn().mockResolvedValue({ agentId: 'run-thinking-1' }),
    discardHeldWorktree: vi.fn().mockResolvedValue(true),
    ...surcharge
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

async function rendre(): Promise<void> {
  await act(async () => {
    root.render(createElement(BureauxConserves))
  })
}

const boutons = (): HTMLButtonElement[] =>
  [...container.querySelectorAll('button')] as HTMLButtonElement[]

const boutonNomme = (motif: RegExp): HTMLButtonElement | undefined =>
  boutons().find((b) => motif.test(b.textContent ?? ''))

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.restoreAllMocks()
})

describe('BureauxConserves — la prise qui manquait', () => {
  it('liste les bureaux conservés avec ce qu’ils contiennent', async () => {
    poserApi()
    await rendre()

    expect(container.textContent).toContain('run-thinking-1')
    expect(container.textContent).toContain('command-edit-casse')
    // Le nombre de fichiers est ce qui permet de deviner s'il y a du travail dedans AVANT d'ouvrir.
    expect(container.textContent).toMatch(/2 fichiers/)
  })

  it('offre les trois gestes que les messages de refus promettent', async () => {
    poserApi()
    await rendre()

    expect(boutonNomme(/voir le diff/i)).toBeTruthy()
    expect(boutonNomme(/reprendre/i)).toBeTruthy()
    expect(boutonNomme(/purger/i)).toBeTruthy()
  })

  it('« reprendre » appelle la reprise DÉJÀ existante, sans en inventer une autre', async () => {
    const api = poserApi()
    await rendre()

    await act(async () => {
      boutonNomme(/reprendre/i)?.click()
    })

    expect(api.retryWorktreeRecovery).toHaveBeenCalledWith('run-thinking-1')
  })

  it('« purger » EXIGE une confirmation — jamais de suppression sur un simple clic', async () => {
    const api = poserApi()
    const confirmer = vi.fn().mockReturnValue(false)
    ;(globalThis as unknown as { window: { confirm: unknown } }).window.confirm = confirmer
    await rendre()

    await act(async () => {
      boutonNomme(/purger/i)?.click()
    })

    expect(confirmer).toHaveBeenCalled()
    // Contrainte HARD du cadrage : aucune suppression de travail non trié. Un refus de confirmation
    // ne doit RIEN supprimer.
    expect(api.discardHeldWorktree).not.toHaveBeenCalled()
  })

  it('confirmation donnée : purge le bureau nommé, et lui seul', async () => {
    const api = poserApi()
    ;(globalThis as unknown as { window: { confirm: unknown } }).window.confirm = vi
      .fn()
      .mockReturnValue(true)
    await rendre()

    await act(async () => {
      boutonNomme(/purger/i)?.click()
    })

    expect(api.discardHeldWorktree).toHaveBeenCalledTimes(1)
    expect(api.discardHeldWorktree).toHaveBeenCalledWith('run-thinking-1')
  })

  it('aucun bureau conservé : le dit, plutôt que d’afficher une section vide', async () => {
    poserApi({ getTravauxNonPublies: vi.fn().mockResolvedValue([]) })
    await rendre()

    expect(container.textContent).toMatch(/aucun bureau conservé/i)
  })
})
