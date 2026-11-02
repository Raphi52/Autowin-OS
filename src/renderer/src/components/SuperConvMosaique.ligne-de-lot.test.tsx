// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDeLots } from '../../../shared/plan-de-lots'
import { BandeauSuperConv } from './SuperConvMosaique'

/*
 * conv-1387 (2026-10-31) : « je veux pas d'onglets dans ce bloc, je veux que cliquer sur une ligne
 * m'emmène vers la conv en question, et qu'après dans la conv en question il y ait un bouton
 * retour ». Les onglets portaient trois choses que personne d'autre ne disait ; elles passent sur
 * la ligne du lot, seul endroit où le chef voit encore chaque lot :
 *  - conv-1330 : un lot qui travaille porte le spinner de l'app, pas un rond couleur d'accent, qui
 *    voulait dire « fini » dans la liste des fils du thème Nébuleuse ;
 *  - conv-1381 : un lot qui attend ta réponse porte l'animation de question de la liste ;
 *  - conv-1286 : un lot fini depuis ton dernier passage reste signalé tant que tu ne l'as pas ouvert.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : retirer les onglets sans
 * reporter ces repères, ou laisser un lot sans bouton Retour.
 */
const MIN = 60_000
const T0 = Date.UTC(2026, 9, 30, 12, 0)
const PLAN: PlanDeLots = {
  id: 'plan-1',
  chef: 'conv-c',
  cle: 'k',
  titre: 'Super conv',
  parallele: 1,
  plafondTours: 6,
  toursLances: 3,
  statut: 'en-cours',
  avertissements: [],
  creeLe: T0,
  lots: [
    {
      rang: 1,
      titre: 'Moteur',
      demande: 'x',
      fichiers: [],
      etat: 'fait',
      fil: 'conv-l1',
      debut: T0,
      fin: T0 + 4 * MIN
    },
    {
      rang: 2,
      titre: 'Panneau',
      demande: 'x',
      fichiers: [],
      etat: 'fait',
      fil: 'conv-l2',
      debut: T0 + 4 * MIN,
      fin: T0 + 8 * MIN
    },
    {
      rang: 3,
      titre: 'Preuve',
      demande: 'x',
      fichiers: [],
      etat: 'en-cours',
      fil: 'conv-l3',
      debut: T0 + 8 * MIN
    },
    { rang: 4, titre: 'Rangement', demande: 'x', fichiers: [], etat: 'a-faire', apres: [3] }
  ]
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function monter(
  props: Partial<React.ComponentProps<typeof BandeauSuperConv>> = {}
): Promise<HTMLElement> {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  await act(async () => {
    createRoot(hote).render(
      <BandeauSuperConv
        plan={PLAN}
        onglet="chef"
        onOuvrirLot={() => {}}
        onRetour={() => {}}
        {...props}
      />
    )
  })
  return hote
}

const ligne = (hote: HTMLElement, rang: number): HTMLElement =>
  hote.querySelector<HTMLElement>(`[data-testid="scm-piste-${rang}"]`)!

describe('la ligne d’un lot — un lot qui pose une question (conv-1381)', () => {
  it('porte l’animation de question de la liste, et son infobulle le dit', async () => {
    const hote = await monter({ questions: new Set(['conv-l2']) })
    const lot = ligne(hote, 2)
    expect(lot.querySelector('.conversation-state.is-asking')).not.toBeNull()
    expect(lot.querySelector('.scm-nom')?.getAttribute('title')).toContain('Ta réponse attendue')
  })

  it('remplace même le spinner : le lot n’a plus rien à faire sans toi', async () => {
    const hote = await monter({ questions: new Set(['conv-l3']) })
    const lot = ligne(hote, 3)
    expect(lot.querySelector('.conversation-state.is-asking')).not.toBeNull()
    expect(lot.querySelector('.aw-atom')).toBeNull()
  })

  it('n’allume aucune autre ligne, et rien du tout sans question', async () => {
    const hote = await monter({ questions: new Set(['conv-l2']) })
    expect(ligne(hote, 1).querySelector('.is-asking')).toBeNull()
    const sans = await monter()
    expect(sans.querySelector('.is-asking')).toBeNull()
  })
})

/*
 * conv-1387 (2026-10-31) : dans une liste étroite, les heures, le coût et ce que dit le fil ne se
 * dessinent plus, pour tenir une ligne par lot. L'infobulle de la ligne est ce qui les redonne.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : une information retirée de
 * l'infobulle, qui deviendrait alors introuvable dans une case étroite.
 */
describe('la ligne d’un lot — l’infobulle redonne ce qu’une case étroite cache', () => {
  it('dit l’enchaînement, les heures, la durée et ce que dit le fil', async () => {
    const [l1, l2, l3, l4] = PLAN.lots
    const hote = await monter({
      plan: { ...PLAN, lots: [l1, { ...l2, raison: 'Le panneau est livré' }, l3, l4] }
    })
    const infobulle = ligne(hote, 2).querySelector('.scm-nom')?.getAttribute('title') ?? ''
    expect(infobulle).toContain('2 · Panneau')
    expect(infobulle).toContain('à la fin du 1')
    expect(infobulle).toMatch(/\d\d:\d\d → \d\d:\d\d/)
    expect(infobulle).toContain('4 min')
    expect(infobulle).toContain('Le panneau est livré')
  })
})

describe('la ligne d’un lot — son état', () => {
  it('porte le spinner de l’app quand il travaille, seulement là', async () => {
    const hote = await monter()
    expect(ligne(hote, 3).querySelector('.aw-atom')).not.toBeNull()
    for (const rang of [1, 2]) expect(ligne(hote, rang).querySelector('.aw-atom')).toBeNull()
  })

  it('garde un lot fini et pas encore lu signalé, et son infobulle le dit', async () => {
    const hote = await monter({ nonLus: new Set([2]) })
    expect(ligne(hote, 2).classList.contains('is-non-lu')).toBe(true)
    expect(ligne(hote, 2).querySelector('.scm-nom')?.getAttribute('title')).toContain(
      'pas encore lu'
    )
    expect(ligne(hote, 1).classList.contains('is-non-lu')).toBe(false)
  })
})

describe('naviguer dans le plan (conv-1387)', () => {
  it('une ligne mène au lot, sauf celui qui n’a pas encore de conv', async () => {
    const onOuvrirLot = vi.fn()
    const hote = await monter({ onOuvrirLot })
    await act(async () => {
      ligne(hote, 3).querySelector<HTMLElement>('.scm-nom')?.click()
    })
    expect(onOuvrirLot).toHaveBeenCalledWith(3)
    expect(ligne(hote, 4).querySelector<HTMLButtonElement>('.scm-nom')?.disabled).toBe(true)
  })

  it('la conv d’un lot porte Retour, nommé, et il ramène au chef', async () => {
    const onRetour = vi.fn()
    const hote = await monter({ onglet: 3, onRetour })
    const retour = hote.querySelector<HTMLElement>('[data-testid="scm-retour"]')
    expect(retour?.textContent).toContain('Retour')
    expect(retour?.getAttribute('title')).toContain('Super conv')
    await act(async () => {
      retour?.click()
    })
    expect(onRetour).toHaveBeenCalledTimes(1)
  })

  it('le chef n’a pas de Retour', async () => {
    const hote = await monter()
    expect(hote.querySelector('[data-testid="scm-retour"]')).toBeNull()
  })
})

/*
 * conv-1387 (2026-10-31) : « faut un lot par ligne ». Les couloirs (conv-1376) posaient sur une
 * même ligne les lots qui s'enchaînent : les lots 1, 2 et 3 de PLAN, partis l'un après l'autre,
 * tenaient UNE ligne. Chaque ligne est maintenant un lot, et ce clic l'ouvre (conv-1387, Retour).
 * Depuis conv-1396, plus d'axe : le lot pas encore lancé a aussi sa ligne, et l'enchaînement que
 * l'axe montrait par la position s'écrit (« à la fin du 1 », « après 3 »).
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : deux lots sur la même ligne,
 * des lignes rangées par heure de départ au lieu du numéro du lot, ou un enchaînement tu.
 */
describe('le bloc du chef — un lot par ligne', () => {
  // L'heure du plan, pas celle de la machine : la durée d'un lot qui tourne se compte sur elle.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0 + 10 * MIN)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const lignes = (hote: HTMLElement): string[] =>
    [...hote.querySelectorAll('[data-testid="scm-lignes"] > .scm-piste')].map(
      (l) => l.getAttribute('data-testid') ?? ''
    )
  const enchainement = (hote: HTMLElement, rang: number): string =>
    hote.querySelector(`[data-testid="scm-piste-${rang}-enchainement"]`)?.textContent ?? ''

  it('des lots qui s’enchaînent ont chacun leur ligne, et chacune dit après quel lot il part', async () => {
    const hote = await monter()
    expect(lignes(hote)).toEqual(['scm-piste-1', 'scm-piste-2', 'scm-piste-3', 'scm-piste-4'])
    expect([1, 2, 3, 4].map((rang) => enchainement(hote, rang))).toEqual([
      'sans attente',
      'à la fin du 1',
      'à la fin du 2',
      'après 3'
    ])
    // Le lot qui tourne compte sa durée jusqu'à maintenant (2 min), pas une durée figée.
    expect(hote.querySelector('[data-testid="scm-piste-3-duree"]')?.textContent).toBe('2 min')
  })

  it('les lignes suivent le numéro du lot, même parti après le suivant', async () => {
    const [l1, l2, l3, l4] = PLAN.lots
    const hote = await monter({
      plan: {
        ...PLAN,
        lots: [
          { ...l1, debut: T0 + 4 * MIN, fin: T0 + 8 * MIN },
          { ...l2, debut: T0, fin: T0 + 4 * MIN },
          l3,
          l4
        ]
      }
    })
    expect(lignes(hote)).toEqual(['scm-piste-1', 'scm-piste-2', 'scm-piste-3', 'scm-piste-4'])
    expect(enchainement(hote, 1)).toBe('à la fin du 2')
  })
})

/*
 * conv-1396 (2026-10-31) : « dans la vue d'un lot de super conv, remplace aussi la petite barre de
 * temps par la même ligne que dans la liste du chef : état, après quel lot il part, heures, durée et
 * coût ». La vue d'un lot ne garde que « ← Retour » et la ligne du lot, la même que chez le chef.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : une barre de temps encore
 * dessinée, un enchaînement ou des heures absents, ou un titre qui rouvre le lot déjà ouvert.
 */
describe('la vue d’un lot — la même ligne que chez le chef', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0 + 10 * MIN)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('dit l’état, après quel lot il part, ses heures et sa durée, sans barre de temps', async () => {
    const hote = await monter({ onglet: 2 })
    const vue = hote.querySelector<HTMLElement>('[data-testid="scm-piste-reduite"]')!
    expect(vue.querySelector('.scm-voie, .scm-barre')).toBeNull()
    const lot = ligne(hote, 2)
    expect(lot.querySelector('.scm-pastille')?.textContent).toBe('fait')
    expect(hote.querySelector('[data-testid="scm-piste-2-enchainement"]')?.textContent).toBe(
      'à la fin du 1'
    )
    expect(lot.querySelector('.scm-heures')?.textContent).toMatch(/\d\d:\d\d → \d\d:\d\d/)
    expect(hote.querySelector('[data-testid="scm-piste-2-duree"]')?.textContent).toBe('4 min')
    // Une seule ligne : celle du lot ouvert.
    expect(vue.querySelectorAll('.scm-piste')).toHaveLength(1)
  })

  it('compte la durée d’un lot qui tourne jusqu’à maintenant', async () => {
    const hote = await monter({ onglet: 3 })
    expect(hote.querySelector('[data-testid="scm-piste-3-duree"]')?.textContent).toBe('2 min')
    expect(ligne(hote, 3).querySelector('.aw-atom')).not.toBeNull()
  })

  it('n’offre pas de rouvrir le lot déjà ouvert : son titre n’est pas un bouton', async () => {
    const onOuvrirLot = vi.fn()
    const hote = await monter({ onglet: 2, onOuvrirLot })
    const titre = ligne(hote, 2).querySelector<HTMLElement>('.scm-nom')!
    expect(titre.tagName).toBe('SPAN')
    expect(titre.textContent).toContain('2 · Panneau')
    titre.click()
    expect(onOuvrirLot).not.toHaveBeenCalled()
  })
})
