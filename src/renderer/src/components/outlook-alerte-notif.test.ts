// @vitest-environment happy-dom
/**
 * L'ALERTE elle-meme : la popup construite, et le son reellement CABLE.
 *
 * Le son ne peut pas s'ENTENDRE dans un test — aucun moteur audio ici. Ce que ce fichier prouve,
 * c'est le cablage : deux oscillateurs crees, connectes, demarres et arretes, avec une enveloppe
 * (un gain qui s'ouvre et se ferme d'un coup produit un clic audible, pas une note).
 *
 * Et surtout la regle qui compte le jour ou Windows refuse les popups : le son part QUAND MEME.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

/**
 * Le module est RECHARGE a chaque test, a dessein : `jouerSon` garde son contexte audio en cache
 * (un seul moteur pour toute la session, c'est voulu), donc un module importe une fois retiendrait
 * le moteur simule du PREMIER test et ignorerait tous les suivants.
 */
type Notif = typeof import('./outlook-alerte-notif')
let mod: Notif
async function charger(): Promise<Notif> {
  vi.resetModules()
  mod = await import('./outlook-alerte-notif')
  return mod
}

const alerte = { id: 'm1', contact: 'Zoé', sujet: 'Devis', apercu: 'Bonjour' }

/** Un moteur audio SIMULE qui note ce qu'on lui demande. */
function faussAudio(): { demarres: number[]; arretes: number[]; connectes: number } {
  const trace = { demarres: [] as number[], arretes: [] as number[], connectes: 0 }
  class Contexte {
    state = 'running'
    currentTime = 0
    destination = {}
    createOscillator(): unknown {
      return {
        type: '',
        frequency: { value: 0 },
        connect: () => void trace.connectes++,
        start: (t: number) => void trace.demarres.push(t),
        stop: (t: number) => void trace.arretes.push(t)
      }
    }
    createGain(): unknown {
      return {
        gain: {
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined
        },
        connect: () => void trace.connectes++
      }
    }
  }
  vi.stubGlobal('AudioContext', Contexte)
  return trace
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('alerte popup + son', () => {
  it('joue DEUX notes, connectees et bornees dans le temps', async () => {
    const trace = faussAudio()
    const { jouerSon } = await charger()
    expect(jouerSon()).toBe(true)
    expect(trace.demarres.length).toBe(2)
    expect(trace.arretes.length).toBe(2)
    // La seconde note commence APRES la premiere : deux notes, pas un accord.
    expect(trace.demarres[1]).toBeGreaterThan(trace.demarres[0])
    // Chaque note s'arrete apres son depart : aucun oscillateur laisse ouvert.
    expect(trace.arretes[0]).toBeGreaterThan(trace.demarres[0])
    expect(trace.connectes).toBe(4)
  })

  it('sans moteur audio, ne casse pas : il le DIT', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { jouerSon } = await charger()
    expect(jouerSon()).toBe(false)
  })

  it('la popup porte le contact, l’objet, l’apercu et l’identifiant du message', async () => {
    const vues: Array<[string, unknown]> = []
    class NotifStub {
      static permission = 'granted'
      constructor(titre: string, options: unknown) {
        vues.push([titre, options])
      }
    }
    vi.stubGlobal('Notification', NotifStub)
    const { afficherPopup } = await charger()
    expect(afficherPopup(alerte)).toBe(true)
    expect(vues[0][0]).toBe('Zoé — Devis')
    // `tag` = l'identifiant : une alerte rejouee REMPLACE la precedente au lieu d'en empiler deux.
    expect(vues[0][1]).toEqual({ body: 'Bonjour', tag: 'm1' })
  })

  it('popups REFUSEES par le systeme : le son part quand meme', async () => {
    class NotifRefus {
      static permission = 'denied'
      constructor() {
        throw new Error('ne devrait pas etre construite')
      }
    }
    vi.stubGlobal('Notification', NotifRefus)
    const trace = faussAudio()
    const { afficherPopup, alerter } = await charger()
    expect(afficherPopup(alerte)).toBe(false)
    alerter(alerte)
    expect(trace.demarres.length).toBe(2)
  })
})
