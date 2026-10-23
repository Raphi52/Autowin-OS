import { describe, expect, it } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import {
  JOURS,
  MARGE_DE_LA_LOUPE,
  PAR_LIGNE,
  POSTIT_L,
  PAS_MIN_PASTILLE,
  bordsDesColonnes,
  disposerEtages,
  etiquettesDesJours,
  loupeApresMolette,
  loupeCentreeSur,
  placer,
  poidsDesJours,
  riviereDe
} from './carte-riviere'

/**
 * RIVIÈRE DE LA CARTE DU PROJET (/draft conv-1113, « implémente 1+2 »). ENTRÉES QUI DOIVENT FAIRE
 * ÉCHOUER : un fil posé à sa PREMIÈRE demande au lieu de sa dernière, un fil ancien glissé dans la
 * fenêtre, deux post-it à la même heure posés l'un sur l'autre, un état manuel qui survit à une
 * nouvelle demande du fil, une colonne la plus large qui n'est pas celle du foyer, un post-it qui
 * déborde de sa colonne, une molette qui avale le défilement de la page en butée.
 * Frise sans fin (conv-1131, le choix de période retiré) : une molette qui bute avant le plus vieux
 * fil, une frise qui recule sans montrer les fils de ses jours, un fil plus récent perdu au lieu d'être
 * compté, une loupe qui sort du tableau au lieu de faire glisser la frise, une molette qui ne ramène
 * pas à aujourd'hui. Frises longues : une colonne large qui fond, des étiquettes qui se chevauchent.
 * Jour chargé sous la loupe : une case qui reste à 3 de front quand 4 ou 5 la grandiraient, un jour
 * peu chargé qui passe à 4 ou 5 pour rien, un post-it du jour plus petit qu'avec la grille de 3.
 */

const MAINTENANT = new Date(2026, 9, 23, 15, 0).getTime()
const HEURE = 3_600_000
const JOUR = 24 * HEURE

const demande = (
  conversationId: string,
  rang: number,
  statut: StatutDemande,
  debut: number
): DemandeDeLaCarte => ({
  conversationId,
  conversationTitre: `Fil ${conversationId}`,
  rang,
  titre: `demande ${conversationId}-${rang}`,
  statut,
  constat: '—',
  debut
})

function carte(demandes: DemandeDeLaCarte[]): CarteDesBesoins {
  const projet = {
    cle: 'P',
    libelle: 'Projet P',
    nature: 'dossier',
    conversations: 0,
    demandes,
    runsBloques: [],
    comptes: { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 1,
    demandeurs: [],
    demandesJournalisees: 0,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('riviereDe', () => {
  it('pose chaque fil à sa DERNIÈRE demande, avec l’état de cette demande', () => {
    const r = riviereDe(
      carte([
        demande('a', 1, 'en-cours', MAINTENANT - 5 * JOUR),
        demande('a', 2, 'prouve', MAINTENANT - 2 * HEURE)
      ]),
      MAINTENANT
    )
    expect(r.postits).toHaveLength(1)
    const [p] = r.postits
    expect(p.etage).toBe('prouve')
    // Aujourd'hui = jour 13 ; 13 h → un peu plus de la moitié du jour.
    expect(Math.floor(p.t)).toBe(JOURS - 1)
    expect(p.t - (JOURS - 1)).toBeCloseTo(13 / 24, 5)
    expect(r.jours[JOURS - 1].nom).toBe('aujourd’hui')
    expect(r.jours[0].nom).toMatch(/^[a-zé]{3} 10$/u)
  })

  it('compte à part les fils plus anciens que les 14 jours et ceux sans date', () => {
    const r = riviereDe(
      carte([
        demande('vieux', 1, 'prouve', MAINTENANT - 20 * JOUR),
        { ...demande('muet', 1, 'prouve', 0), debut: undefined },
        demande('recent', 1, 'refuse', MAINTENANT - JOUR)
      ]),
      MAINTENANT
    )
    expect(r.postits.map((p) => p.conversationId)).toEqual(['recent'])
    expect(r.horsFenetre).toBe(1)
    expect(r.sansDate).toBe(1)
  })

  it('range les post-it d’un jour en grille de PAR_LIGNE, dans l’ordre des heures', () => {
    const r = riviereDe(
      carte([
        demande('d', 1, 'sans-preuve', MAINTENANT - 1 * HEURE),
        demande('a', 1, 'sans-preuve', MAINTENANT - 4 * HEURE),
        demande('b', 1, 'sans-preuve', MAINTENANT - 3 * HEURE),
        demande('c', 1, 'sans-preuve', MAINTENANT - 2 * HEURE),
        demande('e', 1, 'sans-preuve', MAINTENANT - 4 * JOUR)
      ]),
      MAINTENANT
    )
    const cases = Object.fromEntries(
      r.postits.map((p) => [p.conversationId, [p.rang % PAR_LIGNE, Math.floor(p.rang / PAR_LIGNE)]])
    )
    expect(PAR_LIGNE).toBe(3)
    expect(cases).toEqual({ a: [0, 0], b: [1, 0], c: [2, 0], d: [0, 1], e: [0, 0] })
    expect(r.etages.find((e) => e.cle === 'sans-preuve')).toMatchObject({
      sousLignes: 2,
      nombre: 5
    })
    // Le compte de chaque case : 4 fils aujourd'hui, 1 il y a 4 jours.
    const nombres = r.etages.find((e) => e.cle === 'sans-preuve')!.nombreParJour
    expect(nombres[JOURS - 1]).toBe(4)
    expect(nombres[JOURS - 5]).toBe(1)
    expect(nombres.reduce((a, b) => a + b, 0)).toBe(5)
    // Un étage vide ne réserve aucune ligne de post-it.
    expect(r.etages.find((e) => e.cle === 'a-faire')?.sousLignes).toBe(0)
  })

  it('applique un état posé à la main tant que le fil n’a pas bougé depuis', () => {
    const demandes = [demande('a', 1, 'sans-preuve', MAINTENANT - 3 * HEURE)]
    const pose = { a: { etage: 'prouve' as const, a: MAINTENANT - HEURE } }
    const tenu = riviereDe(carte(demandes), MAINTENANT, pose).postits[0]
    expect(tenu).toMatchObject({ etage: 'prouve', etatPreuve: 'sans-preuve', manuel: pose.a })

    const apres = [...demandes, demande('a', 2, 'refuse', MAINTENANT - 30 * 60_000)]
    const caduc = riviereDe(carte(apres), MAINTENANT, pose).postits[0]
    expect(caduc.etage).toBe('refuse')
    expect(caduc.manuel).toBeUndefined()
  })
})

describe('la loupe', () => {
  it('donne la colonne la plus large au jour du foyer, et elles couvrent toute la largeur', () => {
    for (const foyer of [0.2, 6.5, 13.5]) {
      const bords = bordsDesColonnes(poidsDesJours(foyer))
      const largeurs = bords.slice(1).map((b, j) => b - bords[j])
      expect(largeurs.indexOf(Math.max(...largeurs))).toBe(Math.floor(foyer))
      expect(bords[0]).toBe(0)
      expect(bords[JOURS]).toBe(1)
      expect(largeurs.every((l) => l > 0)).toBe(true)
    }
  })

  it('garde chaque post-it dans la colonne de son jour, plus grand dans la colonne large', () => {
    const bords = bordsDesColonnes(poidsDesJours(13.5))
    const W = 900
    for (const jour of [2, 13]) {
      const g = bords[jour] * W
      const d = bords[jour + 1] * W
      for (let colonne = 0; colonne < PAR_LIGNE; colonne += 1) {
        const { x, k } = placer(jour, colonne, bords, W)
        expect(x - (POSTIT_L * k) / 2).toBeGreaterThanOrEqual(g - 1e-9)
        expect(x + (POSTIT_L * k) / 2).toBeLessThanOrEqual(d + 1e-9)
      }
    }
    const large = placer(13, 0, bords, W)
    const etroit = placer(2, 0, bords, W)
    expect(large.k).toBeGreaterThan(etroit.k * 3)
    expect(large.k).toBeLessThanOrEqual(1)
  })

  it('avance d’une demi-journée par cran et rend la main en butée', () => {
    const l = (foyer: number, recul = 0) => ({ foyer, recul })
    expect(loupeApresMolette(l(13.5), -100, 0)).toEqual(l(13))
    expect(loupeApresMolette(l(6), 3, 0)).toEqual(l(6.5))
    expect(loupeApresMolette(l(JOURS - 0.01), 100, 0)).toBeNull()
    expect(loupeApresMolette(l(13.5), 100, 0)).toBeNull()
    expect(loupeApresMolette(l(0.2), 100, 0)).toEqual(l(0.7))
    // Aucun fil plus vieux que la frise : le premier jour reste la butée, comme avant.
    expect(loupeApresMolette(l(0.5), -100, 5)).toBeNull()
  })
})

describe('la frise sans fin (conv-1131)', () => {
  const l = (foyer: number, recul = 0) => ({ foyer, recul })
  /** Les crans de molette, depuis aujourd'hui ; rend la loupe et le nombre de crans réellement joués. */
  const crans = (n: number, sens: number, joursEnArriere: number, depart = l(JOURS - 0.5)) => {
    let loupe = depart
    let joues = 0
    for (let i = 0; i < n; i += 1) {
      const suivante = loupeApresMolette(loupe, sens, joursEnArriere)
      if (!suivante) break
      loupe = suivante
      joues += 1
    }
    return { loupe, joues }
  }

  it('recule sans butée jusqu’au plus vieux fil, la loupe toujours dans le tableau', () => {
    // Un fil vieux de 400 jours : 800 crans d'une demi-journée pour l'atteindre depuis aujourd'hui.
    let loupe = l(JOURS - 0.5)
    for (let i = 0; i < 2000; i += 1) {
      const suivante = loupeApresMolette(loupe, -100, 400)
      if (!suivante) break
      // Chaque cran recule d'une demi-journée, frise comprise.
      expect(suivante.foyer - suivante.recul).toBeCloseTo(loupe.foyer - loupe.recul - 0.5, 9)
      expect(Number.isInteger(suivante.recul)).toBe(true)
      expect(suivante.foyer).toBeGreaterThanOrEqual(0.5)
      expect(suivante.foyer).toBeLessThanOrEqual(JOURS - 0.5)
      // Tant que la frise glisse, la loupe garde ses jours de marge vers le passé.
      if (suivante.recul > 0 && suivante.recul < 400 - (JOURS - 1))
        expect(suivante.foyer).toBeGreaterThanOrEqual(MARGE_DE_LA_LOUPE)
      loupe = suivante
    }
    // En butée : le jour du plus vieux fil, au bord gauche de la frise.
    expect(loupe).toEqual(l(0.5, 400 - (JOURS - 1)))
    expect(loupeApresMolette(loupe, -100, 400)).toBeNull()
  })

  it('revient jusqu’à aujourd’hui, où la frise reprend sa place', () => {
    const loin = crans(300, -100, 400).loupe
    expect(loin.recul).toBeGreaterThan(100)
    const { loupe } = crans(10_000, 100, 400, loin)
    expect(loupe).toEqual(l(JOURS - 0.5, 0))
  })

  // conv-1135 : « quand je click sur une colonne du passé elle doit se mettre au centre et faire
  // apparaître les plus anciennes ou plus récentes ». ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un clic
  // qui laisse le jour cliqué au bord, une frise qui dépasse aujourd'hui ou le plus vieux fil, un
  // jour cliqué qui n'est plus celui sous la loupe.
  it('un clic sur une colonne la pose au milieu de la frise, voisins des deux côtés', () => {
    const milieu = Math.floor(JOURS / 2)
    // Le jour d'un indice de la frise, compté depuis aujourd'hui : il ne doit pas changer.
    const ilYA = (j: number, recul: number): number => JOURS - 1 - j + recul
    // Depuis aujourd'hui, la colonne de gauche (13 jours avant) : la frise recule de 7 jours.
    const gauche = loupeCentreeSur(l(JOURS - 0.5, 0), 0, 60)
    expect(gauche).toEqual(l(milieu + 0.5, milieu))
    expect(ilYA(Math.floor(gauche.foyer), gauche.recul)).toBe(ilYA(0, 0))
    // Frise reculée, une colonne de droite : elle revient vers aujourd'hui, le jour au milieu.
    const droite = loupeCentreeSur(l(3.5, 20), 11, 60)
    expect(droite).toEqual(l(milieu + 0.5, 16))
    expect(ilYA(Math.floor(droite.foyer), droite.recul)).toBe(ilYA(11, 20))
  })

  it('en butée (aujourd’hui ou le plus vieux fil), le jour cliqué reste sous la loupe, hors du milieu', () => {
    // Près d'aujourd'hui : la frise ne va pas dans le futur.
    expect(loupeCentreeSur(l(JOURS - 0.5, 0), 10, 60)).toEqual(l(10.5, 0))
    expect(loupeCentreeSur(l(3.5, 2), 12, 60)).toEqual(l(10.5, 0))
    // Près du plus vieux fil (60 jours, frise reculée au plus de 47) : pas de jours vides au-delà.
    expect(loupeCentreeSur(l(7.5, 45), 1, 60)).toEqual(l(3.5, 47))
    // Aucun fil plus vieux que la frise : elle ne bouge pas, seule la loupe.
    expect(loupeCentreeSur(l(JOURS - 0.5, 0), 2, 9)).toEqual(l(2.5, 0))
  })

  it('une loupe posée au bord par un clic y reste quand la frise glisse', () => {
    const suivante = loupeApresMolette(l(0.5, 0), -100, 60)!
    expect(suivante.recul).toBe(1)
    expect(suivante.foyer).toBe(1)
  })

  it('recule la frise : pose les fils de ses jours, compte à part les plus anciens et les plus récents', () => {
    const c = carte([
      demande('recent', 1, 'prouve', MAINTENANT - 2 * JOUR),
      demande('vingt', 1, 'refuse', MAINTENANT - 20 * JOUR),
      demande('soixante', 1, 'sans-preuve', MAINTENANT - 60 * JOUR)
    ])
    const r = riviereDe(c, MAINTENANT, {}, JOURS, 10)
    expect(r.postits.map((p) => p.conversationId)).toEqual(['vingt'])
    expect(r.horsFenetre).toBe(1)
    expect(r.plusRecents).toBe(1)
    expect(r.joursEnArriere).toBe(60)
    // La frise finit 10 jours avant aujourd'hui : plus de colonne « aujourd'hui », et le mois s'écrit.
    expect(r.jours.some((j) => j.aujourdhui)).toBe(false)
    expect(r.jours[JOURS - 1].nom).toMatch(/^[a-zé]{3} 13 oct.$/u)
    // Le fil de 20 jours tombe dans la frise, à son jour (20 − 10 jours avant la fin).
    expect(Math.floor(r.postits[0].t)).toBe(JOURS - 1 - 10)
    expect(riviereDe(c, MAINTENANT).joursEnArriere).toBe(60)
    expect(riviereDe(carte([]), MAINTENANT).joursEnArriere).toBe(0)
  })
})

describe('les frises longues', () => {
  const largeursDe = (bords: number[]): number[] => bords.slice(1).map((b, j) => b - bords[j])

  it('à 90 jours, nomme les jours avec leur mois et pose les repères', () => {
    const c = carte([
      demande('recent', 1, 'prouve', MAINTENANT - 2 * JOUR),
      demande('vingt', 1, 'refuse', MAINTENANT - 20 * JOUR),
      demande('soixante', 1, 'sans-preuve', MAINTENANT - 60 * JOUR)
    ])
    const r = riviereDe(c, MAINTENANT, {}, 90)
    expect(r.postits).toHaveLength(3)
    expect(r.horsFenetre).toBe(0)
    expect(r.jours).toHaveLength(90)
    expect(r.bornes).toHaveLength(91)
    expect(r.jours[89].nom).toBe('aujourd’hui')
    // Au-delà de 2 semaines, le nom porte le mois : « jeu 22 » reviendrait trois fois.
    expect(r.jours[88].nom).toMatch(/^[a-zé]{3} 22 oct.$/u)
    expect(r.jours[88].nomCourt).toMatch(/^[a-zé]{3} 22$/u)
    // Repères : le 1er octobre est un début de mois, le lundi 19 un lundi.
    const premier = r.jours.find(
      (j) => new Date(j.debut).getDate() === 1 && new Date(j.debut).getMonth() === 9
    )
    expect(premier).toMatchObject({ repere: 'mois', texteDuRepere: '1 oct.' })
    expect(r.jours.find((j) => j.texteDuRepere === 'lun 19')?.repere).toBe('semaine')
  })

  it('garde au jour du foyer la même part de la largeur à toute longueur de frise', () => {
    const parts = [JOURS, 30, 90].map((n) => {
      const l = largeursDe(bordsDesColonnes(poidsDesJours(n - 3.5, n)))
      expect(l.indexOf(Math.max(...l))).toBe(n - 4)
      return Math.max(...l)
    })
    expect(parts[0]).toBeCloseTo(0.384, 2)
    for (const part of parts) expect(part).toBeCloseTo(parts[0], 2)
    // L'amplitude de 2 semaines est celle des maquettes, inchangée.
    expect(poidsDesJours(13.5)[13]).toBeCloseTo(10, 9)
  })

  it('à 3 mois, un post-it d’une colonne serrée garde sa hauteur sans déborder sur les jours voisins', () => {
    const bords = bordsDesColonnes(poidsDesJours(89.5, 90))
    const W = 810
    const jour = 20
    const g = bords[jour] * W
    const d = bords[jour + 1] * W
    expect(d - g).toBeLessThan(6)
    for (let colonne = 0; colonne < PAR_LIGNE; colonne += 1) {
      const { x, k, kx } = placer(jour, colonne, bords, W)
      expect(k).toBe(0.09)
      expect(kx).toBeLessThan(k)
      expect(x - (POSTIT_L * kx) / 2).toBeGreaterThanOrEqual(g - 1e-9)
      expect(x + (POSTIT_L * kx) / 2).toBeLessThanOrEqual(d + 1e-9)
    }
    // Dans la colonne large, rien ne change : même échelle en largeur et en hauteur.
    const large = placer(89, 0, bords, W)
    expect(large.kx).toBe(large.k)
    expect(large.k).toBeGreaterThan(0.55)
  })

  it('date la frise par des repères qui ne se chevauchent pas, et nomme la colonne large', () => {
    const r = riviereDe(carte([]), MAINTENANT, {}, 90)
    const W = 810
    for (const foyer of [89.5, 40.5, 0.5]) {
      const bords = bordsDesColonnes(poidsDesJours(foyer, 90))
      const etiquettes = etiquettesDesJours(r.jours, bords, W)
      const j = Math.floor(foyer)
      expect(etiquettes[j]).toMatchObject({ texte: r.jours[j].nom, mode: 'nom' })
      // Chaque début de mois porte son repère, sauf contre la loupe : le nom complet d'une colonne
      // voisine (« sam 6 sept. ») y prend la place et donne déjà le mois.
      const mois = r.jours.flatMap((jour, i) => (jour.repere === 'mois' ? [i] : []))
      expect(mois.length).toBeGreaterThanOrEqual(2)
      for (const i of mois) if (Math.abs(i - j) > 3) expect(etiquettes[i]).not.toBeNull()
      const intervalles = etiquettes
        .flatMap((e, i) => {
          if (!e) return []
          const g = bords[i] * W
          const l = bords[i + 1] * W - g
          if (e.mode === 'nom') return [[g, g + l]]
          const w = e.texte.length * e.taillePx * 0.62 + 4
          return [e.ancre === 'fin' ? [bords[i + 1] * W - w, bords[i + 1] * W] : [g, g + w]]
        })
        .sort((a, b) => a[0] - b[0])
      for (let i = 1; i < intervalles.length; i += 1)
        expect(intervalles[i][0]).toBeGreaterThanOrEqual(intervalles[i - 1][1])
    }
  })
})

describe('tout tient dans la hauteur de l’écran', () => {
  const O = { debut: 2, marge: 12, sousLigne: 62, vide: 26 }
  const W = 900
  const etage = (cle: string, lignes: Record<number, number>) => ({
    cle: cle as 'prouve',
    nom: cle,
    aide: '',
    sousLignes: Math.max(0, ...Object.values(lignes)),
    nombre: 1,
    // `lignes` lignes pleines de PAR_LIGNE post-it.
    nombreParJour: Array.from({ length: JOURS }, (_, j) => (lignes[j] ?? 0) * PAR_LIGNE)
  })
  const fin = (e: { haut: number; hauteur: number }[]): number =>
    e[e.length - 1].haut + e[e.length - 1].hauteur

  it('sans hauteur connue, rien n’est tassé : le jour de la loupe garde le pas de sa taille', () => {
    const bords = bordsDesColonnes(poidsDesJours(13.5))
    const [e] = disposerEtages([etage('a', { 13: 2, 2: 4 })], bords, W, 0, O)
    expect(e.pas[13]).toBeCloseTo(62 * placer(13, 0, bords, W).k, 9)
    expect(e.pas[2]).toBe(PAS_MIN_PASTILLE)
    expect(e.hauteur).toBeCloseTo(12 + 2 * e.pas[13] + 4, 9)
  })

  it('tasse tout pour ne jamais dépasser la hauteur offerte, pastilles comprises', () => {
    const bords = bordsDesColonnes(poidsDesJours(13.5))
    const etages = [
      etage('a-faire', {}),
      etage('en-cours', {}),
      etage('refuse', {}),
      etage('sans-preuve', { 2: 20, 13: 5 }),
      etage('prouve', {})
    ]
    for (const H of [400, 250, 160]) {
      const d = disposerEtages(etages, bords, W, H, O)
      expect(fin(d)).toBeLessThanOrEqual(H + 1e-6)
      const e = d[3]
      for (let j = 0; j < JOURS; j += 1)
        expect(Math.ceil(e.nombreParJour[j] / e.colonnes[j]) * e.pas[j]).toBeLessThanOrEqual(
          e.hauteur - e.marge + 1e-6
        )
      // La loupe est tassée, pas les pastilles tant qu'il reste de la place pour elles.
      expect(e.pas[13]).toBeLessThan(62 * placer(13, 0, bords, W).k)
      if (H === 400) expect(e.pas[2]).toBe(PAS_MIN_PASTILLE)
      // Un étage vide garde sa cible de dépôt ; à 160 px, marges et étages vides dépassent à eux
      // seuls (186 px) : tout se réduit alors du même facteur, et l'étage vide reste une cible.
      if (H >= 250) expect(d[0].hauteur).toBe(12 + 26 + 4)
      else expect(d[0].hauteur).toBeGreaterThan(20)
    }
  })

  it('donne la place à l’étage qu’éclaire la loupe', () => {
    const etages = [etage('refuse', { 2: 6 }), etage('prouve', { 13: 6 })]
    const sur = (foyer: number) =>
      disposerEtages(etages, bordsDesColonnes(poidsDesJours(foyer)), W, 300, O)
    const aujourdhui = sur(13.5)
    expect(aujourdhui[1].hauteur).toBeGreaterThan(aujourdhui[0].hauteur * 2)
    const passe = sur(2.5)
    expect(passe[0].hauteur).toBeGreaterThan(passe[1].hauteur * 2)
    expect(fin(aujourdhui)).toBeLessThanOrEqual(300 + 1e-6)
    expect(fin(passe)).toBeLessThanOrEqual(300 + 1e-6)
  })

  it('borne l’échelle d’un post-it au pas de sa ligne', () => {
    const bords = bordsDesColonnes(poidsDesJours(13.5))
    const libre = placer(13, 0, bords, W)
    const tasse = placer(13, 0, bords, W, 0.4)
    expect(libre.k).toBeGreaterThan(0.4)
    expect(tasse.k).toBe(0.4)
    expect(tasse.kx).toBe(0.4)
  })

  /** L'échelle d'un post-it de l'étage `e` au jour `j`, telle que la vue la pose. */
  const echelle = (e: { pas: number[]; colonnes: number[] }, j: number, bords: number[]): number =>
    placer(j, 0, bords, W, e.pas[j] / O.sousLigne, e.colonnes[j]).k

  it('au jour chargé de la loupe, passe à 4 ou 5 de front : ses post-it grandissent, et tout tient', () => {
    const bords = bordsDesColonnes(poidsDesJours(13.5))
    // 42 post-it « À vérifier » aujourd'hui (14 lignes de 3), 3 « Bloqué », 3 « Fait ».
    const etages = [
      etage('refuse', { 13: 1, 4: 2 }),
      etage('sans-preuve', { 13: 14, 2: 5 }),
      etage('prouve', { 13: 1 })
    ]
    const H = 500
    const avant = disposerEtages(etages, bords, W, H, { ...O, jourLoupe: 13, colonnesMax: 3 })
    const apres = disposerEtages(etages, bords, W, H, { ...O, jourLoupe: 13 })
    expect(avant.map((e) => e.colonnes[13])).toEqual([3, 3, 3])
    expect([4, 5]).toContain(apres[1].colonnes[13])
    // Les cases de 3 post-it ou moins ne changent pas : une ligne, à pleine largeur.
    expect(apres[0].colonnes[13]).toBe(3)
    expect(apres[2].colonnes[13]).toBe(3)
    // Hors du jour de la loupe, toujours 3 de front.
    expect(apres[1].colonnes.filter((c, j) => j !== 13 && c !== 3)).toEqual([])
    // Les post-it du jour chargé sont nettement plus grands, et aucun du jour n'est plus petit que
    // le plus petit d'avant.
    expect(echelle(apres[1], 13, bords)).toBeGreaterThan(echelle(avant[1], 13, bords) * 1.1)
    const minAvant = Math.min(...avant.map((e) => echelle(e, 13, bords)))
    for (const e of apres) expect(echelle(e, 13, bords)).toBeGreaterThanOrEqual(minAvant - 1e-9)
    expect(fin(apres)).toBeLessThanOrEqual(H + 1e-6)
    for (const e of apres)
      for (let j = 0; j < JOURS; j += 1)
        expect(Math.ceil(e.nombreParJour[j] / e.colonnes[j]) * e.pas[j]).toBeLessThanOrEqual(
          e.hauteur - e.marge + 1e-6
        )
  })

  it('un jour peu chargé sous la loupe reste à 3 de front : c’est la largeur qui borne', () => {
    const bords = bordsDesColonnes(poidsDesJours(13.5))
    const etages = [etage('sans-preuve', { 13: 2 }), etage('prouve', { 13: 1 })]
    const d = disposerEtages(etages, bords, W, 500, { ...O, jourLoupe: 13 })
    expect(d.map((e) => e.colonnes[13])).toEqual([3, 3])
    expect(echelle(d[0], 13, bords)).toBeCloseTo(placer(13, 0, bords, W).k, 9)
  })

  it('à 4 et 5 de front, chaque post-it reste dans la colonne de son jour', () => {
    const bords = bordsDesColonnes(poidsDesJours(13.5))
    const g = bords[13] * W
    const d = bords[14] * W
    for (const c of [4, 5])
      for (let colonne = 0; colonne < c; colonne += 1) {
        const { x, kx } = placer(13, colonne, bords, W, 1, c)
        expect(x - (124 * kx) / 2).toBeGreaterThanOrEqual(g - 1e-9)
        expect(x + (124 * kx) / 2).toBeLessThanOrEqual(d + 1e-9)
      }
    // Plus de colonnes = post-it plus étroits, à hauteur libre.
    expect(placer(13, 0, bords, W, 1, 5).k).toBeLessThan(placer(13, 0, bords, W, 1, 3).k)
  })
})
