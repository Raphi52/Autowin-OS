// @vitest-environment happy-dom
/**
 * RELIRE N'EST PAS RECALCULER (conv-252, 2026-10-11 : « corrige l'onglet Logs du panneau de droite
 * pour qu'il ne recalcule plus tout le journal toutes les 2 à 4 s quand rien n'a changé et qu'il lise
 * la trace allégée »). Mesure d'origine : `gels.jsonl`, 12:00-12:02, le panneau droit tenait
 * l'affichage 1,1 à 2,8 s toutes les 2 à 4 s pendant un tour vivant.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : une relecture identique qui reconstruit le journal ; la boucle
 * qui relit les journaux des tours terminés ; la trace COMPLÈTE relue alors que l'allégée existe ; une
 * étape dépliée qui n'affiche pas son contenu entier.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Msg } from './chat-view-types'

vi.mock('./model-activity-log', async (importOriginal) => {
  const origine = await importOriginal<typeof import('./model-activity-log')>()
  return { ...origine, buildModelActivityLog: vi.fn(origine.buildModelActivityLog) }
})

import { buildModelActivityLog } from './model-activity-log'
import { ModelActivityLogPane } from './ModelActivityLogPane'

const construire = vi.mocked(buildModelActivityLog)

// Tableau STABLE : seul l'état relu peut relancer la construction du journal.
const messages = [
  { role: 'user', content: 'premier' },
  { role: 'assistant', turnId: 'tour-1', done: true, parts: [] },
  { role: 'user', content: 'second' },
  { role: 'assistant', turnId: 'tour-2', parts: [] }
] as unknown as Msg[]

const evenementLeger = {
  id: 'e1',
  type: 'injection',
  turnId: 'tour-2',
  timestamp: '2026-10-11T10:00:00.000Z',
  payloads: [{ kind: 'contexte', name: 'état app', content: '' }]
}

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>

async function monter(live = true): Promise<void> {
  await act(async () => {
    root.render(<ModelActivityLogPane conversationId="conv-1" messages={messages} live={live} />)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function attendre(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  construire.mockClear()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  api = {
    turnJournal: vi.fn(async (_conv: string, turnId: string) => [
      { kind: 'reasoning', text: `réflexion ${turnId}`, at: 1 }
    ]),
    causalTrace: vi.fn(async () => [
      { ...evenementLeger, payloads: [{ kind: 'contexte', content: 'COMPLET' }] }
    ]),
    causalTraceGraphe: vi.fn(async () => [evenementLeger]),
    causalTraceCharges: vi.fn(async () => ({
      e1: [{ kind: 'contexte', name: 'état app', content: 'onglet chat, contenu entier' }]
    })),
    conversationActivity: vi.fn(async () => [{ ts: '2026-10-11T10:00:05.000Z', costUsd: 0.02 }])
  }
  ;(window as unknown as { api: unknown }).api = api
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('ModelActivityLogPane — relire n’est pas recalculer', () => {
  it('une relecture IDENTIQUE ne reconstruit pas le journal, alors que les sources sont bien relues', async () => {
    await monter()
    const apresMontage = construire.mock.calls.length
    const lecturesTrace = api.causalTraceGraphe.mock.calls.length
    await attendre(8_100)
    // Les relectures ont eu lieu (2 passes de 4 s)…
    expect(api.causalTraceGraphe.mock.calls.length).toBeGreaterThanOrEqual(lecturesTrace + 2)
    // … mais rien n'ayant changé, le journal n'a pas été reconstruit une seule fois.
    expect(construire.mock.calls.length).toBe(apresMontage)
  })

  it('une relecture qui CHANGE repose la source et le journal suit', async () => {
    await monter()
    const apresMontage = construire.mock.calls.length
    api.conversationActivity.mockResolvedValue([
      { ts: '2026-10-11T10:00:05.000Z', costUsd: 0.02 },
      { ts: '2026-10-11T10:00:09.000Z', costUsd: 0.5 }
    ])
    await attendre(4_100)
    expect(construire.mock.calls.length).toBeGreaterThan(apresMontage)
    expect(host.textContent).toContain('0.5 $')
  })

  it('en boucle, ne relit que le journal du DERNIER tour ; les tours terminés sont lus une fois', async () => {
    await monter()
    expect(api.turnJournal.mock.calls.map(([, turnId]) => turnId).sort()).toEqual([
      'tour-1',
      'tour-2'
    ])
    api.turnJournal.mockClear()
    await attendre(6_100)
    const relus = api.turnJournal.mock.calls.map(([, turnId]) => turnId)
    expect(relus.length).toBeGreaterThanOrEqual(3)
    expect(new Set(relus)).toEqual(new Set(['tour-2']))
  })

  it('le journal du tour vivant qui grandit est bien affiché', async () => {
    await monter()
    api.turnJournal.mockImplementation(async (_conv: string, turnId: string) =>
      turnId === 'tour-2'
        ? [
            { kind: 'reasoning', text: 'réflexion tour-2', at: 1 },
            { kind: 'reasoning', text: 'nouvelle pensée vivante', at: 2 }
          ]
        : [{ kind: 'reasoning', text: `réflexion ${turnId}`, at: 1 }]
    )
    await attendre(2_100)
    expect(host.textContent).toContain('nouvelle pensée vivante')
    // Le tour terminé, lu au montage, est toujours là.
    expect(host.textContent).toContain('réflexion tour-1')
  })
})

describe('ModelActivityLogPane — la trace allégée', () => {
  it('lit la trace ALLÉGÉE quand le pont la propose, jamais la complète', async () => {
    await monter()
    await attendre(8_100)
    expect(api.causalTraceGraphe).toHaveBeenCalledWith('conv-1')
    expect(api.causalTrace).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('COMPLET')
  })

  it('sans les canaux allégés (pont ancien en dev), relit la trace complète comme avant', async () => {
    delete (api as Record<string, unknown>).causalTraceGraphe
    delete (api as Record<string, unknown>).causalTraceCharges
    await monter(false)
    expect(api.causalTrace).toHaveBeenCalledWith('conv-1')
    expect(host.textContent).toContain('COMPLET')
  })

  it('déplier une étape de la trace relit SON contenu entier, une seule fois', async () => {
    await monter()
    const ligne = host.querySelector('[data-log-kind="injection"]') as HTMLElement
    expect(ligne).not.toBeNull()
    const carte = ligne.querySelector('details') as HTMLDetailsElement
    expect(carte.textContent).not.toContain('contenu entier')
    await act(async () => {
      carte.open = true
      carte.dispatchEvent(new Event('toggle'))
    })
    await attendre(0)
    expect(api.causalTraceCharges).toHaveBeenCalledWith('conv-1', ['e1'], ['contexte'])
    expect(carte.textContent).toContain('onglet chat, contenu entier')
    // Replier puis redéplier ne relit pas : la trace est en ajout seul.
    await act(async () => {
      carte.open = false
      carte.dispatchEvent(new Event('toggle'))
      carte.open = true
      carte.dispatchEvent(new Event('toggle'))
    })
    await attendre(0)
    expect(api.causalTraceCharges).toHaveBeenCalledTimes(1)
  })

  it('un contenu illisible le dit dans la carte, sans casser le journal', async () => {
    api.causalTraceCharges.mockRejectedValue(new Error('trace verrouillée'))
    await monter()
    const carte = host.querySelector('[data-log-kind="injection"] details') as HTMLDetailsElement
    await act(async () => {
      carte.open = true
      carte.dispatchEvent(new Event('toggle'))
    })
    await attendre(0)
    expect(carte.textContent).toContain('Contenu illisible : trace verrouillée')
    expect(host.textContent).toContain('réflexion tour-1')
  })
})
