// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorktreeMapView } from './WorktreeMapView'
import { summarizeWorktreeMap } from '../../../shared/worktree-map'

/**
 * RESTAURATION DE LA BARRE D'ÉTAT GIT (`project-strip`), et réparation de ce qui l'avait remplacée.
 *
 * Elle vivait dans `WorktreeView.tsx` et disait l'état du DÉPÔT en cinq cellules : santé, branche,
 * changements locaux, travaux actifs, alertes. Le commit `4af73b5` (2026-08-06) a remplacé la vue
 * entière par `WorktreeMapView` — remplacement délibéré et défendable (« la vue dit enfin l'état de
 * git, et non l'activité des agents ») — mais la barre est partie avec, et les compteurs qui l'ont
 * remplacée ne disent plus la branche ni les changements locaux.
 *
 * ET ILS MENTENT. `summarizeWorktreeMap` fait `totalBytes += entry.sizeBytes ?? 0` : quand AUCUNE
 * taille n'est mesurée — ce qui est le cas courant, l'IPC n'activant pas la mesure — l'en-tête affiche
 * « 0 o au total » et « 0 o récupérables » comme s'ils avaient été mesurés. Le modèle de données est
 * pourtant honnête (`sizeBytes?: number`, `undefined` = non mesuré) : c'est l'agrégat qui écrase la
 * distinction, et la barre qui la présente comme un fait.
 *
 * Les deux vont ensemble : restaurer une barre d'état sans réparer ses chiffres, ce serait remettre en
 * place un tableau de bord qui affirme ce qu'il ne sait pas.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  localStorage.clear()
})

const entree = (patch: Record<string, unknown> = {}) => ({
  path: 'C:/depot',
  head: 'abc1234',
  branch: 'main',
  detached: false,
  locked: false,
  ...patch
})

async function monter(snapshot: Record<string, unknown>) {
  const mockApi = {
    getWorktreeMap: vi.fn().mockResolvedValue(snapshot),
    pickGitRepo: vi.fn(),
    onAppEvent: vi.fn(() => () => undefined)
  }
  Object.defineProperty(window, 'api', { value: mockApi, configurable: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(WorktreeMapView, { active: true })))
  return { container, mockApi }
}

describe('summarizeWorktreeMap — ne confond plus « non mesuré » et « zéro »', () => {
  it('compte les tailles RÉELLEMENT mesurées', () => {
    const totals = summarizeWorktreeMap([
      entree({ sizeBytes: 1000, dirtyFiles: 0 }),
      entree({ path: 'C:/b' })
    ])
    expect(totals.measuredSizes).toBe(1)
  })

  it('aucune taille mesurée → measuredSizes = 0, même si totalBytes vaut 0', () => {
    const totals = summarizeWorktreeMap([entree(), entree({ path: 'C:/b' })])
    expect(totals.measuredSizes).toBe(0)
    expect(totals.totalBytes).toBe(0)
  })
})

describe('WorktreeMapView — la barre d état git est de retour', () => {
  const snapshotDeBase = {
    available: true,
    repoPath: 'C:/depot',
    repositoryName: 'autowin-os',
    baseBranch: 'main',
    baseHead: 'abc1234',
    entries: [entree({ dirtyFiles: 3, sizeBytes: 2048 })]
  }

  it('affiche la barre avec ses cinq cellules', async () => {
    const { container } = await monter(snapshotDeBase)
    const barre = container.querySelector('.project-strip')
    expect(barre).not.toBeNull()
    const intitules = [...barre!.querySelectorAll('span')].map((s) => s.textContent?.trim())
    expect(intitules).toContain('Branche')
    expect(intitules).toContain('Changements locaux')
    expect(intitules).toContain('Santé du projet')
    expect(intitules).toContain('Travaux actifs')
    expect(intitules).toContain('Alertes')
  })

  it('dit la BRANCHE du dépôt, ce que les compteurs ne disaient plus', async () => {
    const { container } = await monter(snapshotDeBase)
    expect(container.querySelector('.project-strip')?.textContent).toContain('main')
  })

  it('dit le nombre de changements locaux quand il est MESURÉ', async () => {
    const { container } = await monter(snapshotDeBase)
    expect(container.querySelector('.project-strip')?.textContent).toContain('3')
  })

  it('dit « non mesuré » plutôt qu un zéro quand la saleté n est pas mesurée', async () => {
    const { container } = await monter({ ...snapshotDeBase, entries: [entree()] })
    const texte = container.querySelector('.project-strip')?.textContent ?? ''
    expect(texte).toMatch(/non mesur/i)
  })

  it('LE MENSONGE CORRIGÉ : sans mesure de taille, l en-tête n affiche PAS « 0 o »', async () => {
    const { container } = await monter({ ...snapshotDeBase, entries: [entree({ dirtyFiles: 0 })] })
    const stats = container.querySelector('.wtmap-stats')?.textContent ?? ''
    expect(stats).not.toMatch(/\b0\s*o\b/)
    expect(stats).toMatch(/non mesur/i)
  })

  it('affiche la taille RÉELLE dès qu elle est mesurée', async () => {
    const { container } = await monter({
      ...snapshotDeBase,
      entries: [entree({ dirtyFiles: 0, sizeBytes: 2048 })]
    })
    // Le formateur de l'app rend « 2 Ko » pour 2048 octets — on s'aligne sur SON contrat, pas sur une
    // unité supposée. Ce qui compte : un chiffre réel apparaît, et « non mesuré » disparaît.
    const stats = container.querySelector('.wtmap-stats')?.textContent ?? ''
    expect(stats).toMatch(/2\s*Ko/)
    expect(stats).not.toMatch(/non mesur/i)
  })

  it('git indisponible : la barre le DIT au lieu d afficher des zéros', async () => {
    const { container } = await monter({
      available: false,
      repoPath: 'C:/depot',
      entries: [],
      error: 'not a git repository'
    })
    const barre = container.querySelector('.project-strip')
    expect(barre).not.toBeNull()
    expect(barre?.className).toContain('is-unavailable')
  })
})
