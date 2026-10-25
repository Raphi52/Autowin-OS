import { describe, expect, it } from 'vitest'
import {
  MARGE_AIMANT,
  aimanterSurPiste,
  cibleAimant,
  cranCale,
  cranCourant,
  cranLePlusProche,
  cranSousPointeur,
  depuisPiste,
  dureeGlisse,
  hautDansLeContenu,
  hautDeVuePour,
  moletteFaitDefiler,
  placerEtiquettes,
  poignee,
  positionGlissee,
  reserveDeLaCarte,
  resumerTexte,
  scrollTopApresGlisse,
  scrollTopSousPointeur,
  seuilMolette,
  versPiste,
  voisinsDeLaVue,
  type Repere
} from './ascenseur-du-fil'

/*
 * Ascenseur du fil à crans (draft conv-1114, choix « 1 · Dépli en place ») : un cran par message de
 * l'utilisateur, la vue s'y AIMANTE. Fil de 4 000 px vu dans 800 px.
 */
const geo = (scrollTop: number) => ({ scrollTop, clientHeight: 800, scrollHeight: 4000 })

const toi = (numero: number, haut: number): Repere => ({
  haut,
  hauteur: 40,
  role: 'user',
  numero,
  heure: `14:${10 + numero}`,
  texte: `message ${numero}`
})
const crans = [toi(1, 20), toi(2, 900), toi(3, 1700), toi(4, 3900)]

describe('aimant — la vue se cale sur TON message, à 10 px du haut', () => {
  it('pose le haut de la bulle à MARGE_AIMANT du haut de la vue, borné au fil', () => {
    expect(hautDeVuePour(crans[1], geo(0))).toBe(900 - MARGE_AIMANT)
    expect(hautDeVuePour(crans[0], geo(0))).toBe(10)
    // Dernier message trop bas pour monter en haut : la vue s'arrête au bas du fil.
    expect(hautDeVuePour(crans[3], geo(0))).toBe(4000 - 800)
  })

  it('molette : aimante seulement si un message est TOUT PRÈS du haut de la vue', () => {
    const seuil = seuilMolette(800)
    // 40 px au-dessus du message 2 : aimanté.
    expect(cibleAimant(geo(850), crans, seuil)).toBe(890)
    // Au milieu d'une longue réponse : la molette reste libre.
    expect(cibleAimant(geo(1300), crans, seuil)).toBeNull()
  })

  // conv-1139 (2026-10-25) : « quand je scroll down ça remonte tout seul ». Mesuré par sonde sur le
  // fil réel, 4 essais sur 4 : un cran vers le bas posait la vue 20 px APRÈS ton message, et
  // l'aimant la ramenait en arrière sur lui. L'aimant suit maintenant le SENS de la molette.
  it('molette vers le bas : la vue n’est JAMAIS ramenée en arrière sur un message dépassé', () => {
    const seuil = seuilMolette(800)
    // 30 px après le message 2 en descendant : la vue reste où la molette l'a posée.
    expect(cibleAimant(geo(920), crans, seuil, 1)).toBeNull()
    // 40 px avant le message 2 en descendant : aimanté vers l'avant, dans le sens du geste.
    expect(cibleAimant(geo(850), crans, seuil, 1)).toBe(890)
  })

  it('molette vers le haut : aimantée seulement sur un message au-dessus', () => {
    const seuil = seuilMolette(800)
    // 30 px après le message 2 en remontant : il est au-dessus, la vue y monte.
    expect(cibleAimant(geo(920), crans, seuil, -1)).toBe(890)
    // 40 px avant le message 2 en remontant : il est en dessous, la vue n'y redescend pas.
    expect(cibleAimant(geo(850), crans, seuil, -1)).toBeNull()
  })

  it('ne rejoue pas l’aimant quand la vue est déjà calée', () => {
    expect(cibleAimant(geo(890), crans, seuilMolette(800))).toBeNull()
    expect(cranCale(geo(890), crans)?.numero).toBe(2)
    expect(cranCale(geo(900), crans)).toBeNull()
  })

  it('glisser : le relâchement va TOUJOURS au message le plus proche', () => {
    expect(cibleAimant(geo(1300), crans, Number.POSITIVE_INFINITY)).toBe(1690)
    expect(cibleAimant(geo(1200), crans, Number.POSITIVE_INFINITY)).toBe(890)
  })

  it('le seuil de la molette suit la hauteur de la vue, plafonné', () => {
    expect(seuilMolette(800)).toBe(72)
    expect(seuilMolette(300)).toBe(45)
  })

  it('aucun message à toi : rien à aimanter', () => {
    expect(cibleAimant(geo(850), [], 72)).toBeNull()
    expect(cranCourant(geo(850), [])).toBeNull()
  })
})

describe('piste — le fil entier rapporté à la hauteur de la barre', () => {
  it('convertit dans les deux sens, avec 12 px de marge en haut et en bas', () => {
    // Barre de 424 px : piste de 400 px, 1 px de piste = 10 px de fil.
    expect(versPiste(0, 4000, 424)).toBe(12)
    expect(versPiste(2000, 4000, 424)).toBe(212)
    expect(versPiste(4000, 4000, 424)).toBe(412)
    expect(depuisPiste(212, 4000, 424)).toBe(2000)
    expect(depuisPiste(-50, 4000, 424)).toBe(0)
    expect(depuisPiste(9999, 4000, 424)).toBe(4000)
  })

  it('la poignée couvre la vue, avec une hauteur minimale pour rester saisissable', () => {
    expect(poignee(geo(2000), 424)).toEqual({ haut: 212, hauteur: 80 })
    expect(poignee({ scrollTop: 0, clientHeight: 100, scrollHeight: 100_000 }, 424).hauteur).toBe(
      20
    )
  })

  it('un glisser de la poignée déplace le fil à l’échelle de la piste, borné', () => {
    expect(scrollTopApresGlisse(1000, 30, geo(1000), 424)).toBe(1300)
    expect(scrollTopApresGlisse(1000, -500, geo(1000), 424)).toBe(0)
    expect(scrollTopApresGlisse(1000, 900, geo(1000), 424)).toBe(3200)
  })
})

describe('crans — lequel est visé, lequel est à l’écran', () => {
  it('trouve le cran le plus proche d’un point du fil', () => {
    expect(cranLePlusProche(1250, crans)?.numero).toBe(2)
    expect(cranLePlusProche(1350, crans)?.numero).toBe(3)
  })

  it('survol : un cran n’est visé que si le pointeur est à 6 px de lui sur la piste', () => {
    // Message 2 à 900 px de fil = 102 px de piste.
    expect(cranSousPointeur(104, crans, 4000, 424)?.numero).toBe(2)
    expect(cranSousPointeur(115, crans, 4000, 424)).toBeNull()
  })

  it('message à l’écran : le dernier dont le haut est passé sous la ligne d’aimant', () => {
    expect(cranCourant(geo(0), crans)?.numero).toBe(1)
    expect(cranCourant(geo(890), crans)?.numero).toBe(2)
    expect(cranCourant(geo(1500), crans)?.numero).toBe(2)
  })
})

describe('aperçu — début du message sur une ligne', () => {
  it('replie les espaces et coupe proprement', () => {
    expect(resumerTexte('  Corrige   aussi\nla popup  ')).toBe('Corrige aussi la popup')
    expect(resumerTexte('a'.repeat(200), 20)).toBe(`${'a'.repeat(19)}…`)
  })
})

describe('mesure — par la mise en page, pas par l’écran', () => {
  /*
   * Mesuré dans l'app (sonde conv-1114) : un clic sur le cran 3 posait la bulle à 7 px du haut au
   * lieu de 10. Les messages entrent avec `.fade-in` (translateY 3 px, theme.css) ; mesurée pendant
   * l'animation, la position à l'écran était décalée d'autant. La mise en page, elle, ne bouge pas.
   */
  type Boite = { offsetTop: number; offsetParent: Boite | null; clientTop?: number }
  const comme = (boite: Boite): HTMLElement => boite as unknown as HTMLElement

  it('fil non positionné : remonte jusqu’au parent commun et retire la place du fil', () => {
    const chat: Boite = { offsetTop: 0, offsetParent: null }
    const fil: Boite = { offsetTop: 72, offsetParent: chat, clientTop: 1 }
    const bulle: Boite = { offsetTop: 72 + 1 + 900, offsetParent: chat }
    expect(hautDansLeContenu(comme(bulle), comme(fil))).toBe(900)
  })

  it('fil positionné : le haut est déjà dans son repère', () => {
    const fil: Boite = { offsetTop: 72, offsetParent: null, clientTop: 0 }
    const rangee: Boite = { offsetTop: 880, offsetParent: fil }
    const bulle: Boite = { offsetTop: 20, offsetParent: comme(rangee) as unknown as Boite }
    expect(hautDansLeContenu(comme(bulle), comme(fil))).toBe(900)
  })
})

describe('butées — une molette qui ne fait plus rien défiler n’ouvre pas la carte', () => {
  /*
   * Demande conv-1114 : « quand je suis tout en haut ou tout en bas et que je continue de scroll
   * elle doit pas apparaître ». Sonde dans l'app avant correction : la carte s'ouvrait aux deux
   * butées, fil immobile (scrollTop 0 et 12 532 sur 12 532).
   */
  it('tout en haut, vers le haut : rien', () => {
    expect(moletteFaitDefiler(-120, geo(0))).toBe(false)
  })
  it('tout en bas, vers le bas : rien (à 1 px près, arrondi d’affichage)', () => {
    expect(moletteFaitDefiler(120, geo(3200))).toBe(false)
    expect(moletteFaitDefiler(120, geo(3199.5))).toBe(false)
  })
  it('depuis une butée, dans l’autre sens : la carte s’ouvre', () => {
    expect(moletteFaitDefiler(120, geo(0))).toBe(true)
    expect(moletteFaitDefiler(-120, geo(3200))).toBe(true)
  })
  it('au milieu : toute molette verticale compte, une molette horizontale non', () => {
    expect(moletteFaitDefiler(-3, geo(1500))).toBe(true)
    expect(moletteFaitDefiler(0, geo(1500))).toBe(false)
  })
})

describe('glisse de l’aimant — image par image, quel que soit le réglage du système', () => {
  /*
   * Sonde conv-1114 : `scrollTo({ behavior: 'smooth' })` sautait d'un coup (4 668 -> 4 618 px en une
   * image) sur ce poste, qui a la réduction des animations active. La vue glisse donc elle-même.
   */
  it('part du départ, décélère, et arrive exactement sur la cible', () => {
    expect(positionGlissee(4668, -50, 0, 200)).toBe(4668)
    const milieu = positionGlissee(4668, -50, 100, 200)
    // Décélération : à mi-temps, déjà bien plus de la moitié du chemin.
    expect(milieu).toBeLessThan(4668 - 25)
    expect(milieu).toBeGreaterThan(4618)
    expect(positionGlissee(4668, -50, 200, 200)).toBe(4618)
    expect(positionGlissee(4668, -50, 999, 200)).toBe(4618)
  })
  it('un petit recalage est bref, un long saut plus long mais plafonné', () => {
    expect(dureeGlisse(50)).toBeGreaterThanOrEqual(160)
    expect(dureeGlisse(50)).toBeLessThan(dureeGlisse(2000))
    expect(dureeGlisse(-8000)).toBe(dureeGlisse(8000))
    expect(dureeGlisse(100_000)).toBeLessThanOrEqual(420)
  })
})

describe('barre-curseur — on l’attrape et on clique n’importe où', () => {
  /*
   * Demande conv-1114 : « la barre doit slider et je dois pouvoir clicker n'importe où dessus ».
   * Avant : seul un appui sur la poignée (20 px) faisait glisser, et un clic allait au message le
   * plus proche, pas à l'endroit cliqué. Barre de 424 px : piste 400, cadre 80, course 320 px pour
   * 3 200 px de fil (1 px de piste = 10 px de fil).
   */
  it('le cadre se centre sur la souris, borné aux deux bouts', () => {
    expect(scrollTopSousPointeur(212, geo(0), 424)).toBe(1600)
    expect(scrollTopSousPointeur(52, geo(0), 424)).toBe(0)
    expect(scrollTopSousPointeur(0, geo(0), 424)).toBe(0)
    expect(scrollTopSousPointeur(424, geo(0), 424)).toBe(3200)
  })

  it('en glissant, s’arrête sur un cran à moins de 6 px de piste', () => {
    // 1 650 : à 4 px de piste de la bulle 3 (calée à 1 690) — aimantée.
    expect(aimanterSurPiste(1650, geo(0), crans, 424)).toEqual({ scrollTop: 1690, cran: crans[2] })
    // 1 600 : à 9 px de piste — libre.
    expect(aimanterSurPiste(1600, geo(0), crans, 424)).toEqual({ scrollTop: 1600, cran: null })
  })

  it('sans tes messages, rien ne s’aimante', () => {
    expect(aimanterSurPiste(1650, geo(0), [], 424)).toEqual({ scrollTop: 1650, cran: null })
  })
})

describe('place de la carte — elle décale la conversation, elle ne la masque pas', () => {
  /*
   * Demande conv-1114 : « ça doit décaler la conv et pas la masquer ». Mesuré dans l'app (1 150,
   * 1 400 et 1 800 px) : le fil n'a que 12 px de marge de chaque côté, la carte de 72 px recouvrait
   * 60 px de texte. La marge droite s'élargit donc à la carte + 8 px d'écart pendant qu'elle est
   * ouverte ; une marge déjà plus large ne bouge pas.
   */
  it('élargit une marge étroite jusqu’à la carte plus l’écart', () => {
    expect(reserveDeLaCarte(12, 72)).toBe(80)
  })
  it('ne touche pas une marge déjà assez large', () => {
    expect(reserveDeLaCarte(120, 72)).toBe(120)
  })
  it('une marge illisible compte pour zéro', () => {
    expect(reserveDeLaCarte(Number.NaN, 72)).toBe(80)
  })
})

describe('aperçus pendant le défilement — tous à la fois, sans chevauchement', () => {
  /*
   * Demande conv-1114 : « pendant que je scroll je veux voir toutes les popups que je vois quand je
   * hover mes msg ». Carte ouverte : un aperçu par message, au plus près de son cran.
   */
  it('des crans éloignés gardent leur aperçu en face', () => {
    expect(placerEtiquettes([50, 150, 300], 40, 0, 500)).toEqual([50, 150, 300])
  })
  it('deux crans proches : leurs aperçus s’écartent autour de leur milieu', () => {
    expect(placerEtiquettes([100, 110], 40, 0, 500)).toEqual([85, 125])
  })
  it('un groupe se resserre de proche en proche, sans chevaucher le suivant', () => {
    const c = placerEtiquettes([100, 110, 140, 400], 40, 0, 500) as number[]
    for (let i = 1; i < c.length; i++) expect(c[i] - c[i - 1]).toBeGreaterThanOrEqual(40)
    expect(c[3]).toBe(400)
  })
  it('reste dans la barre, en haut comme en bas', () => {
    expect(placerEtiquettes([5, 10], 40, 0, 500)).toEqual([20, 60])
    expect(placerEtiquettes([495, 498], 40, 0, 500)).toEqual([440, 480])
  })
  it('trop d’aperçus pour la hauteur : refusé (on passera en compact)', () => {
    expect(placerEtiquettes([10, 20, 30], 40, 0, 100)).toBeNull()
    expect(placerEtiquettes([], 40, 0, 100)).toEqual([])
  })
})

describe('aperçus pendant le défilement — seulement au-dessus et en dessous de là où tu es', () => {
  /*
   * Demande conv-1114, capture à l'appui (24 aperçus empilés sur un long fil) : « ça affiche tout
   * quand je scroll, ça doit afficher que celui d'en bas et celui au-dessus de là où je suis ».
   * Au-dessus : ton dernier message passé (celui dont tu lis la réponse). En dessous : le suivant.
   */
  it('au milieu d’une réponse : le message lu et le suivant', () => {
    const v = voisinsDeLaVue(geo(1500), crans)
    expect(v.avant?.numero).toBe(2)
    expect(v.apres?.numero).toBe(3)
  })
  it('et le message d’avant celui que tu lis (demande conv-1114 : trois aperçus au lieu de deux)', () => {
    expect(voisinsDeLaVue(geo(1500), crans).precedent?.numero).toBe(1)
    expect(voisinsDeLaVue(geo(2000), crans).precedent?.numero).toBe(2)
  })
  it('au premier message lu, il n’y a pas de message d’avant', () => {
    expect(voisinsDeLaVue(geo(500), crans).precedent).toBeNull()
    expect(voisinsDeLaVue(geo(0), crans).precedent).toBeNull()
  })
  it('vue calée sur ton message : lui au-dessus, le suivant en dessous', () => {
    const v = voisinsDeLaVue(geo(890), crans)
    expect(v.avant?.numero).toBe(2)
    expect(v.apres?.numero).toBe(3)
  })
  it('tout en haut : rien au-dessus', () => {
    const v = voisinsDeLaVue(geo(0), crans)
    expect(v.avant).toBeNull()
    expect(v.apres?.numero).toBe(1)
  })
  it('après ton dernier message : rien en dessous', () => {
    const v = voisinsDeLaVue({ scrollTop: 3900, clientHeight: 800, scrollHeight: 5000 }, crans)
    expect(v.avant?.numero).toBe(4)
    expect(v.apres).toBeNull()
  })
  it('sans tes messages : aucun aperçu', () => {
    expect(voisinsDeLaVue(geo(1500), [])).toEqual({ precedent: null, avant: null, apres: null })
  })
})
