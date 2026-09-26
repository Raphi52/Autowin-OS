// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskManagerView } from './TaskManagerView'
import { resolveAppLocation } from '../../../shared/navigation'

/**
 * WATCHDOG ET PLANIFICATION SONT DEUX MÉTIERS, DONC DEUX ONGLETS.
 *
 * Ils cohabitaient dans une seule vue : la surveillance des agents (alertes, occurrences ratées) et
 * l'édition des tâches planifiées s'empilaient sur le même écran, alors qu'on n'y vient pas pour la
 * même raison. Le découpage suit le motif DÉJÀ présent dans le dépôt (`AgentStudioView` avec
 * `topology | routing | workflows`) plutôt que d'en inventer un autre : même `nav.domain-tabs`, même
 * contrat `section` + `onSectionChange`.
 *
 * Le point délicat que ce découpage devait préserver : cliquer une alerte du watchdog ouvrait le
 * DÉTAIL de la tâche, qui vit côté planification. Séparer les écrans sans traiter ce lien aurait cassé
 * le geste le plus utile de la vue — d'où le test qui l'épingle explicitement.
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
})

function api() {
  return {
    taskManagerSnapshot: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      tasks: [
        {
          id: 'task-1',
          title: 'Rapport du matin',
          prompt: 'Prépare le rapport.',
          enabled: true,
          mode: 'windows',
          destination: { kind: 'existing', conversationId: 'conv-1' },
          schedule: {
            startDate: '2026-08-03',
            time: '09:30',
            timeZone: 'Europe/Paris',
            recurrence: { unit: 'day', interval: 1 }
          }
        }
      ],
      occurrences: [
        {
          id: 'task-1@1',
          taskId: 'task-1',
          scheduledFor: 1,
          status: 'missed',
          mode: 'active-only',
          claimedAt: 1,
          finishedAt: 1,
          error: 'Autowin était arrêté.'
        }
      ],
      alerts: [
        {
          id: 'alert-1',
          taskId: 'task-1',
          occurrenceId: 'task-1@1',
          kind: 'missed',
          message: 'Autowin était arrêté.',
          createdAt: 1
        }
      ],
      scheduler: { running: true, nextWakeAt: null, relayAvailable: true }
    }),
    conversations: vi
      .fn()
      .mockResolvedValue([
        { id: 'conv-1', title: 'Projet RIG', category: 'codex', provider: 'codex' }
      ]),
    models: vi.fn().mockResolvedValue([]),
    providerStatus: vi.fn().mockResolvedValue([]),
    roles: vi.fn().mockResolvedValue({ orchestrator: { provider: 'codex', model: 'gpt' } }),
    taskManagerCreate: vi.fn().mockResolvedValue({ id: 'task-2' }),
    taskManagerUpdate: vi.fn().mockResolvedValue({ id: 'task-1' }),
    taskManagerRemove: vi.fn().mockResolvedValue(true),
    taskManagerRunNow: vi.fn().mockResolvedValue({ started: true }),
    taskManagerAcknowledge: vi.fn().mockResolvedValue(true),
    onAppEvent: vi.fn(
      (_listener: (event: { type: string; scope?: string }) => void) => () => undefined
    )
  }
}

async function monter(props: Record<string, unknown> = {}) {
  const mockApi = api()
  Object.defineProperty(window, 'api', { value: mockApi, configurable: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(TaskManagerView, { active: true, ...props })))
  return { container, mockApi, root }
}

const boutonSection = (container: HTMLElement, libelle: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll<HTMLButtonElement>('.domain-tabs button')].find(
    (bouton) => bouton.textContent?.trim() === libelle
  )

describe('TaskManagerView — deux onglets, deux métiers', () => {
  it('expose un sélecteur de section avec Watchdog et Planification', async () => {
    const { container } = await monter()
    const onglets = [...container.querySelectorAll('.domain-tabs button')].map((b) =>
      b.textContent?.trim()
    )
    expect(onglets).toContain('Watchdog')
    expect(onglets).toContain('Planification')
  })

  it('sur Watchdog : la surveillance est visible, la liste planifiée ne l est PAS', async () => {
    const { container } = await monter({ section: 'watchdog' })
    expect(container.querySelector('[data-testid="watchdog-agents-section"]')).not.toBeNull()
    expect(container.querySelector('.task-manager-list')).toBeNull()
  })

  it('sur Planification : la liste est visible, la surveillance ne l est PAS', async () => {
    const { container } = await monter({ section: 'planification' })
    expect(container.querySelector('.task-manager-list')).not.toBeNull()
    expect(container.querySelector('[data-testid="watchdog-agents-section"]')).toBeNull()
  })

  it('par DÉFAUT, l onglet ouvre sur la Planification — le contenu historique', async () => {
    // Ajouter un écran ne doit pas déplacer celui qu'on connaît : ouvrir Task Manager continue de
    // montrer les tâches planifiées, comme avant le découpage.
    const { container } = await monter()
    expect(container.querySelector('.task-manager-list')).not.toBeNull()
    expect(container.querySelector('[data-testid="watchdog-agents-section"]')).toBeNull()
  })

  it('le sélecteur BASCULE réellement de section (vue non pilotée)', async () => {
    const { container } = await monter()
    const watchdog = boutonSection(container, 'Watchdog')
    expect(watchdog).toBeDefined()
    await act(async () => watchdog!.click())
    expect(container.querySelector('[data-testid="watchdog-agents-section"]')).not.toBeNull()
    expect(container.querySelector('.task-manager-list')).toBeNull()
  })

  it('PILOTÉE, la vue obéit à la prop et ne bascule pas seule', async () => {
    // Contrôlée par l'app (deep-link), la section vient de l'extérieur : cliquer REMONTE l'intention
    // sans changer l'affichage de son propre chef — sinon l'état de l'app et l'écran divergeraient.
    const onSectionChange = vi.fn()
    const { container } = await monter({ section: 'watchdog', onSectionChange })
    await act(async () => boutonSection(container, 'Planification')!.click())
    expect(onSectionChange).toHaveBeenCalledWith('planification')
    expect(container.querySelector('[data-testid="watchdog-agents-section"]')).not.toBeNull()
  })

  it('marque la section active pour un lecteur d écran, pas seulement en CSS', async () => {
    const { container } = await monter({ section: 'planification' })
    expect(boutonSection(container, 'Planification')?.getAttribute('aria-pressed')).toBe('true')
    expect(boutonSection(container, 'Watchdog')?.getAttribute('aria-pressed')).toBe('false')
  })

  async function monterAvecRegle(props: Record<string, unknown> = {}) {
    const mockApi = api()
    const snapshot = await mockApi.taskManagerSnapshot()
    snapshot.tasks.push({
      ...snapshot.tasks[0],
      id: 'task-w',
      title: 'Assistant mails',
      schedule: undefined,
      watchdog: {
        source: { kind: 'file-match', path: 'C:/logs/app.log', pattern: 'ERROR' },
        guards: { dedupWindowMs: 60_000, maxTriggersPerHour: 12, maxChainDepth: 0, maxPerRoot: 20 }
      }
    } as (typeof snapshot.tasks)[number])
    mockApi.taskManagerSnapshot.mockResolvedValue(snapshot)
    Object.defineProperty(window, 'api', { value: mockApi, configurable: true })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    await act(async () => root.render(createElement(TaskManagerView, { active: true, ...props })))
    return { container, mockApi }
  }

  it("une règle watchdog n'apparaît pas dans la liste de Planification", async () => {
    const { container } = await monterAvecRegle({ section: 'planification' })
    const liste = container.querySelector('.task-manager-list')?.textContent ?? ''
    expect(liste).toContain('Rapport du matin')
    expect(liste).not.toContain('Assistant mails')
  })

  it("cliquer une carte ouvre le détail (avec Supprimer) DANS l'onglet Watchdog", async () => {
    const onSectionChange = vi.fn()
    const { container } = await monterAvecRegle({ section: 'watchdog', onSectionChange })
    const cible = container.querySelector<HTMLElement>(
      '[data-testid="watchdog-agents-section"] .watchdog-rule-main'
    )
    expect(cible).not.toBeNull()
    await act(async () => cible!.click())
    expect(onSectionChange).not.toHaveBeenCalled()
    const detail = container.querySelector('[data-testid="task-manager-watchdog-detail"]')
    expect(detail?.textContent).toContain('Assistant mails')
    const supprimer = [...(detail?.querySelectorAll('button') ?? [])].some((b) =>
      b.textContent?.includes('Supprimer')
    )
    expect(supprimer).toBe(true)
  })

  it("« Paramétrer » ouvre l'éditeur en restant dans l'onglet Watchdog", async () => {
    const onSectionChange = vi.fn()
    const { container } = await monterAvecRegle({ section: 'watchdog', onSectionChange })
    const bouton = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="watchdog-agents-section"] button')
    ].find((b) => b.textContent?.includes('Paramétrer'))
    expect(bouton).toBeDefined()
    await act(async () => bouton!.click())
    expect(onSectionChange).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="task-manager-watchdog-detail"] .task-manager-editor')
    ).not.toBeNull()
    expect(boutonSection(container, 'Watchdog')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('« + Règle de réveil » ouvre un brouillon déjà réglé sur « Sur événement »', async () => {
    const { container } = await monterAvecRegle({ section: 'watchdog' })
    const bouton = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="watchdog-agents-section"] button')
    ].find((b) => b.textContent?.includes('Règle de réveil'))
    expect(bouton).toBeDefined()
    await act(async () => bouton!.click())
    const editeur = container.querySelector('[data-testid="task-manager-watchdog-detail"] .task-manager-editor')
    expect(editeur).not.toBeNull()
    const declencheur = [...editeur!.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'watchdog')
    )
    expect(declencheur?.value).toBe('watchdog')
  })

  it("changer d'onglet ferme l'éditeur ouvert", async () => {
    const { container } = await monterAvecRegle()
    await act(async () => boutonSection(container, 'Watchdog')!.click())
    const bouton = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="watchdog-agents-section"] button')
    ].find((b) => b.textContent?.includes('Paramétrer'))
    await act(async () => bouton!.click())
    expect(container.querySelector('.task-manager-editor')).not.toBeNull()
    await act(async () => boutonSection(container, 'Planification')!.click())
    expect(container.querySelector('.task-manager-editor')).toBeNull()
  })

  it('un agent peut naviguer directement vers le watchdog par son nom', () => {
    // Les agents pilotent l'app par des noms de destination ; « watchdog » doit atterrir sur la bonne
    // section, sinon la séparation n'est atteignable qu'à la souris.
    expect(resolveAppLocation('watchdog')).toEqual({
      destination: 'task-manager',
      section: 'watchdog'
    })
    expect(resolveAppLocation('planification')).toEqual({
      destination: 'task-manager',
      section: 'planification'
    })
  })
})
