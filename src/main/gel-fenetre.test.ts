import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  OPERATION_ENTREE_EN_GEL,
  OPERATION_REANIMATION_REFUSEE,
  OPERATION_SORTIE_DE_GEL,
  surveillerFenetreInjoignable
} from './gel-fenetre'
import { OPERATION_REANIMATION } from './gel-reanimation'
import type { Gel } from '../shared/gel-detector'

function fenetreFactice(): EventEmitter {
  return new EventEmitter()
}

describe('surveillerFenetreInjoignable', () => {
  it('journalise DES l entree en gel, pour laisser une trace meme si l app est tuee', () => {
    const ecrits: Gel[] = []
    const fenetre = fenetreFactice()
    surveillerFenetreInjoignable(
      fenetre,
      (gel) => ecrits.push(gel),
      () => 1_700_000_000_000
    )

    fenetre.emit('unresponsive')

    // Aucun `responsive` : c'est exactement le cas ou l'utilisateur tue l'application.
    expect(ecrits).toEqual([
      {
        ts: new Date(1_700_000_000_000).toISOString(),
        blocageMs: 0,
        operation: OPERATION_ENTREE_EN_GEL,
        cause: 'boucle-tenue'
      }
    ])
  })

  it('rend la duree REELLE quand la fenetre revient', () => {
    const ecrits: Gel[] = []
    const fenetre = fenetreFactice()
    const horloge = [1_000, 22_000]
    surveillerFenetreInjoignable(
      fenetre,
      (gel) => ecrits.push(gel),
      () => horloge.shift() ?? 0
    )

    fenetre.emit('unresponsive')
    fenetre.emit('responsive')

    expect(ecrits.map((gel) => gel.operation)).toEqual([
      OPERATION_ENTREE_EN_GEL,
      OPERATION_SORTIE_DE_GEL
    ])
    expect(ecrits[1].blocageMs).toBe(21_000)
  })

  it('n invente aucune ligne quand la fenetre repond sans avoir gele', () => {
    const ecrits: Gel[] = []
    const fenetre = fenetreFactice()
    surveillerFenetreInjoignable(
      fenetre,
      (gel) => ecrits.push(gel),
      () => 0
    )

    fenetre.emit('responsive')

    expect(ecrits).toEqual([])
  })

  it('retire ses ecouteurs quand on arrete la surveillance', () => {
    const ecrits: Gel[] = []
    const fenetre = fenetreFactice()
    const arreter = surveillerFenetreInjoignable(
      fenetre,
      (gel) => ecrits.push(gel),
      () => 0
    )

    arreter()
    fenetre.emit('unresponsive')

    expect(ecrits).toEqual([])
    expect(fenetre.listenerCount('unresponsive')).toBe(0)
  })

  /**
   * Mesure du 2026-09-08 15:09 : 5,6 s d'interface injoignable, puis un processus d'affichage NEUF.
   * Sans cette ligne, le journal ne garde qu'un `fenetre-revenue` trompeur et un manque de memoire
   * ressemble exactement a une boucle sans fin.
   */
  it('journalise la MORT du processus d affichage, avec son motif et la duree deja vecue', () => {
    const ecrits: Gel[] = []
    const contenu = new EventEmitter()
    const fenetre = Object.assign(fenetreFactice(), { webContents: contenu })
    const horloge = [1_000, 6_600]
    surveillerFenetreInjoignable(
      fenetre,
      (gel) => ecrits.push(gel),
      () => horloge.shift() ?? 6_600
    )

    fenetre.emit('unresponsive')
    contenu.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 })

    expect(ecrits.at(-1)).toEqual({
      ts: new Date(6_600).toISOString(),
      blocageMs: 5_600,
      operation: 'renderer:processus-disparu:oom',
      cause: 'boucle-tenue'
    })
  })
})

/**
 * LE CABLAGE, pas seulement la mecanique. Le module peut etre parfait et n'ecouter aucune fenetre :
 * c'est exactement l'etat dans lequel etait l'application avant le 2026-09-08. Brancher un vrai
 * `BrowserWindow` demanderait un lancement d'Electron ; on lit donc la source du process principal,
 * comme le font deja les controles de demarrage.
 */
describe('la fenetre principale est reellement surveillee', () => {
  it('branche la surveillance sur mainWindow dans le process principal', async () => {
    const { sourceProcessPrincipal } = await import('./source-process-principal.test-helpers')
    const source = sourceProcessPrincipal()

    expect(source).toContain("import { surveillerFenetreInjoignable } from './gel-fenetre'")
    expect(source).toContain('surveillerFenetreInjoignable(mainWindow)')
  })
})

describe('reanimation automatique de la fenetre', () => {
  it('recharge la fenetre quand le gel depasse le seuil, et le journalise', () => {
    const gels: Array<{ operation: string; blocageMs: number }> = []
    let injoignable: (() => void) | undefined
    let recharges = 0
    let planifiee: (() => void) | undefined
    const fenetre = {
      on(evenement: string, ecouteur: () => void) {
        if (evenement === 'unresponsive') injoignable = ecouteur
      },
      webContents: {
        on() {
          // Ce double ne s'abonne a rien : le test n'observe que les rechargements.
        },
        reloadIgnoringCache() {
          recharges += 1
        }
      }
    }
    let horloge = 1_000
    surveillerFenetreInjoignable(
      fenetre as never,
      (gel) => gels.push({ operation: gel.operation, blocageMs: gel.blocageMs }),
      () => horloge,
      { seuilMs: 20_000, delaiEntreDeuxMs: 120_000 },
      (action) => {
        planifiee = action
      }
    )
    injoignable?.()
    horloge = 26_000
    planifiee?.()

    expect(recharges).toBe(1)
    expect(gels.map((gel) => gel.operation)).toContain('renderer:fenetre-reanimee')
    expect(gels.at(-1)?.blocageMs).toBe(25_000)
  })

  it('ne recharge pas une lenteur passagere', () => {
    let injoignable: (() => void) | undefined
    let recharges = 0
    let planifiee: (() => void) | undefined
    const fenetre = {
      on(evenement: string, ecouteur: () => void) {
        if (evenement === 'unresponsive') injoignable = ecouteur
      },
      webContents: {
        on() {
          // Ce double ne s'abonne a rien : le test n'observe que les rechargements.
        },
        reloadIgnoringCache() {
          recharges += 1
        }
      }
    }
    let horloge = 1_000
    surveillerFenetreInjoignable(
      fenetre as never,
      () => {},
      () => horloge,
      { seuilMs: 20_000, delaiEntreDeuxMs: 120_000 },
      (action) => {
        planifiee = action
      }
    )
    injoignable?.()
    horloge = 4_000
    planifiee?.()

    expect(recharges).toBe(0)
  })
})

describe('remise en route apres la mort du processus d affichage', () => {
  it('recharge la fenetre quand son processus disparait', () => {
    let disparition: ((...args: unknown[]) => void) | undefined
    let rechargements = 0
    const fenetre = {
      on() {
        // Fenetre doublee : aucun evenement n'est relaye dans ce scenario.
      },
      webContents: {
        on(evenement: string, ecouteur: (...args: unknown[]) => void) {
          if (evenement === 'render-process-gone') disparition = ecouteur
        },
        reload() {
          rechargements += 1
        }
      }
    }
    surveillerFenetreInjoignable(
      fenetre as never,
      () => {},
      () => 1_000
    )
    disparition?.({}, { reason: 'crashed' })

    expect(rechargements).toBe(1)
  })
})

/**
 * LE DEFAUT QUI ANNULAIT TOUTE LA REANIMATION — mesure du 2026-09-08.
 *
 * Electron ne signale pas le gel UNE fois : il RE-EMET `unresponsive` tant que la fenetre ne
 * repond pas (10:40:43, 10:41:01, 10:41:19, 10:41:36 — 17 a 19 s d'intervalle). Chaque re-emission
 * repassait par `surInjoignable`, qui reposait `debut` a l'instant courant : la duree de gel
 * repartait de zero, ne franchissait jamais les 20 s du seuil, et `gels.jsonl` portait 14 entrees
 * `fenetre-injoignable` pour ZERO `fenetre-reanimee`. Le chrono doit demarrer a la PREMIERE alerte.
 */
describe('le chrono du gel ne repart pas a chaque re-emission de l alerte', () => {
  function bancDEssai(): {
    injoignable: () => void
    revenue: () => void
    horloge: (t: number) => void
    tirerMinuteur: () => void
    gels: Array<{ operation: string; blocageMs: number }>
    recharges: () => number
  } {
    let injoignable: (() => void) | undefined
    let revenue: (() => void) | undefined
    let recharges = 0
    const planifiees: Array<() => void> = []
    const gels: Array<{ operation: string; blocageMs: number }> = []
    let instant = 0
    const fenetre = {
      on(evenement: string, ecouteur: () => void) {
        if (evenement === 'unresponsive') injoignable = ecouteur
        if (evenement === 'responsive') revenue = ecouteur
      },
      webContents: {
        on() {
          /* le banc ne branche que `unresponsive` et `responsive` */
        },
        reloadIgnoringCache() {
          recharges += 1
        }
      }
    }
    surveillerFenetreInjoignable(
      fenetre as never,
      (gel) => gels.push({ operation: gel.operation, blocageMs: gel.blocageMs }),
      () => instant,
      { seuilMs: 20_000, delaiEntreDeuxMs: 120_000 },
      (action) => {
        planifiees.push(action)
      }
    )
    return {
      injoignable: () => injoignable?.(),
      revenue: () => revenue?.(),
      horloge: (t) => {
        instant = t
      },
      tirerMinuteur: () => planifiees.shift()?.(),
      gels,
      recharges: () => recharges
    }
  }

  it('trois alertes espacees de 18 s finissent par declencher UNE reanimation', () => {
    const banc = bancDEssai()
    banc.horloge(0)
    banc.injoignable()
    banc.horloge(18_000)
    banc.injoignable()
    banc.horloge(20_000)
    banc.tirerMinuteur()

    expect(banc.recharges()).toBe(1)
    expect(banc.gels.map((gel) => gel.operation)).toContain(OPERATION_REANIMATION)
    // Duree comptee depuis la PREMIERE alerte, pas depuis la derniere.
    expect(banc.gels.at(-1)?.blocageMs).toBe(20_000)
  })

  it('n arme qu UN seul minuteur par episode de gel', () => {
    const banc = bancDEssai()
    banc.horloge(0)
    banc.injoignable()
    banc.horloge(18_000)
    banc.injoignable()
    banc.horloge(36_000)
    banc.injoignable()
    banc.horloge(40_000)
    banc.tirerMinuteur()
    // Les minuteurs surnumeraires, s'il y en avait, rechargeraient une seconde fois.
    banc.tirerMinuteur()
    banc.tirerMinuteur()

    expect(banc.recharges()).toBe(1)
  })

  it('repart proprement sur un NOUVEL episode apres le retour de la fenetre', () => {
    const banc = bancDEssai()
    banc.horloge(0)
    banc.injoignable()
    banc.horloge(5_000)
    banc.revenue()
    banc.horloge(100_000)
    banc.injoignable()
    banc.horloge(105_000)
    banc.tirerMinuteur()

    // 5 s de gel dans le second episode : sous le seuil, donc aucune recharge.
    expect(banc.recharges()).toBe(0)
    expect(banc.gels.at(-1)?.operation).toBe(`${OPERATION_REANIMATION_REFUSEE}:sous-le-seuil`)
  })

  it('dit POURQUOI il a refuse de reanimer, au lieu de sortir en silence', () => {
    const banc = bancDEssai()
    banc.horloge(0)
    banc.injoignable()
    banc.horloge(4_000)
    banc.tirerMinuteur()

    expect(banc.gels.map((gel) => gel.operation)).toContain(
      `${OPERATION_REANIMATION_REFUSEE}:sous-le-seuil`
    )
    expect(banc.recharges()).toBe(0)
  })
})
