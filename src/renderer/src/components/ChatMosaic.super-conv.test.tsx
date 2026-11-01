// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDeLots, ReponsePlansDeLots } from '../../../shared/plan-de-lots'
import { ChatMosaic, type ChatMosaicWindow, type LienDeLotMosaique } from './ChatMosaic'

/*
 * conv-1305 (/draft, « implémente 5 et 6 ») : une super conv ouverte dans la mosaïque ne fait
 * qu'UNE case. conv-1387 retire les onglets : la frise pleine du chef mène à chaque lot par sa
 * ligne, et le lot ouvert (sa piste, son vrai fil, sa vraie saisie) ramène au chef par Retour.
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

let appels: unknown[][] = []
let plan: PlanDeLots
/** Ce que rend le geste « phrases » : la phrase de chaque lot, lue par le processus principal. */
let phrases: Record<number, string> = {}
/** Pose un refus sur les gestes qui écrivent. */
let refus: string | undefined
let signaler: (e: { type: string; scope: string }) => void = () => {}
const abonnes = new Set<(e: { type: string; scope: string }) => void>()

beforeEach(() => {
  appels = []
  abonnes.clear()
  signaler = (e) => {
    for (const ecouter of [...abonnes]) ecouter(e)
  }
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
    // Plusieurs abonnés, comme le vrai canal : le bloc du chef écoute aussi pour ses anciens plans
    // (conv-1394), et un seul écouteur gardé faisait taire la relecture du plan montré.
    onAppEvent: (ecouter: typeof signaler) => {
      abonnes.add(ecouter)
      return () => abonnes.delete(ecouter)
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
  it('le chef et ses lots ouverts ne font qu’UNE case, sans onglets ; les autres fils gardent la leur', async () => {
    const hote = await monter([
      fenetre('conv-c', 'plan'),
      fenetre('conv-l1', 'Livré : un seul appel lit tous les plans.', 'assistant'),
      fenetre('conv-x', 'autre chose')
    ])
    expect(hote.querySelectorAll('.chat-mosaic-window')).toHaveLength(2)
    expect(hote.querySelector('.chat-mosaic')?.getAttribute('data-count')).toBe('2')
    expect(hote.querySelector('[role="tablist"]')).toBeNull()
    // L'en-tête de la case reprend le titre de la conv, comme toutes les autres cases.
    expect(
      hote.querySelector('[data-conv-id="conv-c"] .chat-mosaic-window-title')?.textContent
    ).toBe('Titre conv-c')
    // Un lot jamais lancé n'a pas de fil : sa ligne ne s'ouvre pas.
    expect(
      hote.querySelector<HTMLButtonElement>('[data-testid="scm-piste-3"] .scm-nom')?.disabled
    ).toBe(true)
    expect(
      hote.querySelector('[data-testid="scm-piste-2"]')?.classList.contains('scm-etat--echec')
    ).toBe(true)
  })

  it('le chef montre une ligne pleine largeur par lot : état, enchaînement, heures, durée, Relancer', async () => {
    phrases = { 1: 'Livré : un seul appel lit tous les plans.' }
    const hote = await monter([
      fenetre('conv-c', 'plan'),
      fenetre('conv-l1', 'Livré : un seul appel lit tous les plans.', 'assistant')
    ])
    const frise = hote.querySelector('[data-testid="scm-frise"]')
    expect(frise).not.toBeNull()
    expect(hote.querySelector('[data-testid="scm-chiffre-faits"]')?.textContent).toContain('1/3')
    // Plus d'axe des heures (conv-1396) : les trois lots, lancés ou non, sont des lignes de la même
    // liste, dans l'ordre des numéros, sans position ni largeur calculée.
    expect(hote.querySelector('.scm-axe, .scm-couloir')).toBeNull()
    const lignes = [
      ...hote.querySelectorAll<HTMLElement>('[data-testid="scm-lignes"] > .scm-piste')
    ]
    expect(lignes.map((l) => l.getAttribute('data-testid'))).toEqual([
      'scm-piste-1',
      'scm-piste-2',
      'scm-piste-3'
    ])
    expect(lignes.every((l) => !l.style.left && !l.style.width)).toBe(true)
    const cellules = (rang: number): string[] =>
      [...hote.querySelectorAll(`[data-testid="scm-piste-${rang}"] > *`)].map(
        (c) => c.textContent ?? ''
      )
    // Titre, état, enchaînement, heures, durée, coût (pas encore lu), phrase, geste.
    const [titre1, etat1, enchainement1, heures1, duree1, , phrase1] = cellules(1)
    expect([titre1, etat1, enchainement1, duree1, phrase1]).toEqual([
      '1 · Lecture groupée',
      'fait',
      'sans attente',
      '4 min',
      'Livré : un seul appel lit tous les plans.'
    ])
    expect(heures1).toMatch(/^\d\d:\d\d → \d\d:\d\d$/)
    // Le lot en échec dit pourquoi, et porte « Relancer le 2 » au bout de sa ligne.
    expect(cellules(2).slice(1, 2).concat(cellules(2).slice(4))).toEqual([
      'échec',
      '9 min',
      '',
      'le fil se déclare bloqué : test rouge',
      'Relancer le 2'
    ])
    // Le lot jamais lancé : son enchaînement, sans heures ni durée.
    expect(cellules(3).slice(0, 5)).toEqual(['3 · Rangement', 'à faire', 'après 2', '', ''])
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

  it('la ligne d’un lot montre SON fil, SA saisie et sa seule piste ; Retour ramène au chef', async () => {
    const hote = await monter([
      fenetre('conv-c', 'plan'),
      fenetre('conv-l1', 'Livré : un seul appel lit tous les plans.', 'assistant')
    ])
    await cliquer(hote.querySelector('[data-testid="scm-piste-1"] .scm-nom'))
    expect(hote.querySelector('.chat-mosaic-window')?.getAttribute('data-conv-id')).toBe('conv-l1')
    expect(hote.querySelector('[data-testid="composer-conv-l1"]')).not.toBeNull()
    expect(hote.querySelector('[data-testid="scm-frise"]')).toBeNull()
    expect(hote.querySelector('[data-testid="scm-piste-reduite"]')?.textContent).toContain(
      'Lecture groupée'
    )
    await cliquer(hote.querySelector('[data-testid="scm-retour"]'))
    expect(hote.querySelector('.chat-mosaic-window')?.getAttribute('data-conv-id')).toBe('conv-c')
    expect(hote.querySelector('[data-testid="scm-retour"]')).toBeNull()
  })

  it('la ligne d’un lot pas encore peint dans la mosaïque y ouvre son fil', async () => {
    const onOuvrirFil = vi.fn()
    const hote = await monter([fenetre('conv-c', 'plan')], { onOuvrirFil })
    await cliquer(hote.querySelector('[data-testid="scm-piste-2"] .scm-nom'))
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

  it('un lot dont le chef n’est pas ouvert garde sa propre fenêtre, sans bloc de plan', async () => {
    const hote = await monter([fenetre('conv-l1', 'ok', 'assistant'), fenetre('conv-x', 'autre')])
    expect(hote.querySelectorAll('.chat-mosaic-window')).toHaveLength(2)
    expect(hote.querySelector('.scm-bandeau')).toBeNull()
  })
})
