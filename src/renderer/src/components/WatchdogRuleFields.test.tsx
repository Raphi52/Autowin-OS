// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WatchdogRuleFields } from './WatchdogRuleFields'
import { DEFAULT_DRAFT_GUARDS, type WatchdogRule } from './watchdog-section-model'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let current: WatchdogRule

const fileRule: WatchdogRule = {
  source: { kind: 'file-match', path: 'C:/logs/app.log', pattern: 'ERROR' },
  guards: { ...DEFAULT_DRAFT_GUARDS }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  current = structuredClone(fileRule)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(rule: WatchdogRule = current): void {
  act(() =>
    root.render(
      <WatchdogRuleFields
        rule={rule}
        onChange={(next) => {
          current = next
        }}
      />
    )
  )
}

function field<T extends HTMLElement>(testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`champ « ${testId} » absent`)
  return element
}

/**
 * Saisie native : écrire `.value` ne suffit pas, React écoute l'événement. Et il n'écoute pas le
 * MÊME selon l'élément — `input` sur un champ de saisie, `change` sur une liste déroulante.
 */
function type(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const isSelect = element instanceof HTMLSelectElement
  const prototype = isSelect ? HTMLSelectElement : HTMLInputElement
  Object.getOwnPropertyDescriptor(prototype.prototype, 'value')!.set!.call(element, value)
  act(() => element.dispatchEvent(new Event(isSelect ? 'change' : 'input', { bubbles: true })))
}

describe('WatchdogRuleFields — créer une règle à la souris', () => {
  it('saisit le fichier et la condition', () => {
    render()

    type(field<HTMLInputElement>('watchdog-path'), 'D:/serveur/prod.log')
    expect(current.source).toMatchObject({ kind: 'file-match', path: 'D:/serveur/prod.log' })

    render(current)
    type(field<HTMLInputElement>('watchdog-pattern'), 'FATAL')
    expect(current.source).toMatchObject({ pattern: 'FATAL' })
  })

  it('bascule vers les événements internes et propose ceux qui existent VRAIMENT', () => {
    render()
    type(field<HTMLSelectElement>('watchdog-source-kind'), 'app-event')

    expect(current.source.kind).toBe('app-event')

    render(current)
    // Les trois `workflow-*` répondent à « comment détecter un problème de workflow » : la détection
    // existait déjà dans le code, elle n'était exposée nulle part.
    for (const event of [
      'orchestration-red',
      'workflow-gate-failed',
      'workflow-unverified',
      'workflow-proof-lost',
      'task-failed',
      'task-missed'
    ]) {
      expect(field<HTMLInputElement>(`watchdog-event-${event}`)).toBeTruthy()
    }
  })

  it('AVERTIT quand aucun événement n’est coché — la règle ne se déclencherait jamais', () => {
    render({
      source: { kind: 'app-event', events: [] },
      guards: { ...DEFAULT_DRAFT_GUARDS }
    })

    expect(container.querySelector('.watchdog-fields-warning')?.textContent).toContain(
      'ne se déclenchera jamais'
    )
  })

  it('cocher puis décocher un événement le retire de la règle', () => {
    render({
      source: { kind: 'app-event', events: ['orchestration-red'] },
      guards: { ...DEFAULT_DRAFT_GUARDS }
    })

    const box = field<HTMLInputElement>('watchdog-event-workflow-unverified')
    act(() => box.click())
    expect(current.source.kind === 'app-event' && current.source.events).toContain(
      'workflow-unverified'
    )
  })

  it('les BORNES sont visibles dans le formulaire, pas repliées', () => {
    render()

    expect(field<HTMLInputElement>('watchdog-max-per-hour').value).toBe('12')
    expect(field<HTMLInputElement>('watchdog-max-per-day').value).toBe('48')
    expect(field<HTMLInputElement>('watchdog-cost-per-day').value).toBe('')
    expect(field<HTMLInputElement>('watchdog-unpriced-per-day').value).toBe('')
    expect(field<HTMLInputElement>('watchdog-max-per-root').value).toBe('20')
    expect(field<HTMLInputElement>('watchdog-dedup-seconds').value).toBe('60')
    expect(field<HTMLSelectElement>('watchdog-chain-depth').value).toBe('0')
    expect(container.textContent).toContain('partir en rafale')
  })

  it('ne rend chaque borne qu une seule fois', () => {
    render()

    for (const testId of [
      'watchdog-max-per-hour',
      'watchdog-max-per-day',
      'watchdog-cost-per-day',
      'watchdog-unpriced-per-day',
      'watchdog-dedup-seconds',
      'watchdog-max-per-root',
      'watchdog-chain-depth'
    ]) {
      expect(container.querySelectorAll(`[data-testid="${testId}"]`)).toHaveLength(1)
    }
  })

  it('le réglage SÛR de la chaîne est le défaut et le premier proposé', () => {
    render()
    const options = Array.from(field<HTMLSelectElement>('watchdog-chain-depth').options)

    expect(options[0].value).toBe('0')
    expect(options[0].textContent).toContain('conseillé')
  })

  it('AVERTIT dès qu’on autorise une chaîne — c’est le réglage qui peut boucler', () => {
    render()
    expect(container.querySelector('.watchdog-fields-warning')).toBeNull()

    type(field<HTMLSelectElement>('watchdog-chain-depth'), '2')
    render(current)

    expect(container.querySelector('.watchdog-fields-warning')?.textContent).toContain(
      'se re-déclencher'
    )
  })

  it('convertit les secondes saisies en millisecondes stockées', () => {
    render()
    type(field<HTMLInputElement>('watchdog-dedup-seconds'), '30')

    expect(current.guards.dedupWindowMs).toBe(30_000)
  })

  it('refuse un plafond horaire à zéro, qui désarmerait la garde', () => {
    render()
    type(field<HTMLInputElement>('watchdog-max-per-hour'), '0')

    expect(current.guards.maxTriggersPerHour).toBe(1)
  })

  it('refuse une largeur de cascade à zéro, qui désarmerait la garde', () => {
    render()
    type(field<HTMLInputElement>('watchdog-max-per-root'), '0')

    expect(current.guards.maxPerRoot).toBe(1)
  })

  it('saisit les budgets quotidiens et permet de les désactiver explicitement', () => {
    render()
    type(field<HTMLInputElement>('watchdog-max-per-day'), '4')
    render(current)
    type(field<HTMLInputElement>('watchdog-cost-per-day'), '0.25')
    render(current)
    type(field<HTMLInputElement>('watchdog-unpriced-per-day'), '1')

    expect(current.guards).toMatchObject({
      maxTriggersPerDay: 4,
      maxKnownCostUsdPerDay: 0.25,
      maxUnpricedCallsPerDay: 1
    })

    render(current)
    type(field<HTMLInputElement>('watchdog-cost-per-day'), '')
    expect(current.guards.maxKnownCostUsdPerDay).toBeUndefined()
  })

  it('permet de revenir aux bornes conseillées', () => {
    render({
      ...fileRule,
      guards: { dedupWindowMs: 0, maxTriggersPerHour: 200, maxChainDepth: 3, maxPerRoot: 20 }
    })

    act(() => container.querySelector<HTMLButtonElement>('.watchdog-fields-reset')!.click())

    expect(current.guards).toEqual(DEFAULT_DRAFT_GUARDS)
  })
})

describe('WatchdogRuleFields — action et largeur de cascade', () => {
  it('propose de lancer le PIPELINE, pas seulement un tour de conversation', () => {
    render()
    const options = Array.from(field<HTMLSelectElement>('watchdog-action').options)

    expect(options.map((option) => option.value)).toEqual(['chat', 'orchestration'])
    expect(options[1].textContent).toContain('juge')
  })

  it('le défaut reste le chat : orchestrer se demande', () => {
    render()
    expect(field<HTMLSelectElement>('watchdog-action').value).toBe('chat')

    type(field<HTMLSelectElement>('watchdog-action'), 'orchestration')
    expect(current.action).toBe('orchestration')
  })

  it('expose la borne de LARGEUR, celle que la profondeur ne remplace pas', () => {
    render()

    expect(field<HTMLInputElement>('watchdog-max-per-root').value).toBe('20')
    expect(container.textContent).toContain('cascade sans limite')
  })

  it('refuse une largeur à zéro, qui désarmerait la garde', () => {
    render()
    type(field<HTMLInputElement>('watchdog-max-per-root'), '0')

    expect(current.guards.maxPerRoot).toBe(1)
  })
})
