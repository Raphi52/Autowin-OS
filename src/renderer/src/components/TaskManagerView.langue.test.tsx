// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TaskManagerView } from './TaskManagerView'
import { WatchdogRuleFields } from './WatchdogRuleFields'
import { DEFAULT_DRAFT_GUARDS, type WatchdogRule } from './watchdog-section-model'
import { appliquerLangue } from '../langue'

/**
 * L'ÉCRAN TASK MANAGER SUIT LA LANGUE (traduction anglaise, conv-1170, lot « Task Manager »).
 * Entrée qui doit faire échouer ce test : un libellé de la planification, de la surveillance ou du
 * formulaire de règle laissé en dur, une date encore formatée en `fr-FR`, ou un écran qui ne se
 * redessine pas quand la langue change. Le retour au français prouve que le français n'a pas bougé.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const montes: Array<{ root: Root; hote: HTMLDivElement }> = []

afterEach(async () => {
  for (const { root, hote } of montes.splice(0)) {
    await act(async () => root.unmount())
    hote.remove()
  }
  appliquerLangue('fr')
})

function api(): Record<string, unknown> {
  return {
    taskManagerSnapshot: vi.fn().mockResolvedValue({
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
          },
          nextRunAt: null,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'regle-1',
          title: 'Surveille le log',
          prompt: 'Trie l’erreur.',
          enabled: true,
          mode: 'active-only',
          destination: { kind: 'existing', conversationId: 'conv-1' },
          watchdog: {
            source: { kind: 'file-match', path: 'C:/logs/app.log', pattern: 'ERROR' },
            guards: { ...DEFAULT_DRAFT_GUARDS }
          },
          nextRunAt: null,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      occurrences: [],
      alerts: [
        {
          id: 'alerte-1',
          taskId: 'task-1',
          occurrenceId: 'task-1@1',
          kind: 'missed',
          message: 'Autowin était arrêté.',
          createdAt: Date.UTC(2026, 0, 15, 12, 0)
        }
      ],
      scheduler: { running: true, nextWakeAt: null, relayAvailable: true }
    }),
    conversations: vi
      .fn()
      .mockResolvedValue([{ id: 'conv-1', title: 'Projet', category: 'codex', provider: 'codex' }]),
    models: vi.fn().mockResolvedValue([]),
    onAppEvent: vi.fn(() => () => undefined)
  }
}

async function monterVue(section: 'planification' | 'watchdog'): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', { value: api(), configurable: true })
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const root = createRoot(hote)
  montes.push({ root, hote })
  await act(async () => root.render(createElement(TaskManagerView, { active: true, section })))
  await act(async () => {})
  return hote
}

async function monterRegle(regle: WatchdogRule): Promise<HTMLDivElement> {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const root = createRoot(hote)
  montes.push({ root, hote })
  await act(async () =>
    root.render(createElement(WatchdogRuleFields, { rule: regle, onChange: () => {} }))
  )
  return hote
}

describe('Task Manager — langue', () => {
  it('la planification bascule en anglais, dates comprises, puis revient au français', async () => {
    const vue = await monterVue('planification')
    const texte = (): string => vue.textContent ?? ''
    expect(texte()).toContain('+ Nouvelle tâche')
    expect(texte()).toContain('Chaque jour')
    expect(texte()).toContain('Échéance manquée')
    expect(texte()).toContain('15 janv. 2026')

    await act(async () => appliquerLangue('en'))
    expect(texte()).toContain('+ New task')
    expect(texte()).toContain('Scheduling')
    expect(texte()).toContain('Run now')
    expect(texte()).toContain('Every day')
    expect(texte()).toContain('Missed due time')
    expect(texte()).toContain('Acknowledge')
    expect(texte()).toContain('No due time')
    expect(texte()).toContain('Jan 15, 2026')
    expect(texte()).not.toContain('Lancer maintenant')
    expect(texte()).not.toContain('Prochaine échéance')

    await act(async () => appliquerLangue('fr'))
    expect(texte()).toContain('Lancer maintenant')
    expect(texte()).toContain('Prochaine échéance')
    expect(texte()).toContain('15 janv. 2026')
  })

  it('la surveillance (Watchdog Agents) bascule en anglais, puis revient au français', async () => {
    const vue = await monterVue('watchdog')
    const section = (): string =>
      vue.querySelector('[data-testid="watchdog-agents-section"]')?.textContent ?? ''
    expect(section()).toContain('Quand une ligne de C:/logs/app.log correspond à « ERROR »')

    await act(async () => appliquerLangue('en'))
    expect(section()).toContain('+ Wake-up rule')
    expect(section()).toContain('Configure')
    expect(section()).toContain('When a line of C:/logs/app.log matches “ERROR”')
    expect(section()).toContain('12 wake-ups/h max')
    expect(section()).toContain('a wake-up cannot trigger another one')
    expect(section()).toContain('armed')

    await act(async () => appliquerLangue('fr'))
    expect(section()).toContain('+ Règle de réveil')
    expect(section()).toContain('12 réveils/h max')
  })

  it('le formulaire d’une règle bascule en anglais, puis revient au français', async () => {
    const formulaire = await monterRegle({
      source: { kind: 'app-event', events: [] },
      guards: { ...DEFAULT_DRAFT_GUARDS }
    })
    const texte = (): string => formulaire.textContent ?? ''
    expect(texte()).toContain('Ce qui réveille l’agent')

    await act(async () => appliquerLangue('en'))
    expect(texte()).toContain('What wakes the agent')
    expect(texte()).toContain('Watched events')
    expect(texte()).toContain('A scheduled task fails')
    expect(texte()).toContain('No event ticked: this rule will never fire.')
    expect(texte()).toContain('Restore the recommended limits')
    expect(texte()).toContain('Can a wake-up trigger another one?')

    await act(async () => appliquerLangue('fr'))
    expect(texte()).toContain('Ce qui réveille l’agent')
    expect(texte()).toContain('Rétablir les bornes conseillées')
  })
})
