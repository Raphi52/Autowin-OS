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
  return {
    ...origine,
    lignesDuFil: vi.fn(origine.lignesDuFil),
    lignesDesSources: vi.fn(origine.lignesDesSources),
    assemblerJournal: vi.fn(origine.assemblerJournal)
  }
})

import { assemblerJournal, lignesDesSources, lignesDuFil } from './model-activity-log'
import { ModelActivityLogPane } from './ModelActivityLogPane'

const fil = vi.mocked(lignesDuFil)
const sources = vi.mocked(lignesDesSources)
const assembler = vi.mocked(assemblerJournal)
/** Nombre d'appels de chacun des trois calculs du journal. */
const calculs = (): { fil: number; sources: number; assembler: number } => ({
  fil: fil.mock.calls.length,
  sources: sources.mock.calls.length,
  assembler: assembler.mock.calls.length
})

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

async function monter(live = true, fil: Msg[] = messages): Promise<void> {
  await act(async () => {
    root.render(<ModelActivityLogPane conversationId="conv-1" messages={fil} live={live} />)
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
  fil.mockClear()
  sources.mockClear()
  assembler.mockClear()
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
    const apresMontage = calculs()
    expect(apresMontage.assembler).toBeGreaterThan(0)
    const lecturesTrace = api.causalTraceGraphe.mock.calls.length
    await attendre(8_100)
    // Les relectures ont eu lieu (2 passes de 4 s)…
    expect(api.causalTraceGraphe.mock.calls.length).toBeGreaterThanOrEqual(lecturesTrace + 2)
    // … mais rien n'ayant changé, aucun des trois calculs du journal n'a été refait.
    expect(calculs()).toEqual(apresMontage)
  })

  it('une relecture qui CHANGE repose la source et le journal suit', async () => {
    await monter()
    const apresMontage = calculs()
    api.conversationActivity.mockResolvedValue([
      { ts: '2026-10-11T10:00:05.000Z', costUsd: 0.02 },
      { ts: '2026-10-11T10:00:09.000Z', costUsd: 0.5 }
    ])
    await attendre(4_100)
    const apres = calculs()
    expect(apres.sources).toBeGreaterThan(apresMontage.sources)
    expect(apres.assembler).toBeGreaterThan(apresMontage.assembler)
    // Une source relue n'a rien changé au fil : ses lignes ne sont pas refaites.
    expect(apres.fil).toBe(apresMontage.fil)
    expect(host.textContent).toContain('0.5 $')
  })

  it('un fragment de réponse ne refait QUE les lignes du fil, pas les six sources', async () => {
    await monter()
    const avant = calculs()
    // Ce que fait le fil pendant un tour : un tableau NEUF dont seul le dernier message a grandi.
    const fragment = [
      ...messages.slice(0, 3),
      { ...messages[3], parts: [{ kind: 'action', name: 'geste_du_fragment', ok: true }] }
    ] as unknown as Msg[]
    await monter(true, fragment)
    const apres = calculs()
    expect(apres.fil).toBe(avant.fil + 1)
    expect(apres.assembler).toBe(avant.assembler + 1)
    expect(apres.sources).toBe(avant.sources)
    expect(host.textContent).toContain('geste_du_fragment')
    // Les lignes des sources sont toujours là après l'assemblage.
    expect(host.textContent).toContain('0.02 $')
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
