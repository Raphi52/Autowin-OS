import { useEffect, useState } from 'react'
import type { Langue } from '../../../shared/langue'
import {
  relancerLot,
  type EtatDuLot,
  type LotDuPlan,
  type PlanDeLots
} from '../../../shared/plan-de-lots'
import { formaterDate } from '../langue'
import {
  auPluriel,
  traduireChatFilsEtLots,
  type CleChatFilsEtLots
} from '../textes-ecrans/chat-fils-et-lots'
import { formatDuration, summarizeConversationCost, type CostRow } from './conversation-cost'

/*
 * LES MESURES D'UN PLAN DE LOTS, PARTAGÉES PAR SES DEUX ÉCRANS (conv-1305, 2026-10-30) : le tableau
 * des lots au-dessus de la saisie du chef (`TableauDesLots.tsx`) et la frise de la super conv dans
 * la mosaïque (`SuperConvMosaique.tsx`). Déplacées telles quelles depuis TableauDesLots.tsx — un
 * fichier de composant ne peut exporter que des composants (react-refresh/only-export-components) —
 * pour qu'il n'existe qu'UNE façon de lire le coût, la durée et le droit de relancer d'un lot.
 */

/*
 * RÉDUIRE LE TABLEAU (conv-1283, 2026-10-29) : posé au-dessus de la zone de saisie, il prenait
 * jusqu'à 340 px pendant tout le plan, sans moyen de le replier. Réduit, il ne garde que sa ligne
 * de titre et de statut. Retenu sur le poste, par plan : sans cela, il se rouvrait à chaque
 * changement de fil ou rechargement.
 */
const CLE_REDUITS = 'autowin:plans-de-lots-reduits'
const REDUITS_MAX = 100

export function lireReduits(): string[] {
  try {
    const brut = JSON.parse(window.localStorage.getItem(CLE_REDUITS) ?? '[]') as unknown
    return Array.isArray(brut) ? brut.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function retenirReduits(ids: string[]): void {
  try {
    window.localStorage.setItem(CLE_REDUITS, JSON.stringify(ids.slice(-REDUITS_MAX)))
  } catch {
    // Stockage indisponible : le tableau reste réduit jusqu'au prochain remontage, rien de plus.
  }
}

/*
 * DURÉE ET COÛT DE CHAQUE LOT (conv-1151, lot 4 — constat d'origine conv-1146 : plus de 20 $ dans un
 * seul fil, sans que rien ne le montre). Le coût d'un lot est celui de SON fil, lu par le même canal
 * `costBreakdown` et résumé par le même `summarizeConversationCost` que la pastille de coût du fil
 * (ConversationCostIndicator) : un second calcul serait une seconde vérité. Un fil sans appel mesuré,
 * un canal absent ou un journal illisible donnent « — », jamais « 0 $ ».
 */
export const INCONNU = '—'

/** Lignes de coût par fil de lot ; `null` = canal absent ou journal illisible. */
export type CoutsParFil = Record<string, CostRow[] | null>

/** Le coût d'un fil, ou `undefined` quand rien n'a été mesuré (même règle que la pastille). */
export function coutDuFil(couts: CoutsParFil, fil: string | undefined): CostRow[] | undefined {
  const lignes = fil ? couts[fil] : undefined
  if (!lignes || summarizeConversationCost(lignes).calls <= 0) return undefined
  return lignes
}

export const heure = (ms: number): string =>
  formaterDate(ms, { hour: '2-digit', minute: '2-digit' })

/** Le texte d'une clé, au singulier ou au pluriel selon `n` et la langue (`auPluriel`). */
export const selonNombre = (
  langue: Langue,
  n: number,
  un: CleChatFilsEtLots,
  plusieurs: CleChatFilsEtLots,
  valeurs: Record<string, string | number> = {}
): string =>
  traduireChatFilsEtLots(auPluriel(n, langue) ? plusieurs : un, langue, { n, ...valeurs })

/*
 * Les libellés d'état et de statut de l'écran. Le moteur garde les siens en français
 * (`LIBELLE_ETAT` / `LIBELLE_STATUT`, shared/plan-de-lots.ts) : l'agent du fil chef les lit.
 */
export const CLE_ETAT: Record<EtatDuLot, CleChatFilsEtLots> = {
  'a-faire': 'lots.etat.a-faire',
  'en-cours': 'lots.etat.en-cours',
  fait: 'lots.etat.fait',
  echec: 'lots.etat.echec',
  interrompu: 'lots.etat.interrompu',
  'attend-chef': 'lots.etat.attend-chef'
}

/** Durée du DERNIER lancement du lot (une relance remet `debut` à zéro). */
export function dureeDuLot(lot: LotDuPlan, langue: Langue): { texte: string; titre?: string } {
  if (!lot.debut) return { texte: INCONNU }
  if (lot.fin)
    return {
      texte: formatDuration(lot.fin - lot.debut) ?? INCONNU,
      titre: `${heure(lot.debut)} → ${heure(lot.fin)}`
    }
  // En cours : l'heure de départ reste vraie sans horloge qui tourne, une durée figée ne le serait pas.
  if (lot.etat === 'en-cours')
    return {
      texte: traduireChatFilsEtLots('lots.duree.depuis', langue, { heure: heure(lot.debut) }),
      titre: traduireChatFilsEtLots('lots.duree.lancePasFini', langue)
    }
  return {
    texte: INCONNU,
    titre: traduireChatFilsEtLots('lots.duree.finNonNotee', langue, { heure: heure(lot.debut) })
  }
}

/**
 * Relit le coût de chaque fil de lot quand un lot change d'état ou se termine — c'est à la fin d'un
 * tour que sa dépense devient lisible (même moment que la pastille du fil), et relire tous les
 * journaux à chaque signal « chat » coûterait sans rien apprendre.
 */
export function useCoutsDesLots(plan: PlanDeLots | null): CoutsParFil {
  const [lu, setLu] = useState<{ plan: string; couts: CoutsParFil }>({ plan: '', couts: {} })
  const signature = plan
    ? plan.lots.map((l) => (l.fil ? `${l.fil}:${l.etat}:${l.fin ?? ''}` : '')).join('|')
    : ''
  const planId = plan?.id ?? ''
  useEffect(() => {
    const fils = [
      ...new Set(
        signature
          .split('|')
          .filter(Boolean)
          .map((s) => s.split(':')[0])
      )
    ]
    if (!planId || !fils.length) return
    const lire = window.api?.costBreakdown
    let vivant = true
    void Promise.all(
      fils.map(async (fil): Promise<[string, CostRow[] | null]> => {
        if (typeof lire !== 'function') return [fil, null]
        try {
          const lignes = (await lire('actor', fil)) as CostRow[] | undefined
          return [fil, Array.isArray(lignes) ? lignes : null]
        } catch {
          // Journal illisible : ce lot reste « — », le tableau ne casse pas.
          return [fil, null]
        }
      })
    ).then((paires) => {
      if (vivant) setLu({ plan: planId, couts: Object.fromEntries(paires) })
    })
    return () => {
      vivant = false
    }
  }, [planId, signature])
  // Les coûts d'un AUTRE plan (changement de fil) ne s'affichent jamais.
  return lu.plan === planId ? lu.couts : {}
}

/**
 * CE QUE DIT CHAQUE LOT (conv-1315, 2026-10-30), lu par le processus principal, qui tient tous les
 * fils : un lot jamais ouvert a donc sa phrase comme les autres. Relu quand un lot change d'état ou
 * se termine, et à chaque `releve` de l'horloge de la frise, qui ne bouge que si un lot tourne : un
 * plan immobile ne redemande rien.
 */
export function usePhrasesDesLots(plan: PlanDeLots | null, releve: number): Record<number, string> {
  const [lu, setLu] = useState<{ plan: string; phrases: Record<number, string> }>({
    plan: '',
    phrases: {}
  })
  const chef = plan?.chef ?? ''
  const planId = plan?.id ?? ''
  const signature = plan
    ? plan.lots.map((l) => `${l.fil ?? ''}:${l.etat}:${l.fin ?? ''}`).join('|')
    : ''
  useEffect(() => {
    if (!planId || typeof window.api?.plansDeLots !== 'function') return
    let vivant = true
    window.api.plansDeLots('phrases', chef).then(
      (r) => {
        if (vivant && r.ok) setLu({ plan: planId, phrases: r.phrases ?? {} })
      },
      // Canal indisponible : les pistes gardent ce qu'elles disaient, la frise ne casse pas.
      () => {}
    )
    return () => {
      vivant = false
    }
  }, [chef, planId, signature, releve])
  // Les phrases d'un AUTRE plan (changement de fil) ne s'affichent jamais.
  return lu.plan === planId ? lu.phrases : {}
}

/** Le coût des lots MESURÉS, additionné par le même résumé ; les lots lancés sans mesure sont comptés. */
export function coutTotalDesLots(plan: PlanDeLots, couts: CoutsParFil, langue: Langue): string {
  const lances = plan.lots.filter((l) => l.fil)
  const mesures = lances.map((l) => coutDuFil(couts, l.fil)).filter((c): c is CostRow[] => !!c)
  if (!mesures.length) return INCONNU
  const total = summarizeConversationCost(mesures.flat()).label
  const sansMesure = lances.length - mesures.length
  return sansMesure
    ? selonNombre(langue, sansMesure, 'lots.cout.sansMesure.un', 'lots.cout.sansMesure.plusieurs', {
        total
      })
    : total
}

/*
 * RELANCER UN LOT AU CLIC (conv-1151, lot 3). Avant ce bouton, seul l'agent du chef relançait un lot
 * en échec (`plan_de_lots`, action « relancer ») : l'utilisateur, qui voyait l'échec ici, devait lui
 * écrire. La décision « permis » est celle de `relancerLot` — la règle même que le geste exécutera
 * dans le coordinateur, jamais une seconde copie.
 */

/*
 * ARRÊTER ET REPRENDRE UN PLAN AU CLIC : les mêmes statuts pour le tableau des lots et la case de
 * mosaïque (conv-1315), pour qu'un bouton n'existe pas ici et manque là.
 */
const STATUTS_REPRENABLES = new Set<PlanDeLots['statut']>([
  'suspendu-quota',
  'interrompu',
  'arrete'
])
const STATUTS_ARRETABLES = new Set<PlanDeLots['statut']>([
  'en-cours',
  'suspendu-quota',
  'interrompu'
])

export const planReprenable = (plan: PlanDeLots): boolean => STATUTS_REPRENABLES.has(plan.statut)
export const planArretable = (plan: PlanDeLots): boolean => STATUTS_ARRETABLES.has(plan.statut)

/** Plans dont un lot en échec garde son bouton, grisé, quand le plafond de tours est épuisé. */
const STATUTS_RELANCE_GRISEE = new Set<PlanDeLots['statut']>([
  'en-cours',
  'termine',
  'plafond-atteint'
])

/** `null` = pas de bouton ; sinon actif, ou grisé avec sa raison. */
export function relanceAuClic(
  plan: PlanDeLots,
  lot: LotDuPlan,
  langue: Langue
): { possible: true } | { possible: false; raison: string } | null {
  // conv-1284 : un lot qui attend le chef se relance aussi (même règle que `relancerLot`).
  if (lot.etat !== 'echec' && lot.etat !== 'interrompu' && lot.etat !== 'attend-chef') return null
  if (relancerLot(plan, lot.rang).ok) return { possible: true }
  // Le seul refus qui garde un bouton : sans lui, l'utilisateur ne saurait pas pourquoi rien ne
  // repart. Les autres (quota, redémarrage, arrêt) ont déjà leur bouton « Reprendre ».
  if (plan.toursLances >= plan.plafondTours && STATUTS_RELANCE_GRISEE.has(plan.statut))
    return {
      possible: false,
      raison: traduireChatFilsEtLots('lots.relance.plafond', langue, {
        plafond: plan.plafondTours
      })
    }
  return null
}

/** Ouvre un fil dans le panneau de chat (le tableau des lots, les onglets de la super conv). */
export const ouvrirFil = (fil: string): void => {
  window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail: fil }))
}

/** Ce qui change l'affichage d'un plan : une relecture identique ne re-rend rien. */
function signatureDuPlan(plan: PlanDeLots): string {
  return JSON.stringify([
    plan.id,
    plan.statut,
    plan.toursLances,
    plan.plafondTours,
    plan.lots.map((l) => [l.rang, l.titre, l.etat, l.fil, l.debut, l.fin, l.raison, l.apres])
  ])
}

/**
 * Le plan dont `chef` est le fil chef, relu à chaque signal (même canal et mêmes signaux que le
 * tableau des lots) ; `null` si ce fil n'est pas un chef ou si le canal manque. Sans chef (`null`) :
 * aucune lecture.
 */
export function usePlanDuChef(chef: string | null): PlanDeLots | null {
  const [lu, setLu] = useState<{ fil: string; plan: PlanDeLots | null; signature: string }>({
    fil: '',
    plan: null,
    signature: ''
  })
  useEffect(() => {
    if (!chef || typeof window.api?.plansDeLots !== 'function') return
    let vivant = true
    const poser = (plan: PlanDeLots | null): void => {
      if (!vivant) return
      const signature = plan ? signatureDuPlan(plan) : ''
      setLu((avant) =>
        avant.fil === chef && avant.signature === signature ? avant : { fil: chef, plan, signature }
      )
    }
    const relire = (): void => {
      window.api.plansDeLots('voir', chef).then(
        (r) => poser(r.ok && r.vue?.role === 'chef' ? r.vue.plan : null),
        // Un shell plus ancien n'expose pas ce canal : la case reste une fenêtre ordinaire.
        () => poser(null)
      )
    }
    relire()
    const off = window.api?.onAppEvent?.((e) => {
      if (
        e.type === 'refresh' &&
        (e.scope === 'plans-de-lots' || e.scope === 'chat' || e.scope === 'conversations')
      )
        relire()
    })
    return () => {
      vivant = false
      off?.()
    }
  }, [chef])
  return lu.fil === chef ? lu.plan : null
}
