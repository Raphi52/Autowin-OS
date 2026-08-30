import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLE_POSITION_LECTURE,
  memoriserPositionLecture,
  positionLectureMemorisee,
  oublierPositionLecture,
  restaurerPositionLecture
} from './position-lecture'

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

describe('mémoire de position par conversation', () => {
  it('retient la position d’une conversation et la rend telle quelle', () => {
    memoriserPositionLecture('conv-a', { scrollTop: 820, scrollHeight: 4000, clientHeight: 600 })
    expect(positionLectureMemorisee('conv-a')).toEqual({ top: 820, hauteur: 4000 })
  })

  it('ne mélange pas deux conversations', () => {
    memoriserPositionLecture('conv-a', { scrollTop: 820, scrollHeight: 4000, clientHeight: 600 })
    memoriserPositionLecture('conv-b', { scrollTop: 120, scrollHeight: 4000, clientHeight: 600 })
    expect(positionLectureMemorisee('conv-a')?.top).toBe(820)
    expect(positionLectureMemorisee('conv-b')?.top).toBe(120)
  })

  it('n’enregistre RIEN quand le lecteur est déjà collé au bas (le défaut reste « suivre la queue »)', () => {
    memoriserPositionLecture('conv-a', { scrollTop: 820, scrollHeight: 4000, clientHeight: 600 })
    memoriserPositionLecture('conv-a', { scrollTop: 3400, scrollHeight: 4000, clientHeight: 600 })
    expect(positionLectureMemorisee('conv-a')).toBeUndefined()
  })

  it('oublie la position sur demande', () => {
    memoriserPositionLecture('conv-a', { scrollTop: 820, scrollHeight: 4000, clientHeight: 600 })
    oublierPositionLecture('conv-a')
    expect(positionLectureMemorisee('conv-a')).toBeUndefined()
  })

  it('un stockage corrompu ne fait pas planter la lecture', () => {
    window.localStorage.setItem(CLE_POSITION_LECTURE, '{pas du json')
    expect(positionLectureMemorisee('conv-a')).toBeUndefined()
  })
})

type FauxFil = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  isConnected: boolean
  scrollTo(options: { top: number }): void
}

function fauxFil(hauteur: number): FauxFil {
  return {
    scrollTop: 0,
    scrollHeight: hauteur,
    clientHeight: 600,
    isConnected: true,
    scrollTo(options) {
      this.scrollTop = Math.max(0, Math.min(options.top, this.scrollHeight - this.clientHeight))
    }
  }
}

function boucle(frames: number): { schedule: (cb: () => void) => void; tourner: () => void } {
  const file: (() => void)[] = []
  return {
    schedule: (cb) => void file.push(cb),
    tourner: () => {
      for (let i = 0; i < frames && file.length; i++) {
        const suivant = file.shift()
        suivant?.()
      }
    }
  }
}

describe('restauration de la position', () => {
  it('replace le fil sur la position mémorisée MALGRÉ un re-rendu qui remet en haut', () => {
    const fil = fauxFil(4000)
    const { schedule, tourner } = boucle(60)
    let atterri: boolean | undefined
    restaurerPositionLecture(fil, { top: 820, hauteur: 4000 }, schedule, 20, (ok) => {
      atterri = ok
    })
    // Le markdown se re-rend : le navigateur repose le fil en haut sous nos pieds.
    fil.scrollTop = 0
    tourner()
    expect(fil.scrollTop).toBe(820)
    expect(atterri).toBe(true)
  })

  it('CLAMPE une position devenue hors bornes (fil raccourci) au lieu de rester en haut', () => {
    const fil = fauxFil(1000)
    const { schedule, tourner } = boucle(60)
    restaurerPositionLecture(fil, { top: 820, hauteur: 4000 }, schedule, 20)
    tourner()
    expect(fil.scrollTop).toBe(400)
  })

  it('rend la main si le lecteur bouge lui-même APRÈS que la position soit tenue', () => {
    const fil = fauxFil(4000)
    const file: (() => void)[] = []
    const schedule = (cb: () => void): void => void file.push(cb)
    restaurerPositionLecture(fil, { top: 820, hauteur: 4000 }, schedule, 20)
    file.shift()?.()
    file.shift()?.()
    expect(fil.scrollTop).toBe(820)
    // Le lecteur remonte de lui-même, sans re-rendu : on ne doit plus le contrarier.
    fil.scrollTop = 2000
    while (file.length) file.shift()?.()
    expect(fil.scrollTop).toBe(2000)
  })
})

describe('ancre structurelle : un tour écrit pendant l’absence ne doit pas déplacer la lecture', () => {
  it('retient le message affiché en haut, pas seulement le px', () => {
    memoriserPositionLecture(
      'conv-a',
      { scrollTop: 820, scrollHeight: 4000, clientHeight: 600 },
      [{ offsetTop: 0 }, { offsetTop: 300 }, { offsetTop: 800 }, { offsetTop: 1500 }]
    )
    expect(positionLectureMemorisee('conv-a')?.ancre).toEqual({ index: 2, decalage: 20 })
  })

  it('repose l’œil sur le MÊME message quand les hauteurs au-dessus ont changé', () => {
    // Le fil a grossi/rétréci au-dessus : le message n°2 est désormais à 1120 px, plus à 800.
    const messages = [{ offsetTop: 0 }, { offsetTop: 420 }, { offsetTop: 1120 }, { offsetTop: 2000 }]
    const fil = fauxFil(6000)
    let landed: boolean | undefined
    restaurerPositionLecture(
      fil,
      { top: 820, hauteur: 4000, ancre: { index: 2, decalage: 20 } },
      (callback) => callback(),
      20,
      (ok) => {
        landed = ok
      },
      () => messages
    )
    expect(fil.scrollTop).toBe(1140)
    expect(landed).toBe(true)
  })

  it('retombe sur le px quand le message ancré n’existe plus', () => {
    const fil = fauxFil(6000)
    restaurerPositionLecture(
      fil,
      { top: 820, hauteur: 4000, ancre: { index: 9, decalage: 20 } },
      (callback) => callback(),
      20,
      undefined,
      () => [{ offsetTop: 0 }]
    )
    expect(fil.scrollTop).toBe(820)
  })
})
