import { describe, expect, it } from 'vitest'
import {
  CADRAGE_VERTICAL,
  HAUT_DE_LA_PHRASE,
  FRAPPE,
  momentDuFilm,
  placeDeLaPhrase,
  retardsDeFrappe,
  SCENES_DU_FILM
} from './teaser-accueil-calcul'
import { usagesDesSkills } from './chat-home-suggestions'

const hautDeLaPhrase = (l: number, h: number): number => placeDeLaPhrase(l, h).haut

describe('placeDeLaPhrase', () => {
  it('fil au format de la vidéo : la phrase se pose dans le bas assombri du film', () => {
    expect(hautDeLaPhrase(1600, 900)).toBeCloseTo(900 * HAUT_DE_LA_PHRASE)
  })

  it('fil plus large : la vidéo est coupée en haut et en bas, la phrase suit son repère', () => {
    // 2000 × 1125 d'image dans 900 de haut : 225 px de coupe, dont 60 % par le haut.
    expect(hautDeLaPhrase(2000, 900)).toBeCloseTo(1125 * HAUT_DE_LA_PHRASE - 225 * CADRAGE_VERTICAL)
  })

  it('fil plus étroit : la vidéo est coupée sur les côtés, seule sa hauteur compte', () => {
    expect(hautDeLaPhrase(700, 720)).toBeCloseTo(hautDeLaPhrase(1280, 720))
  })

  it('fenêtre basse : la phrase garde la place de ses deux lignes', () => {
    expect(hautDeLaPhrase(900, 300)).toBeLessThanOrEqual(300 - 92)
  })
})

// Une skill puis une vue ; l'exemple « /draft … » sous chaque skill. Scènes de 2 s d'abord,
// puis « 2 secondes c trop rapide [...] fais des anim de 5 secondes ».
describe('momentDuFilm', () => {
  it('sous /draft, la phrase de /draft entre avec la carte, puis se disperse avant la scène suivante', () => {
    expect(momentDuFilm(0.1)).toEqual({ etat: 'absente', skill: null })
    expect(momentDuFilm(0.6)).toEqual({ etat: 'presente', skill: '/draft' })
    expect(momentDuFilm(4.2)).toEqual({ etat: 'presente', skill: '/draft' })
    expect(momentDuFilm(4.55)).toEqual({ etat: 'sortante', skill: '/draft' })
    expect(momentDuFilm(4.95)).toEqual({ etat: 'absente', skill: null })
  })

  it('une vue n’a pas de phrase : son nom est dans le film', () => {
    for (const t of [7.5, 17.5, 27.5, 37.5, 47.5]) expect(momentDuFilm(t).etat).toBe('absente')
  })

  it('chaque scène de skill porte sa propre phrase, dans l’ordre du film', () => {
    expect([2, 12, 22, 32, 42].map((t) => momentDuFilm(t).skill)).toEqual([
      '/draft',
      '/scout',
      '/grill',
      '/judge',
      '/arena'
    ])
  })

  it('la boucle de 50 s recommence au même endroit', () => {
    expect(SCENES_DU_FILM).toHaveLength(10)
    expect(momentDuFilm(52)).toEqual(momentDuFilm(2))
  })

  it('chaque skill du film a son usage, en français comme en anglais', () => {
    for (const langue of ['fr', 'en'] as const) {
      const noms = usagesDesSkills(langue).map((u) => u.nom)
      for (const skill of SCENES_DU_FILM) if (skill) expect(noms).toContain(skill)
    }
  })
})

// « l'invocation des phrases ça a plus de sens sans le sorcier, fais-les s'écrire comme un
// humain qui tape au clavier, lettre par lettre ». Entrées qui doivent faire échouer : des lettres
// toutes au même pas (une machine), sans temps après le nom, ou une longue phrase qui déborde la scène.
describe('retardsDeFrappe', () => {
  const ecarts = (t: number[]): number[] => t.slice(1).map((v, i) => v - t[i])
  const mediane = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]

  it('une lettre par touche, chacune après la précédente', () => {
    const { nom, usage } = retardsDeFrappe('/draft', 'six versions')
    expect(nom).toHaveLength(6)
    expect(usage).toHaveLength(11) // l'espace se tape, mais ce n'est pas une lettre
    const tout = [...nom, ...usage]
    expect(ecarts(tout).every((e) => e > 0)).toBe(true)
    expect(nom[0]).toBeGreaterThanOrEqual(FRAPPE.debut)
  })

  it('un pas irrégulier, comme une main', () => {
    const { nom, usage } = retardsDeFrappe('/scout', 'ce projet et ses idées')
    expect(new Set(ecarts([...nom, ...usage])).size).toBeGreaterThan(5)
  })

  it('un temps après le nom de la skill, avant son usage', () => {
    const { nom, usage } = retardsDeFrappe('/grill', 'mon idée de jeu')
    const pas = mediane(ecarts([...nom, ...usage]))
    expect(usage[0] - nom[nom.length - 1]).toBeGreaterThan(2 * pas)
  })

  it('un espace prend une touche de plus', () => {
    const { usage } = retardsDeFrappe('/x', 'ab cd')
    const pas = mediane(ecarts(usage))
    expect(usage[2] - usage[1]).toBeGreaterThan(pas)
  })

  it('une longue phrase tient dans sa scène, au même rythme relatif', () => {
    const { usage } = retardsDeFrappe(
      '/judge',
      'ce que le dernier fil a livré, avec un œil neuf 😀'
    )
    expect(usage[usage.length - 1]).toBeLessThanOrEqual(FRAPPE.max)
  })

  it('toujours la même frappe pour la même phrase : rien ne saute si elle se redessine', () => {
    expect(retardsDeFrappe('/arena', 'trois façons')).toEqual(
      retardsDeFrappe('/arena', 'trois façons')
    )
  })
})
