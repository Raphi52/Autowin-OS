import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import {
  creerMarche,
  ENTREE,
  SEJOUR_MIN_S,
  type Consigne,
  type DonneesMarche,
  type MetierPoste
} from './quartier-marche'

const D = donnees as unknown as DonneesMarche
const IMAGE = 1 / 30

/** Un générateur reproductible : une marche qui échoue doit échouer de la même façon au relancement. */
function graine(n: number): () => number {
  let g = n
  return () => {
    g = (g * 16807) % 2147483647
    return (g & 0xfffffff) / 0x10000000
  }
}

const travail = (metier: MetierPoste): Consigne => ({ metier, pose: '', partir: false })

describe('la carte de la Falaise', () => {
  const m = creerMarche(D, graine(5))

  it('relie tous les postes entre eux', () => {
    const P = D.postes
    for (let i = 0; i < P.length; i++)
      for (let j = 0; j < P.length; j++) {
        if (i === j) continue
        const c = m.chemin([P[i].x, P[i].y], [P[j].x, P[j].y], null, true)
        const f = c[c.length - 1]
        expect(Math.hypot(f[0] - P[j].x, f[1] - P[j].y), `${i} vers ${j}`).toBeLessThan(10)
      }
  }, 30_000)

  it('pose chaque poste et l’entrée sur le sol', () => {
    for (const p of D.postes) expect(m.taille(p.x, p.y), `${p.x},${p.y}`).toBeGreaterThan(0)
    expect(m.libre(ENTREE[0], ENTREE[1])).toBe(true)
  })

  it('a au moins un poste par métier demandé', () => {
    const metiers = new Set(D.postes.map((p) => p.me))
    for (const me of [
      'commandes',
      'runs',
      'lire',
      'chercher',
      'brain',
      'web',
      'modifier',
      'tester',
      'ecran',
      'publier',
      'tickets',
      'messages',
      'taches',
      'sql',
      'bain',
      'meditation'
    ])
      expect(metiers.has(me), me).toBe(true)
  })

  it('emprunte la passerelle entre le hangar et la bibliothèque', () => {
    const P = D.postes
    const c = m.chemin([P[5].x, P[5].y], [P[8].x, P[8].y], null, true)
    expect(c.some((q) => q.e === D.esc.findIndex((e) => e.nom === 'P'))).toBe(true)
  })
})

describe('un tanuki suit son agent', () => {
  it('entre par le sable et attend sa première action (D14)', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', { metier: null, pose: '', partir: false })
    for (let i = 0; i < 90; i++) m.avance(IMAGE)
    expect(w.etat).toBe('attend')
    expect(m.libre(w.x, w.y)).toBe(true)
  })

  it('va au poste du métier réel et y travaille', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('lire'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    expect(w.etat).toBe('poste')
    expect(w.metierIci).toBe('lire')
    expect(D.postes[w.poste as number].me).toBe('lire')
  })

  it('ne change pas de poste pour une action courte (D15)', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('commandes'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    w.consigne = travail('lire')
    for (let i = 0; i < 30 * (SEJOUR_MIN_S - 2); i++) m.avance(IMAGE)
    expect(w.metierIci).toBe('commandes')
    expect(w.etat).toBe('poste')
    for (let i = 0; i < 30 * 4; i++) m.avance(IMAGE)
    expect(w.etat).toBe('va')
  })

  it('prend la pose de l’état réel, là où il est', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('modifier'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    w.consigne = { metier: null, pose: 'at', partir: false }
    m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'etat', nom: 'at', metierIci: 'modifier' })
    w.consigne = { metier: null, pose: '', partir: false }
    m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'poste', nom: '' })
  })

  it('descend au bain quand il a fini, et s’assied à côté si les baquets sont pris', () => {
    const m = creerMarche(D, graine(5))
    const fini: Consigne = { metier: 'bain', pose: 'ba', partir: false }
    const liste = [0, 1, 2, 3].map((i) => m.ajouter(`a${i}`, fini))
    for (let i = 0; i < 30 * 200 && liste.some((w) => w.etat !== 'etat'); i++) m.avance(IMAGE)
    const poses = liste.map((w) => w.nom).sort()
    expect(poses).toEqual(['as', 'ba', 'ba', 'ba'])
  })

  it('fait attendre côte à côte ceux qui n’ont pas de baquet, jamais en tas', () => {
    const m = creerMarche(D, graine(5))
    const fini: Consigne = { metier: 'bain', pose: 'ba', partir: false }
    const liste = Array.from({ length: 12 }, (_, i) => m.ajouter(`a${i}`, fini))
    for (let i = 0; i < 30 * 300 && liste.some((w) => w.etat !== 'etat'); i++) m.avance(IMAGE)
    const dehors = liste.filter((w) => w.nom === 'as')
    expect(dehors).toHaveLength(9)
    for (const w of dehors)
      for (const o of dehors)
        if (o !== w)
          expect(Math.hypot(o.x - w.x, (o.y - w.y) / D.sp), `${w.id} ${o.id}`).toBeGreaterThan(30)
  })

  const medite: Consigne = { metier: 'meditation', pose: 'me', partir: false }

  it('part méditer en tailleur dans la salle quand il réfléchit', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', medite)
    for (let i = 0; i < 30 * 120 && w.etat !== 'etat'; i++) m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'etat', nom: 'me', metierIci: 'meditation' })
    expect(D.postes[w.poste as number].me).toBe('meditation')
  })

  it('ne s’assied pas en tailleur à son poste en attendant de partir (D15)', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('commandes'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    w.consigne = medite
    for (let i = 0; i < 30 * 2; i++) m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'poste', nom: '', metierIci: 'commandes' })
    for (let i = 0; i < 30 * (SEJOUR_MIN_S + 2); i++) m.avance(IMAGE)
    expect(w.etat).toBe('va')
  })

  it('médite juste devant la salle quand les cinq places sont prises', () => {
    const m = creerMarche(D, graine(5))
    const liste = Array.from({ length: 7 }, (_, i) => m.ajouter(`a${i}`, medite))
    for (let i = 0; i < 30 * 300 && liste.some((w) => w.etat !== 'etat'); i++) m.avance(IMAGE)
    expect(liste.every((w) => w.nom === 'me')).toBe(true)
    expect(liste.filter((w) => w.poste !== null)).toHaveLength(5)
  })

  it('reprend le travail dès que son agent repart', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', medite)
    for (let i = 0; i < 30 * 120 && w.etat !== 'etat'; i++) m.avance(IMAGE)
    w.consigne = travail('lire')
    for (let i = 0; i < 30 * 200 && w.metierIci !== 'lire'; i++) m.avance(IMAGE)
    expect(w).toMatchObject({ metierIci: 'lire', nom: '' })
  })

  it('repart par l’entrée et quitte la scène', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', { metier: null, pose: '', partir: false })
    m.avance(IMAGE)
    w.consigne = { metier: null, pose: '', partir: true }
    for (let i = 0; i < 30 * 120 && m.T.length > 0; i++) m.avance(IMAGE)
    expect(m.T).toHaveLength(0)
  })
})

describe('dix minutes avec huit agents réalistes', () => {
  it('ne sort jamais du sol, ne se croise jamais dans une volée, et tout le monde avance', () => {
    const alea = graine(7)
    const m = creerMarche(D, alea)
    const metiers: MetierPoste[] = [
      'commandes',
      'commandes',
      'runs',
      'lire',
      'lire',
      'chercher',
      'modifier',
      'tester',
      'ecran',
      'web',
      'brain',
      'publier',
      'messages'
    ]
    const liste = Array.from({ length: 8 }, (_, i) => m.ajouter(`a${i}`, travail('lire')))
    let dehors = 0
    let croisements = 0
    let saut = 0
    for (let i = 0; i < 30 * 600; i++) {
      // Un agent change d'outil toutes les 25 s en moyenne : la cadence mesurée sur ce poste.
      for (const w of liste)
        if (alea() < IMAGE / 25) w.consigne = travail(metiers[Math.floor(alea() * metiers.length)])
      const avant = liste.map((w) => [w.x, w.y])
      m.avance(IMAGE)
      liste.forEach((w, k) => {
        if (!m.libre(w.x, w.y)) dehors++
        saut = Math.max(saut, Math.hypot(w.x - avant[k][0], w.y - avant[k][1]))
        for (const o of liste)
          if (o !== w && w.sur >= 0 && o.sur === w.sur && o.sens !== w.sens) croisements++
      })
    }
    expect(dehors).toBe(0)
    expect(croisements).toBe(0)
    expect(saut).toBeLessThan(4)
    for (const w of liste) expect(w.nb, w.id).toBeGreaterThan(4)
  }, 60_000)
})
