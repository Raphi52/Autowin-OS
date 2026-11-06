// @vitest-environment happy-dom
/**
 * Une réponse réseau peut arriver APRÈS que React a posé un rendu et AVANT qu'il lance ses effets :
 * c'est le cas quand la vue change sans clic (un agent qui navigue, un focus reçu par IPC). Une
 * source effacée dans ce rendu ne doit pas revenir avec la réponse d'une portée déjà close.
 */
import { act, createElement, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type * as Fiabilite from './observatory-reliability'

/**
 * Catalogue des conversations réglé à la main quand `actif` : sa réponse passe par
 * `settleObservatorySources`, dont la chaîne de promesses ne se règle jamais dans la fenêtre visée.
 */
const catalogueManuel = vi.hoisted(() => ({
  actif: false,
  reponses: [] as Array<{ livrer: (valeur: unknown) => void }>
}))

vi.mock('./observatory-reliability', async (importOriginal) => {
  const reel = await importOriginal<typeof Fiabilite>()
  return {
    ...reel,
    settleObservatorySources: (sources: Record<string, Promise<unknown>>) => {
      if (!catalogueManuel.actif) return reel.settleObservatorySources(sources)
      const reponse = new ReponseManuelle<unknown>()
      catalogueManuel.reponses.push(reponse)
      return reponse
    }
  }
})

type Issue<T> = { ok: true; valeur: T } | { ok: false; raison: unknown }

/**
 * Réponse réglée À LA MAIN, de façon SYNCHRONE : ses suites s'exécutent dans l'appel même à
 * `livrer` / `echouer`. Une vraie promesse attend la file des microtâches, que `act` ne laisse
 * jamais passer entre la pose d'un rendu et ses effets ; celle-ci peut y être réglée.
 */
class ReponseManuelle<T> implements PromiseLike<T> {
  private issue: Issue<T> | null = null
  private suites: Array<() => void> = []

  livrer(valeur: T): void {
    this.regler({ ok: true, valeur })
  }

  echouer(raison: unknown): void {
    this.regler({ ok: false, raison })
  }

  then<A = T, B = never>(
    siOk?: ((valeur: T) => A | PromiseLike<A>) | null,
    siKo?: ((raison: unknown) => B | PromiseLike<B>) | null
  ): ReponseManuelle<A | B> {
    const suite = new ReponseManuelle<A | B>()
    const executer = (issue: Issue<T>): void => {
      try {
        if (issue.ok) suite.livrer((siOk ? siOk(issue.valeur) : issue.valeur) as A)
        else if (siKo) suite.livrer(siKo(issue.raison) as B)
        else suite.echouer(issue.raison)
      } catch (raison) {
        suite.echouer(raison)
      }
    }
    const issue = this.issue
    if (issue) executer(issue)
    else this.suites.push(() => executer(this.issue as Issue<T>))
    return suite
  }

  catch<B = never>(siKo: (raison: unknown) => B): ReponseManuelle<T | B> {
    return this.then(undefined, siKo)
  }

  finally(fin: () => void): ReponseManuelle<T> {
    return this.then(
      (valeur) => {
        fin()
        return valeur
      },
      (raison: unknown) => {
        fin()
        throw raison
      }
    )
  }

  private regler(issue: Issue<T>): void {
    if (this.issue) return
    this.issue = issue
    for (const suite of this.suites.splice(0)) suite()
  }
}

const inventaire = {
  points: [
    {
      id: 'orchestration-task-rag',
      label: 'Run · RAG de tâche',
      kind: 'automatic',
      injecte: true,
      emission: 'spool',
      pourquoi: 'Savoir curé injecté en tête de contexte.',
      appelsTotal: 3,
      appelsConversation: 2,
      caracteresConversation: 1234
    }
  ],
  tracesNonRattachees: 0,
  totalTraces: 3,
  pointsJamaisAppeles: []
}

/** Chaque appel rend une réponse en vol neuve ; le test règle la dernière quand il veut. */
function enVol<T>(): {
  appel: ReturnType<typeof vi.fn>
  derniere: () => ReponseManuelle<T>
} {
  const reponses: ReponseManuelle<T>[] = []
  return {
    appel: vi.fn(() => {
      const reponse = new ReponseManuelle<T>()
      reponses.push(reponse)
      return reponse
    }),
    derniere: () => {
      const reponse = reponses.at(-1)
      if (!reponse) throw new Error('aucune requête partie')
      return reponse
    }
  }
}

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversations: vi.fn(async () => [
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }
    ]),
    promptCalls: vi.fn(async () => []),
    promptTraceSummary: vi.fn(async () => []),
    authorizeDiagnostics: vi.fn(async () => null),
    promptTracesGlobal: vi.fn(async () => []),
    causalTrace: vi.fn(async () => []),
    brainTraces: vi.fn(async () => []),
    brainInjectionInventory: vi.fn(async () => null),
    conversationActivity: vi.fn(async () => []),
    activitySessions: vi.fn(async () => []),
    ...overrides
  }
}

describe('Observatory — réponse arrivée entre la pose d’un rendu et ses effets', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
    catalogueManuel.actif = false
    catalogueManuel.reponses.length = 0
  })

  /**
   * Relevé du DOM à CHAQUE rendu posé. `livrerAuProchainRendu` règle une réponse dans le rappel
   * du Profiler, appelé pendant la pose du rendu : avant les effets de ce rendu, donc avant qu'ils
   * aient pu invalider la requête en vol.
   */
  function monter(mockApi: Record<string, unknown>): {
    rendus: string[]
    afficher: (props: Parameters<typeof ObservatoryView>[0]) => Promise<void>
    livrerAuProchainRendu: (livrer: () => void) => void
  } {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const rendus: string[] = []
    let aLivrer: (() => void) | null = null
    const relever = (): void => {
      const vue = container
      if (vue) {
        const panneau = vue.querySelector('[data-testid="brain-injection-inventory"]')
        rendus.push(`${panneau ? '[inventaire] ' : ''}${vue.textContent ?? ''}`)
      }
      const livrer = aLivrer
      aLivrer = null
      livrer?.()
    }
    const afficher = async (props: Parameters<typeof ObservatoryView>[0]): Promise<void> => {
      await act(async () => {
        root?.render(
          createElement(
            Profiler,
            { id: 'observatory', onRender: relever },
            createElement(ObservatoryView, props)
          )
        )
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
    }
    return {
      rendus,
      afficher,
      livrerAuProchainRendu: (livrer) => {
        aLivrer = livrer
      }
    }
  }

  it('ne ramène pas l’inventaire Brain livré juste après le masquage de l’onglet', async () => {
    const inventaires = enVol<typeof inventaire | null>()
    const { rendus, afficher, livrerAuProchainRendu } = monter(
      api({ brainInjectionInventory: inventaires.appel })
    )
    await afficher({ active: true })
    expect(inventaires.appel).toHaveBeenCalledWith('conv-1')

    rendus.length = 0
    livrerAuProchainRendu(() => inventaires.derniere().livrer(inventaire))
    await afficher({ active: false })

    // Entrée qui fait échouer une correction fausse : l'inventaire encore en vol, livré pendant la
    // pose du rendu masqué. Effacé au rendu mais invalidé seulement par l'effet, il revient.
    expect(rendus.length).toBeGreaterThan(0)
    for (const rendu of rendus) expect(rendu).not.toContain('[inventaire]')
  })

  it('ne ramène pas l’erreur des traces Brain livrée juste après le masquage de l’onglet', async () => {
    const traces = enVol<unknown[]>()
    const { rendus, afficher, livrerAuProchainRendu } = monter(api({ brainTraces: traces.appel }))
    await afficher({ active: true })

    rendus.length = 0
    livrerAuProchainRendu(() => traces.derniere().echouer(new Error('brain hors ligne')))
    await afficher({ active: false })

    // Entrée qui fait échouer une correction fausse : l'échec des traces Brain en vol, livré pendant
    // la pose du rendu masqué. Le bandeau d'erreur revient alors que la source est hors portée.
    expect(rendus.length).toBeGreaterThan(0)
    for (const rendu of rendus) expect(rendu).not.toContain('brain hors ligne')
  })

  it('ne ramène pas l’inventaire de la conversation quittée pour un nouveau focus', async () => {
    const inventaires = enVol<typeof inventaire | null>()
    const conversations = vi.fn(async () => [
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }
    ])
    const { rendus, afficher, livrerAuProchainRendu } = monter(
      api({ conversations, brainInjectionInventory: inventaires.appel })
    )
    await afficher({
      active: true,
      focus: { conversationId: 'conv-1', turnId: 'turn-A', requestId: 1 }
    })
    expect(inventaires.appel).toHaveBeenCalledWith('conv-1')

    conversations.mockReturnValue(new Promise(() => undefined))
    rendus.length = 0
    livrerAuProchainRendu(() => inventaires.derniere().livrer(inventaire))
    await afficher({
      active: true,
      focus: { conversationId: 'conv-new', turnId: 'turn-new', requestId: 2 }
    })

    // Entrée qui fait échouer une correction fausse : l'inventaire de conv-1 livré pendant la pose
    // du rendu qui vide la conversation. Il s'afficherait sans aucune conversation choisie.
    expect(rendus.length).toBeGreaterThan(0)
    for (const rendu of rendus) expect(rendu).not.toContain('[inventaire]')
  })

  it('ne ramène pas l’erreur des appels de la conversation quittée pour un nouveau focus', async () => {
    const appels = enVol<unknown[]>()
    const conversations = vi.fn(async () => [
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }
    ])
    const { rendus, afficher, livrerAuProchainRendu } = monter(
      api({ conversations, promptCalls: appels.appel })
    )
    await afficher({
      active: true,
      focus: { conversationId: 'conv-1', turnId: 'turn-A', requestId: 1 }
    })
    expect(appels.appel).toHaveBeenCalledWith('conv-1')

    conversations.mockReturnValue(new Promise(() => undefined))
    rendus.length = 0
    livrerAuProchainRendu(() => appels.derniere().echouer(new Error('appels hors ligne')))
    await afficher({
      active: true,
      focus: { conversationId: 'conv-new', turnId: 'turn-new', requestId: 2 }
    })

    // Entrée qui fait échouer une correction fausse : l'échec des appels de conv-1 livré pendant la
    // pose du rendu qui vide la conversation. Le bandeau accuserait une source sans conversation.
    expect(rendus.length).toBeGreaterThan(0)
    for (const rendu of rendus) expect(rendu).not.toContain('appels hors ligne')
  })

  it('garde l’inventaire affiché pendant qu’une actualisation le relit', async () => {
    const inventaires = enVol<typeof inventaire | null>()
    const { rendus, afficher } = monter(api({ brainInjectionInventory: inventaires.appel }))
    await afficher({ active: true })
    await act(async () => inventaires.derniere().livrer(inventaire))
    expect(rendus.at(-1)).toContain('[inventaire]')

    const actualiser = container?.querySelector(
      '[data-testid="observatory-refresh"]'
    ) as HTMLButtonElement
    rendus.length = 0
    await act(async () => {
      actualiser.click()
      await Promise.resolve()
    })

    // Jumeau accepté : même source, mais la portée reste ouverte. Une correction qui jetterait
    // toute réponse d'un chargement précédent ferait clignoter le panneau pendant la relecture.
    expect(inventaires.appel).toHaveBeenCalledTimes(2)
    expect(rendus.length).toBeGreaterThan(0)
    for (const rendu of rendus) expect(rendu).toContain('[inventaire]')
  })

  const catalogue = {
    values: {
      conversations: [{ id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }],
      native: []
    },
    errors: {}
  }

  it('ne rétablit pas l’ancien tour ciblé quand son catalogue arrive après un nouveau focus', async () => {
    catalogueManuel.actif = true
    const { rendus, afficher, livrerAuProchainRendu } = monter(api())
    await afficher({
      active: true,
      focus: { conversationId: 'conv-1', turnId: 'turn-A', requestId: 1 }
    })
    const catalogueDuFocus1 = catalogueManuel.reponses.at(-1)
    expect(catalogueDuFocus1).toBeDefined()

    rendus.length = 0
    livrerAuProchainRendu(() => catalogueDuFocus1?.livrer(catalogue))
    await afficher({
      active: true,
      focus: { conversationId: 'conv-new', turnId: 'turn-new', requestId: 2 }
    })

    // Entrée qui fait échouer une correction fausse : le catalogue demandé pour le focus 1, livré
    // pendant la pose du rendu du focus 2. Appliqué, il rétablit le tour et la conversation du focus 1.
    expect(catalogueManuel.reponses).toHaveLength(2)
    expect(rendus.length).toBeGreaterThan(0)
    for (const rendu of rendus) {
      expect(rendu).not.toContain('Tour ciblé · turn-A')
      expect(rendu).toContain('Conversation ciblée indisponible')
    }
  })

  it('applique le catalogue livré pendant un rendu qui garde les mêmes entrées', async () => {
    catalogueManuel.actif = true
    const focus = { conversationId: 'conv-1', turnId: 'turn-A', requestId: 1 }
    const { rendus, afficher, livrerAuProchainRendu } = monter(api())
    await afficher({ active: true, focus })
    expect(rendus.at(-1)).toContain('Conversation ciblée indisponible')

    livrerAuProchainRendu(() => catalogueManuel.reponses.at(-1)?.livrer(catalogue))
    await afficher({ active: true, focus })

    // Jumeau accepté : même fenêtre, mais le focus n'a pas changé. Une correction qui jetterait
    // toute réponse livrée pendant la pose d'un rendu laisserait le focus « indisponible ».
    expect(catalogueManuel.reponses).toHaveLength(1)
    expect(rendus.at(-1)).not.toContain('Conversation ciblée indisponible')
    expect(rendus.at(-1)).toContain('Conversation A')
  })
})
