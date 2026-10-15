// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'
import { recalerAncre } from './duree-vivante'

/**
 * LE CHRONO D'UNE ACTION EN COURS AVANCE A LA SECONDE.
 *
 * Signale le 2026-10-15 (conv-982, capture) : « le timer de raisonnement s'actualise toutes les
 * secondes et celui de actions toutes les 5 ; passe celui de actions a une seconde aussi ». Sur la
 * meme capture, « Raisonnement 27 min 55 s » bougeait chaque seconde et « 1 action terminée · 1
 * action en cours 27 min 7 s » sautait de cinq en cinq.
 *
 * CAUSE : la pastille de duree n'etait pas une horloge mais le TEXTE du battement envoye par le
 * processus principal toutes les `VERIFY_BATTEMENT_MS` (5 s, src/main/verify-battement.ts). Entre
 * deux battements, rien ne la faisait avancer. Le bloc Raisonnement, lui, a son propre tic a 1 s.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-15T10:00:00.000Z'))
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

type Props = Parameters<typeof AssistantActivityGroup>[0]
type Action = Props['actions'][number]

const orchestration = (over: Partial<Action> = {}): Action =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 'ma tache' }, ...over }) as Action
const lecture = { kind: 'action', name: 'brain_read', ok: true } as Action

function rendre(props: Props): void {
  act(() => root.render(createElement(AssistantActivityGroup, props)))
}
const avancer = (ms: number): void => act(() => void vi.advanceTimersByTime(ms))
const duree = (): string | null =>
  container.querySelector('[data-testid="activity-duree"]')?.textContent ?? null

describe('chrono d une action en cours — tic a la seconde', () => {
  it('le groupe MIXTE de la capture avance chaque seconde entre deux battements', () => {
    const enCours = (progress: string): Props => ({
      actions: [lecture, orchestration({ progress, pipeline: [{ phase: 'frame' }] })]
    })
    rendre(enCours('27 min 7 s · frame · réfléchit…'))
    expect(container.textContent).toContain('1 action terminée · 1 action en cours')
    expect(duree()).toBe('27 min 7 s')
    avancer(1_000)
    expect(duree()).toBe('27 min 8 s')
    avancer(3_000)
    expect(duree()).toBe('27 min 11 s')
    // Le battement suivant (5 s apres) prend le relais sans faire reculer le chiffre.
    avancer(1_000)
    rendre(enCours('27 min 12 s · frame · réfléchit…'))
    expect(duree()).toBe('27 min 12 s')
    avancer(1_000)
    expect(duree()).toBe('27 min 13 s')
  })

  it('un battement en LEGER retard (arrondi, latence) ne fait jamais reculer le chiffre', () => {
    const enCours = (progress: string): Props => ({ actions: [orchestration({ progress })] })
    rendre(enCours('45 s · scout · Bash · node x'))
    avancer(5_000)
    expect(duree()).toBe('50 s')
    rendre(enCours('49 s · scout · Bash · node x'))
    expect(duree()).toBe('50 s')
    avancer(1_000)
    expect(duree()).toBe('51 s')
  })

  it('la capsule d orchestration seule avance aussi a la seconde', () => {
    rendre({ actions: [orchestration({ progress: '59 s · scout · Read · a.ts' })] })
    expect(duree()).toBe('59 s')
    avancer(1_000)
    expect(duree()).toBe('1 min')
    avancer(1_000)
    expect(duree()).toBe('1 min 1 s')
  })

  it('une fois le verdict rendu, plus aucune duree ne tourne', () => {
    rendre({ actions: [orchestration({ progress: '10 s · scout · Read · a.ts' })] })
    rendre({ actions: [orchestration({ ok: true, data: { status: 'succeeded' } })] })
    avancer(3_000)
    expect(duree()).toBeNull()
  })
})

describe('recalerAncre — depart estime d une action a partir de ses battements', () => {
  it('garde le depart le plus ANCIEN tant que les battements concordent', () => {
    const ancre = recalerAncre(undefined, 10, 20_000)
    expect(ancre).toBe(10_000)
    // Battement en retard d'une demi-seconde : on garde l'ancre la plus tot (chiffre monotone).
    expect(recalerAncre(ancre, 14, 24_500)).toBe(10_000)
    expect(recalerAncre(ancre, 15, 24_600)).toBe(9_600)
  })

  it('repart d un battement qui raconte une autre horloge (autre action, app ralentie)', () => {
    expect(recalerAncre(10_000, 3, 60_000)).toBe(57_000)
  })
})
