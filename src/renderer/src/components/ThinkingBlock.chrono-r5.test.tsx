// @vitest-environment happy-dom
/**
 * Compteur de secondes de la capsule « Raisonnement » (variante R5, conv-162, 2026-10-10 :
 * « pas les mots de raisonnement, seulement un compteur de secondes », puis « go R5 »).
 *
 * Aucune duree de pensee n'est enregistree par le tour : le chrono est mesure a l'ecran. Ce test
 * verrouille les quatre promesses de `useChronoDuRaisonnement` : il AVANCE pendant le tour, il se
 * FIGE a la fin, il SURVIT a un demontage du bloc pendant le tour (meme `turnId`), et il est ABSENT
 * sur un tour recharge qu'on n'a jamais vu en cours — plutot qu'un chiffre invente.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThinkingBlock } from './ThinkingBlock'
import { dureeLisible, secondesDuChrono } from './thinking-block-corps'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

type Props = { text: string; done: boolean; turnId?: string; reasoningMs?: number }

function monter(props: Props): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(createElement(ThinkingBlock, props)))
}

function rendre(props: Props): void {
  act(() => root!.render(createElement(ThinkingBlock, props)))
}

function demonter(): void {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
}

const compteur = (): string | null =>
  host!.querySelector('[data-testid="thinking-block-secondes"]')?.textContent ?? null

const avancer = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
})

afterEach(() => {
  demonter()
  vi.useRealTimers()
})

describe('capsule Raisonnement — compteur de secondes', () => {
  it('avance pendant le tour, puis se fige à la fin', () => {
    monter({ text: 'je pèse', done: false, turnId: 'tour-a' })
    expect(compteur()).toBe('0 s')
    avancer(12_000)
    expect(compteur()).toBe('12 s')
    rendre({ text: 'je pèse', done: true, turnId: 'tour-a' })
    expect(compteur()).toBe('12 s')
    avancer(30_000)
    expect(compteur(), 'un tour fini ne compte plus').toBe('12 s')
    expect(host!.querySelector('[data-testid="thinking-block-capsule"]')!.textContent).toBe(
      'Raisonnement terminé12 s'
    )
  })

  it('ne repart pas de zéro quand le bloc est démonté puis remonté pendant le tour', () => {
    monter({ text: '', done: false, turnId: 'tour-b' })
    avancer(5_000)
    demonter()
    avancer(4_000)
    monter({ text: '', done: false, turnId: 'tour-b' })
    expect(compteur()).toBe('9 s')
  })

  it('garde la durée figée si le tour fini est remonté plus tard dans la session', () => {
    monter({ text: '', done: false, turnId: 'tour-c' })
    avancer(7_000)
    rendre({ text: '', done: true, turnId: 'tour-c' })
    demonter()
    avancer(60_000)
    monter({ text: '', done: true, turnId: 'tour-c' })
    expect(compteur()).toBe('7 s')
  })

  it("n'affiche AUCUN compteur sur un tour rechargé jamais vu en cours", () => {
    monter({ text: 'pensée d’hier', done: true, turnId: 'tour-recharge' })
    expect(compteur()).toBeNull()
    expect(host!.querySelector('[data-testid="thinking-block-capsule"]')!.textContent).toBe(
      'Raisonnement terminé'
    )
  })

  // conv-162 : « enregistre la durée du raisonnement avec le tour pour que le compteur de secondes
  // de la capsule reste affiché après un rechargement de la conversation ».
  it('affiche la durée CONSERVÉE par le tour quand il est rechargé', () => {
    monter({ text: 'pensée d’hier', done: true, turnId: 'tour-relu', reasoningMs: 31_400 })
    expect(compteur()).toBe('31 s')
    expect(host!.querySelector('[data-testid="thinking-block-capsule"]')!.textContent).toBe(
      'Raisonnement terminé31 s'
    )
  })

  it('garde le chiffre vu en direct quand la durée conservée arrive ensuite', () => {
    monter({ text: '', done: false, turnId: 'tour-d' })
    avancer(12_000)
    rendre({ text: '', done: true, turnId: 'tour-d', reasoningMs: 13_200 })
    expect(compteur(), 'le chiffre ne doit pas sauter sous les yeux').toBe('12 s')
  })

  it('passe en minutes au-delà de 59 s', () => {
    expect(dureeLisible(59)).toBe('59 s')
    expect(dureeLisible(60)).toBe('1 min')
    expect(dureeLisible(125)).toBe('2 min 5 s')
    expect(secondesDuChrono({ debut: 0, fin: 125_400 }, 0)).toBe(125)
  })
})
