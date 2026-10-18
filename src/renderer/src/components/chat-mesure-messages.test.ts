import { beforeEach, describe, expect, it } from 'vitest'
import { mesurerMessagesRendus } from './chat-mesure-messages'
import {
  memoriserPositionLecture,
  positionLectureMemorisee,
  restaurerPositionLecture
} from './position-lecture'

/**
 * Defaut rapporte conv-307 (2026-10-17) : « des fois quand j'arrive sur une conv qui a ecrit,
 * l'ecran devient eclectique, le scroll erratique ». Mesure dans l'instance cachee : a la reprise
 * d'un fil quitte au milieu, le fil sautait a CHAQUE image entre 620 et 27 282 px — deux positions
 * symetriques autour de la position retenue. `mesurerMessagesRendus` rendait le haut des messages
 * par rapport au haut VISIBLE du fil au lieu du debut du contenu : la cible dependait donc de la
 * position courante (cible = 2 x retenue - courante).
 */

function stockageMemoire(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v)
  } as Storage
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: stockageMemoire() },
    configurable: true,
    writable: true
  })
})

/**
 * Fil a mise en page REELLE : le conteneur est pose a `hautEcran` px du haut de la fenetre, et la
 * position a l'ecran de chaque message depend de `scrollTop`, comme dans un navigateur.
 */
function filMisEnPage(hautsDansLeContenu: number[], hauteur: number, hautEcran = 120) {
  const fil = {
    scrollTop: 0,
    scrollHeight: hauteur,
    clientHeight: 600,
    clientTop: 0,
    isConnected: true,
    defilements: 0,
    scrollTo(options: { top: number }) {
      fil.defilements += 1
      fil.scrollTop = Math.max(0, Math.min(options.top, fil.scrollHeight - fil.clientHeight))
    },
    getBoundingClientRect: () => ({ top: hautEcran }),
    querySelectorAll: () =>
      hautsDansLeContenu.map((haut) => ({
        getBoundingClientRect: () => ({ top: hautEcran + haut - fil.scrollTop })
      }))
  }
  return fil
}

describe('mesure des messages rendus', () => {
  it('rend le haut de chaque message DANS le contenu, quelle que soit la position courante', () => {
    const fil = filMisEnPage([0, 900, 2400], 6000)
    fil.scrollTop = 1500
    const enHaut = mesurerMessagesRendus(fil as unknown as HTMLElement)
    fil.scrollTop = 4000
    const enBas = mesurerMessagesRendus(fil as unknown as HTMLElement)
    expect(enHaut).toEqual([{ offsetTop: 0 }, { offsetTop: 900 }, { offsetTop: 2400 }])
    expect(enBas).toEqual(enHaut)
  })
})

describe('reprise de lecture de bout en bout', () => {
  it('quitte au milieu, rouvert en bas : le fil revient a la position retenue SANS va-et-vient', () => {
    const fil = filMisEnPage([0, 1200, 2600, 4100, 5300], 7000)
    fil.scrollTop = 2750
    memoriserPositionLecture('conv-a', fil, mesurerMessagesRendus(fil as unknown as HTMLElement))
    const retenue = positionLectureMemorisee('conv-a')
    expect(retenue?.ancre).toEqual({ index: 2, decalage: 150 })

    // A la reouverture, le navigateur a pose le fil en bas avant la reprise.
    fil.scrollTop = fil.scrollHeight - fil.clientHeight
    fil.defilements = 0
    const positions: number[] = []
    let atterri: boolean | undefined
    restaurerPositionLecture(
      fil,
      retenue!,
      (suite) => {
        positions.push(fil.scrollTop)
        suite()
      },
      20,
      (ok) => {
        atterri = ok
      },
      () => mesurerMessagesRendus(fil as unknown as HTMLElement)
    )
    expect(fil.scrollTop).toBe(2750)
    expect(atterri).toBe(true)
    expect(fil.defilements).toBe(1)
    expect(new Set(positions)).toEqual(new Set([2750]))
  })

  it('une ancre retenue AVANT la correction est ignoree : on retombe sur le px, qui etait juste', () => {
    // Ancre ecrite par l'ancienne mesure (relative au haut visible) : decalage = 2 x top - haut.
    window.localStorage.setItem(
      'autowin.chat.positionLecture',
      JSON.stringify({ 'conv-a': { top: 2750, hauteur: 7000, ancre: { index: 4, decalage: 200 } } })
    )
    expect(positionLectureMemorisee('conv-a')).toEqual({ top: 2750, hauteur: 7000 })
  })
})
