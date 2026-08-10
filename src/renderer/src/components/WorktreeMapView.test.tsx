// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeMapSnapshot } from '../../../shared/worktree-map'
import { WorktreeMapView } from './WorktreeMapView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const snapshot: WorktreeMapSnapshot = {
  available: true,
  repoPath: 'C:\\Amitel\\Autowin OS',
  repositoryName: 'Autowin OS',
  baseBranch: 'main',
  baseHead: '1cdfe64',
  entries: [
    {
      path: 'C:\\Amitel\\Autowin OS',
      head: '1cdfe64',
      branch: 'main',
      detached: false,
      locked: false,
      behind: 0,
      dirtyFiles: 5,
      sizeBytes: 120_000_000
    },
    {
      path: 'C:\\runs\\wt-propre',
      head: '592b289',
      detached: true,
      locked: false,
      behind: 8,
      dirtyFiles: 0,
      sizeBytes: 60_000_000
    },
    {
      // 21 commits d'ecart avec la precedente -> une cassure doit etre declaree.
      path: 'C:\\runs\\wt-vieux',
      head: '6df0705',
      detached: true,
      locked: false,
      behind: 30,
      dirtyFiles: 2,
      sizeBytes: 40_000_000
    },
    {
      // Saleté NON mesurée : ni « avec travail », ni « propre », ni recuperable.
      path: 'C:\\runs\\wt-inconnu',
      head: '6df0705',
      detached: true,
      locked: true,
      behind: 30
    }
  ],
  doctor: {
    status: 'attention',
    findings: [
      {
        code: 'prunable',
        severity: 'warning',
        path: 'C:\\runs\\wt-propre',
        evidence: 'gitdir file points to non-existent location',
        proposals: [
          {
            action: 'prune-preview',
            cwd: 'C:\\Amitel\\Autowin OS',
            argv: ['worktree', 'prune', '--dry-run', '--verbose'],
            reason: 'Cette commande inspecte le dépôt entier.',
            mutates: false,
            automatic: false,
            requiresConfirmation: false
          }
        ]
      }
    ]
  }
}

let container: HTMLDivElement | undefined
let root: Root | undefined
let previousApi: PropertyDescriptor | undefined

interface StubApi {
  getWorktreeMap: ReturnType<typeof vi.fn>
  pickGitRepo: ReturnType<typeof vi.fn>
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function installApi(
  value: WorktreeMapSnapshot = snapshot,
  chosenRepo: string | null = null
): StubApi {
  previousApi = Object.getOwnPropertyDescriptor(window, 'api')
  const api: StubApi = {
    getWorktreeMap: vi.fn().mockResolvedValue(value),
    pickGitRepo: vi.fn().mockResolvedValue(chosenRepo)
  }
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
  return api
}

async function clickTestId(testId: string): Promise<void> {
  const node = container?.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null
  if (!node) throw new Error(`absent: ${testId}`)
  await act(async () => {
    node.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function byRole(role: string): HTMLElement | null {
  return (container?.querySelector(`[role="${role}"]`) as HTMLElement | null) ?? null
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    (Array.from(container?.querySelectorAll('button') ?? []).find((node) =>
      (node.textContent ?? '').includes(text)
    ) as HTMLButtonElement | undefined) ?? null
  )
}

async function renderViewWithoutSettling(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(WorktreeMapView, { active: true }))
  })
}

async function renderView(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(WorktreeMapView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  if (previousApi) Object.defineProperty(window, 'api', previousApi)
  else Reflect.deleteProperty(window, 'api')
  previousApi = undefined
  localStorage.clear()
})

describe('WorktreeMapView — plan de métro des worktrees git', () => {
  it('rend un graphe, jamais une liste ni un tableau', async () => {
    installApi()
    await renderView()

    expect(container?.querySelector('[data-testid="worktree-map"]')).toBeTruthy()
    expect(container?.querySelector('svg.wtmap-plan')).toBeTruthy()
    // L'utilisateur a explicitement rejete les listes : la vue ne doit en produire AUCUNE.
    expect(container?.querySelector('table')).toBeNull()
    expect(container?.querySelector('ul')).toBeNull()
    expect(container?.querySelector('ol')).toBeNull()
  })

  it('rend le docteur read-only et une commande copiable sans bouton d’exécution', async () => {
    installApi()
    await renderView()

    const doctor = container?.querySelector('[data-testid="worktree-doctor"]')
    expect(doctor?.textContent).toContain('1 point à vérifier')
    expect(doctor?.textContent).toContain('gitdir file points to non-existent location')
    expect(doctor?.textContent).toContain('git worktree prune --dry-run --verbose')
    expect(doctor?.querySelector('[data-action="execute"]')).toBeNull()
    expect(doctor?.textContent).toContain('Jamais exécuté automatiquement')
  })

  it('annonce explicitement un diagnostic sain', async () => {
    installApi({ ...snapshot, doctor: { status: 'healthy', findings: [] } })
    await renderView()

    expect(container?.querySelector('[data-testid="worktree-doctor"]')?.textContent).toContain(
      'Docteur : sain'
    )
  })

  it('sépare les territoires : une copie sale au-dessus du tronc, une copie propre en dessous', async () => {
    installApi()
    await renderView()

    const live = container?.querySelectorAll('polyline.wtmap-line.is-live') ?? []
    const closed = container?.querySelectorAll('polyline.wtmap-line.is-closed') ?? []
    // 3 copies sales (5 fich., 2 fich., et la saleté inconnue traitee comme non-vivante) :
    // 2 vivantes exactement, car l'inconnue n'est PAS declaree en travaux.
    expect(live).toHaveLength(2)
    const unknown = container?.querySelectorAll('polyline.wtmap-line.is-unknown') ?? []
    expect(closed).toHaveLength(1)
    expect(unknown).toHaveLength(1)
    expect(container?.textContent).toContain('INCONNU')

    const trunkY = Number(container?.querySelector('line.wtmap-trunk')?.getAttribute('y1'))
    for (const node of live) {
      for (const y of ordinates(node)) expect(y).toBeLessThanOrEqual(trunkY)
    }
    for (const node of closed) {
      for (const y of ordinates(node)) expect(y).toBeGreaterThanOrEqual(trunkY)
    }
  })

  it('déclare les commits sautés par une cassure au lieu de laisser du vide', async () => {
    installApi()
    await renderView()

    const breaks = container?.querySelectorAll('[data-testid="worktree-map-break"]') ?? []
    expect(breaks).toHaveLength(2)
    // 0 -> 8 : 7 commits sautés ; 8 -> 30 : 21 commits sautés.
    expect(container?.textContent).toContain('7 commits sautés')
    expect(container?.textContent).toContain('21 commits sautés')
  })

  it('ne compte pas une saleté non mesurée comme une copie propre récupérable', async () => {
    installApi()
    await renderView()

    const header = container?.querySelector('.wtmap-header')?.textContent ?? ''
    expect(header).toContain('2avec travail')
    expect(header).toContain('1propres')
    expect(header).toContain('1non mesurés')
    // Recuperable = la seule copie propre AVEC certitude (60 Mo), pas 100 Mo.
    expect(header).toContain('60 Morécupérables')
    expect(header).toContain('220 Moau total')
  })

  it('offre la barre de défilement horizontale et une mini-carte de navigation', async () => {
    installApi()
    await renderView()

    expect(container?.querySelector('[data-testid="worktree-map-scroller"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="worktree-map-minimap"]')).toBeTruthy()
    expect(container?.querySelector('.wtmap-mini-viewport')).toBeTruthy()
  })

  it('ouvre le détail d’une copie au clic sur sa station, avec le retard et la saleté réels', async () => {
    installApi()
    await renderView()

    expect(container?.querySelector('[data-testid="worktree-map-detail"]')).toBeNull()
    const station = container?.querySelector('.wtmap-station') as SVGGElement | null
    if (!station) throw new Error('aucune station rendue')
    await act(async () => {
      station.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    const detail = container?.querySelector('[data-testid="worktree-map-detail"]')
    expect(detail).toBeTruthy()
    expect(detail?.textContent).toContain('à jour')
    expect(detail?.textContent).toContain('5 fichiers non commités')
  })

  /**
   * LA MOLETTE DOIT PARCOURIR LE PLAN, PAS LE TRAVERSER.
   *
   * Le plan de métro ne défile QUE latéralement : sa zone n'a aucune hauteur à parcourir. Une molette
   * verticale n'y produisait donc rien du tout — l'utilisateur tournait dans le vide devant une carte
   * qui s'étend sur des milliers de pixels à droite.
   */
  it('la molette verticale fait défiler le plan LATÉRALEMENT', async () => {
    installApi()
    await renderView()

    const scroller = container?.querySelector(
      '[data-testid="worktree-map-scroller"]'
    ) as HTMLDivElement | null
    if (!scroller) throw new Error('aucun scroller rendu')
    // happy-dom ne calcule pas de mise en page : on déclare une largeur défilable, sinon le navigateur
    // simulé bornerait `scrollLeft` à 0 et le test passerait pour la mauvaise raison.
    Object.defineProperty(scroller, 'scrollWidth', { value: 4000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 800, configurable: true })
    scroller.scrollLeft = 0

    await act(async () => {
      scroller.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true })
      )
      await Promise.resolve()
    })

    expect(scroller.scrollLeft).toBeGreaterThan(0)
  })

  it('une molette HORIZONTALE reste au navigateur — discriminant', async () => {
    installApi()
    await renderView()

    const scroller = container?.querySelector(
      '[data-testid="worktree-map-scroller"]'
    ) as HTMLDivElement | null
    if (!scroller) throw new Error('aucun scroller rendu')
    Object.defineProperty(scroller, 'scrollWidth', { value: 4000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 800, configurable: true })
    scroller.scrollLeft = 100

    await act(async () => {
      // Trackpad : le navigateur gère déjà cet axe. Y ajouter notre conversion doublerait la distance.
      scroller.dispatchEvent(
        new WheelEvent('wheel', { deltaX: 50, deltaY: 0, bubbles: true, cancelable: true })
      )
      await Promise.resolve()
    })

    expect(scroller.scrollLeft).toBe(100)
  })

  it('dit qu’une grandeur n’a pas été mesurée au lieu d’afficher un zéro', async () => {
    installApi()
    await renderView()

    const stations = Array.from(container?.querySelectorAll('.wtmap-station') ?? [])
    const unknown = stations.find((node) => node.getAttribute('aria-label')?.includes('wt-inconnu'))
    if (!unknown) throw new Error('station de la copie non mesurée absente')
    await act(async () => {
      unknown.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    const detail =
      container?.querySelector('[data-testid="worktree-map-detail"]')?.textContent ?? ''
    expect(detail).toContain('non mesuré')
    expect(detail).toContain('non mesurée')
    expect(detail).toContain('verrouillé')
  })

  it('laisse choisir un dépôt, le relit aussitôt et le retient pour l’app', async () => {
    const api = installApi(snapshot, 'D:\\autre\\depot')
    await renderView()
    expect(api.getWorktreeMap).toHaveBeenLastCalledWith(undefined)

    await clickTestId('worktree-map-pick')

    expect(api.pickGitRepo).toHaveBeenCalledTimes(1)
    // Choisir doit RELIRE : sans ça le bouton ne fait visiblement rien.
    expect(api.getWorktreeMap).toHaveBeenLastCalledWith('D:\\autre\\depot')
    // Même clé que Source control : le dépôt choisi vaut pour l'app, pas pour cette vue seule.
    expect(localStorage.getItem('autowin:sc-repo')).toBe('D:\\autre\\depot')
  })

  it('ignore la réponse obsolète de l’ancien dépôt après une nouvelle sélection', async () => {
    const oldRead = deferred<WorktreeMapSnapshot>()
    const newRead = deferred<WorktreeMapSnapshot>()
    const api = installApi(snapshot, 'D:\\nouveau')
    api.getWorktreeMap.mockReset()
    api.getWorktreeMap.mockImplementation((repo?: string) =>
      repo === 'D:\\nouveau' ? newRead.promise : oldRead.promise
    )
    await renderView()

    await clickTestId('worktree-map-pick')
    await act(async () => {
      newRead.resolve({ ...snapshot, repoPath: 'D:\\nouveau', repositoryName: 'Nouveau' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container?.querySelector('.module-header h1')?.textContent).toBe('Nouveau')

    await act(async () => {
      oldRead.resolve({ ...snapshot, repoPath: 'C:\\ancien', repositoryName: 'Ancien' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container?.querySelector('.module-header h1')?.textContent).toBe('Nouveau')
  })

  it('n’oublie pas le dépôt choisi précédemment au montage', async () => {
    localStorage.setItem('autowin:sc-repo', 'D:\\memorise')
    const api = installApi()
    await renderView()
    expect(api.getWorktreeMap).toHaveBeenCalledWith('D:\\memorise')
  })

  it('ne change pas de dépôt quand la sélection est annulée', async () => {
    const api = installApi(snapshot, null)
    await renderView()
    await clickTestId('worktree-map-pick')
    expect(api.getWorktreeMap).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('autowin:sc-repo')).toBeNull()
  })

  it('dit que le pont est indisponible au lieu de rejeter une promesse non capturée', async () => {
    previousApi = Object.getOwnPropertyDescriptor(window, 'api')
    Object.defineProperty(window, 'api', { value: {}, configurable: true, writable: true })
    await renderView()
    expect(container?.querySelector('[data-testid="worktree-map-error"]')?.textContent).toContain(
      'Bridge Git indisponible'
    )
  })

  it('annonce l’échec de lecture git au lieu de rester muette', async () => {
    installApi({ available: false, repoPath: 'C:\\x', entries: [], error: 'git absent du PATH' })
    await renderView()

    const notice = container?.querySelector('[data-testid="worktree-map-error"]')
    expect(notice?.textContent).toContain('git absent du PATH')
    expect(container?.querySelector('svg.wtmap-plan')).toBeNull()
  })
})

describe('WorktreeMapView — états de chargement et d’erreur', () => {
  it('affiche un indicateur de chargement lisible tant que le snapshot n’est pas arrivé', async () => {
    const pending = deferred<WorktreeMapSnapshot>()
    const api = installApi()
    api.getWorktreeMap.mockReset()
    api.getWorktreeMap.mockImplementation(() => pending.promise)

    await renderViewWithoutSettling()

    const status = byRole('status')
    expect(status).toBeTruthy()
    expect(status?.textContent).toContain('Lecture des worktrees')

    await act(async () => {
      pending.resolve(snapshot)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container?.querySelector('[data-testid="worktree-map-loading"]')).toBeNull()
    expect(container?.querySelector('svg.wtmap-plan')).toBeTruthy()
  })

  it('offre un bandeau d’erreur actionnable quand le snapshot est indisponible', async () => {
    installApi({
      available: false,
      repoPath: 'C:\\x',
      entries: [],
      error: 'fatal: not a git repository'
    })
    await renderView()

    const banner = container?.querySelector('[data-testid="worktree-map-error"]')
    expect(banner).toBeTruthy()
    expect(banner?.getAttribute('role')).toBe('alert')
    // Message humain, pas seulement la sortie git brute.
    expect(banner?.textContent).toContain('dépôt git')
    // La sortie git reste visible en détail secondaire.
    expect(banner?.textContent).toContain('fatal: not a git repository')
    expect(container?.querySelector('[data-testid="worktree-map-retry"]')).toBeTruthy()
    expect(container?.querySelector('[data-testid="worktree-map-error-pick"]')).toBeTruthy()
    expect(buttonByText('Réessayer')).toBeTruthy()
    expect(buttonByText('Choisir un dépôt')).toBeTruthy()
  })

  it('explique un pont IPC absent en clair', async () => {
    previousApi = Object.getOwnPropertyDescriptor(window, 'api')
    Object.defineProperty(window, 'api', { value: {}, configurable: true, writable: true })
    await renderView()

    const banner = container?.querySelector('[data-testid="worktree-map-error"]')
    expect(banner?.textContent).toContain('pont interne')
    expect(banner?.textContent).toContain('Bridge Git indisponible')
  })

  it('explique un git introuvable en clair', async () => {
    installApi({
      available: false,
      repoPath: 'C:\\x',
      entries: [],
      error: 'spawn git ENOENT'
    })
    await renderView()

    expect(container?.querySelector('[data-testid="worktree-map-error"]')?.textContent).toContain(
      'Git est introuvable'
    )
  })

  it('relance la lecture au clic sur « Réessayer »', async () => {
    const api = installApi({ available: false, repoPath: 'C:\\x', entries: [], error: 'boum' })
    await renderView()
    expect(api.getWorktreeMap).toHaveBeenCalledTimes(1)

    await clickTestId('worktree-map-retry')

    expect(api.getWorktreeMap).toHaveBeenCalledTimes(2)
  })
})

function ordinates(node: Element): number[] {
  return (node.getAttribute('points') ?? '')
    .trim()
    .split(/\s+/)
    .map((pair) => Number(pair.split(',')[1]))
}
