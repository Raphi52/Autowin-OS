import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrainTrace } from './activity/brain-trace-spool'
import type {
  BrainNavigationCandidate,
  BrainRetrievalOptions,
  BrainRetrievalResult
} from './brain-retrieval'
import {
  EN_TETE_TITRES,
  POINT_TITRES_DU_TOUR,
  TITRES_DELAI_MS,
  createBrainTitresDuTour,
  rendreTitres,
  selectionnerTitres
} from './brain-titres-du-tour'

function candidat(rank: number, denseCos: number, retained = true): BrainNavigationCandidate {
  return {
    rank,
    path: `knowledge/lessons/note-${rank}.md`,
    type: 'lesson',
    denseCos,
    retained,
    title: `Note ${rank}`
  }
}

function resultat(candidates: BrainNavigationCandidate[]): BrainRetrievalResult {
  return {
    context: 'liste',
    status: 'found',
    navigation: { query: 'q', minDense: 0.25, candidates }
  }
}

const QUESTION = 'pourquoi le watchdog Teams ne répond pas aux messages'

describe('selectionnerTitres — seules les notes PROCHES passent', () => {
  it('garde rang ≤ 3 ET score ≥ 0,40, retenues, 3 au plus, dans l’ordre du rang', () => {
    const titres = selectionnerTitres(
      resultat([
        candidat(3, 0.55),
        candidat(1, 0.62),
        candidat(2, 0.39), // score trop bas
        candidat(4, 0.9), // rang trop loin : c'est lui qui écarte le hors-sujet mesuré
        candidat(5, 0.7)
      ])
    )
    expect(titres.map((t) => t.path)).toEqual([
      'knowledge/lessons/note-1.md',
      'knowledge/lessons/note-3.md'
    ])
  })

  it('écarte une note non retenue par le serveur, même proche', () => {
    expect(selectionnerTitres(resultat([candidat(1, 0.8, false)]))).toEqual([])
  })

  it('écarte une note déjà montrée dans le fil', () => {
    const titres = selectionnerTitres(
      resultat([candidat(1, 0.8), candidat(2, 0.8)]),
      new Set(['knowledge/lessons/note-1.md'])
    )
    expect(titres.map((t) => t.path)).toEqual(['knowledge/lessons/note-2.md'])
  })

  it('un résultat sans navigation (panne, serveur ancien) ne donne rien', () => {
    expect(selectionnerTitres({ context: '', status: 'unavailable' })).toEqual([])
  })
})

describe('rendreTitres — le bloc le plus court possible', () => {
  it('rien à montrer = zéro caractère, pas même l’en-tête', () => {
    expect(rendreTitres([])).toBe('')
  })

  it('le chemin seul, sans titre ni contenu', () => {
    const bloc = rendreTitres([{ path: 'knowledge/lessons/a.md', title: 'Un titre long' }])
    expect(bloc).toBe(`${EN_TETE_TITRES}\n- knowledge/lessons/a.md`)
    expect(bloc).not.toContain('Un titre long')
  })
})

describe('createBrainTitresDuTour — le branchement du tour de chat', () => {
  beforeEach(() => {
    vi.stubEnv('AUTOWIN_BRAIN_CORPUS', '*')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function monter(reponse: () => Promise<BrainRetrievalResult>) {
    const appels: { query: string; options: BrainRetrievalOptions }[] = []
    const traces: BrainTrace[] = []
    const titres = createBrainTitresDuTour({
      retrieve: async (query, options) => {
        appels.push({ query, options })
        return reponse()
      },
      onBrainTrace: (trace) => traces.push(trace)
    })
    return { titres, appels, traces }
  }

  it('une relance sans sujet (« ok vas-y ») n’interroge pas le Brain et ne coûte rien', async () => {
    const { titres, appels, traces } = monter(async () => resultat([candidat(1, 0.9)]))
    expect(await titres('ok vas-y', { conversationId: 'conv-1' })).toBe('')
    expect(appels).toHaveLength(0)
    expect(traces).toHaveLength(0)
  })

  it('interroge en mode liste avec un délai borné, et rend le bloc des notes proches', async () => {
    const { titres, appels } = monter(async () => resultat([candidat(1, 0.62), candidat(2, 0.3)]))
    const bloc = await titres(QUESTION, { conversationId: 'conv-1', turnId: 't-1' })
    expect(appels).toHaveLength(1)
    expect(appels[0].options).toMatchObject({ mode: 'candidates', timeoutMs: TITRES_DELAI_MS })
    expect(bloc).toBe(`${EN_TETE_TITRES}\n- knowledge/lessons/note-1.md`)
  })

  it('ne relisse pas au tour suivant une note déjà montrée dans le MÊME fil', async () => {
    const { titres } = monter(async () => resultat([candidat(1, 0.62)]))
    expect(await titres(QUESTION, { conversationId: 'conv-1' })).not.toBe('')
    expect(await titres(QUESTION, { conversationId: 'conv-1' })).toBe('')
    // Un autre fil ne l'a jamais vue : elle lui est montrée.
    expect(await titres(QUESTION, { conversationId: 'conv-2' })).not.toBe('')
  })

  it('laisse une trace rattachée à son point de registre, avec le poids réellement injecté', async () => {
    const { titres, traces } = monter(async () => resultat([candidat(1, 0.62)]))
    const bloc = await titres(QUESTION, { conversationId: 'conv-1', turnId: 't-1' })
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      kind: 'pousse',
      point: POINT_TITRES_DU_TOUR,
      conversationId: 'conv-1',
      turnId: 't-1',
      found: true,
      injectedChars: bloc.length
    })
  })

  it('une panne du Brain ne casse pas le tour : bloc vide, trace « indisponible »', async () => {
    const { titres, traces } = monter(async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(await titres(QUESTION, { conversationId: 'conv-1' })).toBe('')
    expect(traces[0]).toMatchObject({ found: false, status: 'unavailable', injectedChars: 0 })
  })

  it('un dossier sans corpus Brain autorisé n’interroge rien (même fermeture que brain_query)', async () => {
    vi.stubEnv('AUTOWIN_BRAIN_CORPUS', ',')
    const { titres, appels } = monter(async () => resultat([candidat(1, 0.9)]))
    expect(await titres(QUESTION, { conversationId: 'conv-1' })).toBe('')
    expect(appels).toHaveLength(0)
  })
})
