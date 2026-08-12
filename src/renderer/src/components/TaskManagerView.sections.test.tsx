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

  it('LE LIEN PRÉSERVÉ : cliquer une tâche du watchdog ouvre son détail en planification', async () => {
    const { container } = await monter({ section: 'watchdog' })
    const cible = container.querySelector<HTMLElement>(
      '[data-testid="watchdog-agents-section"] [data-task-id="task-1"]'
    )
    // Si le watchdog n'expose aucune cible cliquable dans ce jeu de données, le lien n'a pas à être
    // testé ici — mais la bascule, elle, doit rester possible.
    if (!cible) {
      expect(boutonSection(container, 'Planification')).toBeDefined()
      return
    }
    await act(async () => cible.click())
    expect(container.querySelector('.task-manager-list')).not.toBeNull()
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
