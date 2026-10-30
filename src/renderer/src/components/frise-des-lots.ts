import type { EtatDuLot, LotDuPlan, PlanDeLots } from '../../../shared/plan-de-lots'

/*
 * LA FRISE D'UN PLAN DE LOTS — CALCUL PUR (conv-1305, 2026-10-30).
 *
 * Choix de l'utilisateur au /draft conv-1305 : « implémente 5 et 6 » — la super conv tient dans
 * UNE case de la mosaïque, à onglets ; l'onglet Chef montre la frise PLEINE (une piste par lot sur
 * l'axe des heures, chiffrée), l'onglet d'un lot ne garde que SA piste. Ce module ne fait que la
 * géométrie : où commence et finit l'axe, où tombe chaque barre, où passe « maintenant ». Le rendu
 * est dans `SuperConvMosaique.tsx`.
 *
 * Les heures viennent du plan lui-même (`debut` / `fin` posés par `marquerLance` et
 * `noterFinDeTour`) : aucune estimation. Un lot jamais lancé n'a pas de barre.
 */

/** Un axe plus court que 5 minutes ferait d'un lot de 20 s une barre pleine largeur. */
export const DUREE_MIN_AXE_MS = 5 * 60_000
/** Une barre trop fine (lot de quelques secondes) disparaîtrait : elle garde ce minimum, en %. */
export const LARGEUR_MIN_BARRE = 0.8
/** Nombre de graduations de l'axe, bornes comprises (14:00 · 14:10 · 14:20 · 14:30). */
export const GRADUATIONS = 4

export interface BarreDeLot {
  rang: number
  etat: EtatDuLot
  /** Début de la barre, en % de l'axe. */
  gauche: number
  /** Largeur de la barre, en % de l'axe. */
  largeur: number
}

export interface FriseDuPlan {
  /** Bornes de l'axe, en ms depuis l'époque. */
  debut: number
  fin: number
  /** Position de « maintenant » en %, seulement quand un lot tourne encore. */
  maintenant?: number
  /** Graduations régulières de l'axe : position en % et heure en ms. */
  graduations: Array<{ position: number; ms: number }>
  /** La barre de chaque lot lancé, par rang ; un lot jamais lancé n'en a pas. */
  barres: Map<number, BarreDeLot>
  /** Durée écoulée du plan : du premier départ à maintenant (un lot tourne) ou à la dernière fin. */
  ecoule: number
}

const borne = (n: number): number => Math.min(100, Math.max(0, n))

/** Fin effective d'un lot sur l'axe : sa fin notée, ou maintenant s'il tourne encore. */
function finDuLot(lot: LotDuPlan, maintenant: number): number | undefined {
  if (!lot.debut) return undefined
  if (lot.fin) return lot.fin
  return lot.etat === 'en-cours' ? Math.max(lot.debut, maintenant) : lot.debut
}

/**
 * La frise du plan à l'instant `maintenant`, ou `null` si aucun lot n'est encore parti (rien à
 * placer sur un axe). Pur : même plan et même instant, même frise.
 */
export function calculerFrise(plan: PlanDeLots, maintenant: number): FriseDuPlan | null {
  const lances = plan.lots.filter((l) => typeof l.debut === 'number' && l.debut > 0)
  if (lances.length === 0) return null
  const debut = Math.min(...lances.map((l) => l.debut as number))
  const tourne = plan.lots.some((l) => l.etat === 'en-cours')
  const derniereFin = Math.max(...lances.map((l) => finDuLot(l, maintenant) ?? debut))
  const finReelle = tourne ? Math.max(derniereFin, maintenant) : derniereFin
  const fin = Math.max(finReelle, debut + DUREE_MIN_AXE_MS)
  const duree = fin - debut
  const enPourcent = (ms: number): number => borne(((ms - debut) / duree) * 100)

  const barres = new Map<number, BarreDeLot>()
  for (const lot of lances) {
    const depart = lot.debut as number
    const arrivee = finDuLot(lot, maintenant) ?? depart
    const gauche = enPourcent(depart)
    const largeur = Math.min(
      100 - gauche,
      Math.max(LARGEUR_MIN_BARRE, enPourcent(arrivee) - gauche)
    )
    barres.set(lot.rang, { rang: lot.rang, etat: lot.etat, gauche, largeur })
  }

  const graduations = Array.from({ length: GRADUATIONS }, (_, i) => {
    const part = i / (GRADUATIONS - 1)
    return { position: part * 100, ms: debut + part * duree }
  })

  return {
    debut,
    fin,
    ...(tourne ? { maintenant: enPourcent(maintenant) } : {}),
    graduations,
    barres,
    ecoule: Math.max(0, finReelle - debut)
  }
}

/** Vrai si au moins un lot tourne : la frise doit alors avancer avec l'horloge. */
export function planEnMouvement(plan: PlanDeLots | null | undefined): boolean {
  return !!plan && plan.lots.some((l) => l.etat === 'en-cours')
}

/**
 * L'onglet qu'ouvre un fil dans son plan : « chef », le rang de son lot, ou `null` si le plan ne le
 * connaît pas — un lot d'un ANCIEN plan du même chef (conv-1315) : les onglets du plan récent n'en
 * diraient rien de vrai.
 */
export function ongletDuFil(plan: PlanDeLots, fil: string): number | 'chef' | null {
  if (fil === plan.chef) return 'chef'
  return plan.lots.find((l) => l.fil === fil)?.rang ?? null
}

/**
 * Les lots FINIS depuis que l'utilisateur a regardé leur onglet (ou depuis l'ouverture de la case) :
 * leur onglet reste doré tant qu'il ne l'a pas ouvert. `vusLe[rang]` : dernier passage sur l'onglet.
 */
export function lotsNonLus(
  plan: PlanDeLots,
  vusLe: Readonly<Record<number, number>>,
  ouvertLe: number,
  ongletActif: number | 'chef'
): Set<number> {
  const nonLus = new Set<number>()
  for (const lot of plan.lots) {
    if (!lot.fin || lot.rang === ongletActif) continue
    if (lot.etat === 'en-cours' || lot.etat === 'a-faire') continue
    if (lot.fin > (vusLe[lot.rang] ?? ouvertLe)) nonLus.add(lot.rang)
  }
  return nonLus
}
