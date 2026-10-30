// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDeLots, ReponsePlansDeLots } from '../../../shared/plan-de-lots'
import { ChatMosaic, type ChatMosaicWindow, type LienDeLotMosaique } from './ChatMosaic'

/*
 * conv-1305 (/draft, « implémente 5 et 6 ») : une super conv ouverte dans la mosaïque ne fait
 * qu'UNE case — onglets Chef · 1 · 2 …, frise pleine chiffrée sous l'onglet Chef, seule piste du
 * lot sous l'onglet d'un lot, puis le vrai fil et la vraie saisie de l'onglet ouvert.
 */
const MIN = 60_000
const T0 = Date.UTC(2026, 9, 30, 13, 0)

function planDeTest(): PlanDeLots {
  return {
    id: 'plan-1',
    chef: 'conv-c',
    cle: 'k',
    titre: 'Super conv de test',
    parallele: 3,
    plafondTours: 6,
    toursLances: 3,
    statut: 'en-cours',
    avertissements: [],
    creeLe: T0,
    lots: [
      {
        rang: 1,
        titre: 'Lecture groupée',
        demande: 'x',
        fichiers: [],
        etat: 'fait',
        fil: 'conv-l1',
        debut: T0,
        fin: T0 + 4 * MIN
      },
      {
        rang: 2,
        titre: 'Bouton Relancer',
        demande: 'x',
        fichiers: [],
        etat: 'echec',
        fil: 'conv-l2',
        debut: T0,
        fin: T0 + 9 * MIN,
        raison: 'le fil se déclare bloqué : test rouge'
      },
      { rang: 3, titre: 'Rangement', demande: 'x', fichiers: [], etat: 'a-faire', apres: [2] }
    ]
  }
}

const LIENS: ReadonlyMap<string, LienDeLotMosaique> = new Map([
  ['conv-l1', { chef: 'conv-c', rang: 1, total: 3 }],
  ['conv-l2', { chef: 'conv-c', rang: 2, total: 3 }]
])

/** Tous les titres de conv : conv-l2 n'a pas de fenêtre ouverte, son onglet doit l'écrire quand même. */
const TITRES: ReadonlyMap<string, string> = new Map([
  ['conv-c', 'Le fil chef'],
  ['conv-l1', 'Lot 1/3 — Lecture'],
  ['conv-l2', 'Lot 2/3 — Bouton']
])

let appels: unknown[][] = []
let plan: PlanDeLots
/** Ce que rend le geste « phrases » : la phrase de chaque lot, lue par le processus principal. */
let phrases: Record<number, string> = {}
/** Pose un refus sur les gestes qui écrivent. */
let refus: string | undefined
let signaler: (e: { type: string; scope: string }) => void = () => {}

beforeEach(() => {
  appels = []
  plan = planDeTest()
  phrases = {}
  refus = undefined
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
    plansDeLots: (geste: string, fil: string, planId?: string, lot?: number) => {
      appels.push(lot === undefined ? [geste, fil, planId] : [geste, fil, planId, lot])
      const reponse: ReponsePlansDeLots =
        geste === 'voir'
          ? { ok: true, vue: fil === 'conv-c' ? { plan, role: 'chef' } : null }
          : geste === 'phrases'
            ? { ok: true, phrases }
            : refus
              ? { ok: false, erreur: refus }
              : { ok: true, detail: 'ok' }
      return Promise.resolve(reponse)
    },
    onAppEvent: (ecouter: typeof signaler) => {
      signaler = ecouter
      return () => {}
    }
  }
})

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
})

const fenetre = (
  id: string,
  texte: string,
  role: 'user' | 'assistant' = 'user'
): ChatMosaicWindow => ({
  id,
  title: `Titre ${id}`,
  messages:
    role === 'user'
      ? [{ role: 'user', content: texte }]
      : ([
          {
            role: 'assistant',
            parts: [{ kind: 'text', text: texte }],
            status: 'done',
            done: true
          }
        ] as unknown as ChatMosaicWindow['messages']),
  busy: false
})

const composerFactice = (id: string): React.ReactNode => (
  <textarea data-testid={`composer-${id}`} aria-label={`Message pour ${id}`} />
)

async function monter(
  fenetres: ChatMosaicWindow[],
  rappels: { onClose?: (id: string) => void; onOuvrirFil?: (id: string) => void } = {}
): Promise<HTMLElement> {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  await act(async () => {
    createRoot(hote).render(
      <ChatMosaic
        fenetres={fenetres}
        onClose={rappels.onClose ?? vi.fn()}
        onOuvrirSeule={vi.fn()}
        rendreComposer={composerFactice}
        onNouvelleConversation={vi.fn()}
        liensDeLots={LIENS}
        titresDesFils={TITRES}
        onOuvrirFil={rappels.onOuvrirFil}
      />
    )
  })
  // Le plan arrive par le canal (promesse) : un second tour le pose.
  await act(async () => {})
  return hote
}

const cliquer = async (el: Element | null): Promise<void> => {
  expect(el).not.toBeNull()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

describe('la super conv dans la mosaïque', () => {
  it('le chef et ses lots ouverts ne font qu’UNE case à onglets ; les autres fils gardent la leur', async () => {
    const hote = await monter([
      fenetre('conv-c', 'plan'),
      fenetre('conv-l1', 'Livré : un seul appel lit tous les plans.', 'assistant'),
      fenetre('conv-x', 'autre chose')
    ])
    expect(hote.querySelectorAll('.chat-mosaic-window')).toHaveLength(2)
    expect(hote.querySelector('.chat-mosaic')?.getAttribute('data-count')).toBe('2')
    const onglets = [...hote.querySelectorAll('.scm-onglet')].map((o) => o.textContent)
    expect(onglets).toEqual([
      'Le fil chef',
      'Lot 1/3 — Lecture',
      'Lot 2/3 — Bouton',
      'Lot 3/3 — Rangement'
    ])
    // Un lot jamais lancé n'a pas de fil : son onglet ne s'ouvre pas.
    expect(hote.querySelector<HTMLButtonElement>('[data-testid="scm-onglet-3"]')?.disabled).toBe(
      true
    )
    expect(hote.querySelector('[data-testid="scm-onglet-2"]')?.getAttribute('data-etat')).toBe(
      'echec'
    )
  })

  it('l’onglet Chef montre la frise pleine : chiffres en tête, une piste par lot, sa phrase, Relancer', async () => {
    phrases = { 1: 'Livré : un seul appel lit tous les plans.' }
    const hote = await monter([
      fenetre('conv-c', 'plan'),
      fenetre('conv-l1', 'Livré : un seul appel lit tous les plans.', 'assistant')
    ])
    const frise = hote.querySelector('[data-testid="scm-frise"]')
    expect(frise).not.toBeNull()
    expect(hote.querySelector('[data-testid="scm-chiffre-faits"]')?.textContent).toContain('1/3')
    expect(hote.querySelectorAll('.scm-piste')).toHaveLength(3)
    // Les barres viennent des heures du plan : lot 1 = 4 min sur un axe de 9 min.
    const barre1 = hote.querySelector<HTMLElement>('[data-testid="scm-piste-1"] .scm-barre')
    expect(barre1?.style.left).toBe('0.00%')
    expect(barre1?.style.width).toBe('44.44%')
    expect(hote.querySelector('[data-testid="scm-piste-1"]')?.textContent).toContain(
      'Livré : un seul appel lit tous les plans.'
    )
    expect(hote.querySelector('[data-testid="scm-piste-2"]')?.textContent).toContain('test rouge')
    expect(hote.querySelector('[data-testid="scm-piste-3"]')?.textContent).toContain('après 2')
    // Le fil et la saisie restent ceux du chef.
    expect(
      hote.querySelector('[data-conv-id="conv-c"] [data-testid="composer-conv-c"]')
    ).not.toBeNull()

    await cliquer(hote.querySelector('[data-testid="scm-piste-2-relancer"]'))
    expect(appels).toContainEqual(['relancer', 'conv-c', 'plan-1', 2])
  })

  it('la phrase d’un lot s’affiche même s’il n’a jamais été ouvert ici (conv-1315)', async () => {
    phrases = { 1: 'Livré sans que personne n’ouvre ce fil.' }
    const hote = await monter([fenetre('conv-c', 'plan')])
    expect(appels).toContainEqual(['phrases', 'conv-c', undefined])
    expect(hote.querySelector('[data-testid="scm-piste-1"]')?.textContent).toContain(
      'Livré sans que personne n’ouvre ce fil.'
    )
  })

  it('une raison ou une attente passe devant la phrase', async () => {
    phrases = { 2: 'Je corrige le test.', 3: 'Rien encore.' }
    const hote = await monter([fenetre('conv-c', 'plan')])
    const dit = (rang: number): string | null | undefined =>
      hote.querySelector(`[data-testid="scm-piste-${rang}"] .scm-phrase`)?.textContent
    expect(dit(2)).toBe('le fil se déclare bloqué : test rouge')
    expect(dit(3)).toBe('Rien encore.')
  })

  it('un plan en cours s’arrête depuis la case, et le bouton suit le plan relu (conv-1315)', async () => {
    const hote = await monter([fenetre('conv-c', 'plan')])
    expect(hote.querySelector('[data-testid="scm-reprendre"]')).toBeNull()
    await cliquer(hote.querySelector('[data-testid="scm-arreter"]'))
    expect(appels).toContainEqual(['arreter', 'conv-c', 'plan-1'])

    plan = { ...plan, statut: 'arrete' }
    await act(async () => signaler({ type: 'refresh', scope: 'plans-de-lots' }))
    await act(async () => {})
    expect(hote.querySelector('[data-testid="scm-arreter"]')).toBeNull()
    await cliquer(hote.querySelector('[data-testid="scm-reprendre"]'))
    expect(appels).toContainEqual(['reprendre', 'conv-c', 'plan-1'])
  })

  it('un plan suspendu propose les deux gestes, un plan terminé aucun', async () => {
    plan = { ...plan, statut: 'suspendu-quota' }
    const suspendu = await monter([fenetre('conv-c', 'plan')])
    expect(suspendu.querySelector('[data-testid="scm-reprendre"]')).not.toBeNull()
    expect(suspendu.querySelector('[data-testid="scm-arreter"]')).not.toBeNull()

    plan = { ...plan, statut: 'termine' }
    const termine = await monter([fenetre('conv-c', 'plan')])
    expect(termine.querySelector('[data-testid="scm-reprendre"]')).toBeNull()
    expect(termine.querySelector('[data-testid="scm-arreter"]')).toBeNull()
  })

  it('un geste refusé dit pourquoi dans la case', async () => {
    refus = 'plan terminé : rien à arrêter.'
    const hote = await monter([fenetre('conv-c', 'plan')])
    await cliquer(hote.querySelector('[data-testid="scm-arreter"]'))
    expect(hote.querySelector('.scm-erreur')?.textContent).toBe(refus)
  })

  it('l’onglet d’un lot montre SON fil, SA saisie et sa seule piste', async () => {
    const hote = await monter([
      fenetre('conv-c', 'plan'),
      fenetre('conv-l1', 'Livré : un seul appel lit tous les plans.', 'assistant')
    ])
    await cliquer(hote.querySelector('[data-testid="scm-onglet-1"]'))
    expect(hote.querySelector('.chat-mosaic-window')?.getAttribute('data-conv-id')).toBe('conv-l1')
    expect(hote.querySelector('[data-testid="composer-conv-l1"]')).not.toBeNull()
    expect(hote.querySelector('[data-testid="scm-frise"]')).toBeNull()
    expect(hote.querySelector('[data-testid="scm-piste-reduite"]')?.textContent).toContain(
      'Lecture groupée'
    )
    // Retour au chef d'un clic.
    await cliquer(hote.querySelector('[data-testid="scm-onglet-chef"]'))
    expect(hote.querySelector('.chat-mosaic-window')?.getAttribute('data-conv-id')).toBe('conv-c')
  })

  it('l’onglet d’un lot pas encore peint dans la mosaïque y ouvre son fil', async () => {
    const onOuvrirFil = vi.fn()
    const hote = await monter([fenetre('conv-c', 'plan')], { onOuvrirFil })
    await cliquer(hote.querySelector('[data-testid="scm-onglet-2"]'))
    expect(onOuvrirFil).toHaveBeenCalledWith('conv-l2')
    expect(hote.querySelector('.chat-mosaic-window')?.getAttribute('data-conv-id')).toBe('conv-l2')
  })

  it('fermer la case ferme toute la super conv : le chef et ses lots ouverts', async () => {
    const onClose = vi.fn()
    const hote = await monter([fenetre('conv-c', 'plan'), fenetre('conv-l1', 'ok', 'assistant')], {
      onClose
    })
    await cliquer(hote.querySelector('.chat-mosaic-window-close'))
    expect(onClose.mock.calls.map((c) => c[0]).sort()).toEqual(['conv-c', 'conv-l1'])
  })

  it('un lot dont le chef n’est pas ouvert garde sa propre fenêtre, sans onglets', async () => {
    const hote = await monter([fenetre('conv-l1', 'ok', 'assistant'), fenetre('conv-x', 'autre')])
    expect(hote.querySelectorAll('.chat-mosaic-window')).toHaveLength(2)
    expect(hote.querySelector('.scm-onglets')).toBeNull()
  })
})
