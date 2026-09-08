import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  OPERATION_ENTREE_EN_GEL,
  OPERATION_SORTIE_DE_GEL,
  surveillerFenetreInjoignable
} from './gel-fenetre'
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
        on() {},
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
        on() {},
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
