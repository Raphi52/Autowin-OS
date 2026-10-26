import { estMurDeQuota } from './reprise-quota'

/**
 * SUPER CONVERSATION — LE PLAN DE LOTS D'UN FIL CHEF (conv-1150, 2026-10-26).
 *
 * Constat qui motive : conv-1146 a confié 113 écrans à UN seul agent (plus de 20 $, refus du
 * contrôle final, réparations en boucle). Lancer plusieurs fils existait déjà, mais personne ne
 * les suivait : aucun fil ne savait quand ses fils enfants avaient fini.
 *
 * Un fil chef dépose un plan (outil `plan_de_lots`) ; l'utilisateur l'accepte d'un clic ; l'app
 * (`main/plans-de-lots-app.ts`) ouvre un fil par lot, au plus `PARALLELE_MAX` à la fois, et réveille
 * le chef à chaque fin de fil enfant avec un compte rendu dans le journal des messages entre fils.
 *
 * CE MODULE EST LE CALCUL PUR : lecture stricte du plan, lots à lancer, fin d'un lot, bilan, textes.
 * Aucune E/S, aucun lancement. Il sert aussi l'écran (tableau d'avancement).
 */

/** Au-delà, le chef regroupe : 20 comptes rendus restent sous les 30 envois par heure du journal. */
export const LOTS_MAX = 20
/** Même plafond que « Essaie 3 façons » et que le découpage en fils : chaque fil est un tour payé. */
export const PARALLELE_MAX = 3
/** Même borne que le texte d'une tâche du découpage en fils (`lancer-en-fils`). */
export const DEMANDE_MAX = 4_000
export const FICHIERS_MAX = 40
/** Plafond par défaut : le tour du lot, plus une relance possible. */
export const TOURS_PAR_LOT_DEFAUT = 2
/** Au-delà, un plafond n'est plus une borne. */
export const TOURS_PAR_LOT_MAX = 10
/** Même borne que `ecrire_a_un_fil` (`TEXTE_MAX_MESSAGE_FIL`). */
export const COMPTE_RENDU_MAX = 2_000
const RAISON_MAX = 300
const TITRE_MAX = 80

export type EtatDuLot = 'a-faire' | 'en-cours' | 'fait' | 'echec' | 'interrompu'
export type StatutDuPlan =
  | 'attente-accord'
  | 'en-cours'
  | 'termine'
  | 'suspendu-quota'
  | 'plafond-atteint'
  | 'interrompu'
  | 'arrete'
  | 'refuse'
  | 'remplace'

export interface LotDuPlan {
  /** 1, 2, 3… dans l'ordre du plan. */
  rang: number
  titre: string
  demande: string
  fichiers: string[]
  etat: EtatDuLot
  /** Le fil enfant ouvert pour ce lot (gardé à la relance). */
  fil?: string
  /** Le tour lancé dans ce fil : une fin d'un AUTRE tour du même fil n'est pas celle du lot. */
  tour?: string
  raison?: string
  debut?: number
  fin?: number
}

export interface PlanDeLots {
  id: string
  /** Le fil chef : celui qui a déposé le plan, et le seul que l'utilisateur suit. */
  chef: string
  /** Empreinte du contenu : un même plan déposé deux fois rend le plan existant. */
  cle: string
  titre: string
  parallele: number
  plafondTours: number
  /** Tours lancés dans les fils enfants (lancements et relances). */
  toursLances: number
  statut: StatutDuPlan
  raison?: string
  avertissements: string[]
  creeLe: number
  lots: LotDuPlan[]
}

export interface PlanLu {
  titre: string
  parallele: number
  plafondTours: number
  lots: Array<{ titre: string; demande: string; fichiers: string[] }>
}

export type LecturePlan =
  { ok: true; plan: PlanLu; avertissements: string[] } | { ok: false; erreur: string }

const LIBELLE_ETAT: Record<EtatDuLot, string> = {
  'a-faire': 'à faire',
  'en-cours': 'en cours',
  fait: 'fait',
  echec: 'échec',
  interrompu: 'interrompu'
}

export const LIBELLE_STATUT: Record<StatutDuPlan, string> = {
  'attente-accord': 'en attente de ton accord',
  'en-cours': 'en cours',
  termine: 'terminé',
  'suspendu-quota': 'suspendu : limite de quota',
  'plafond-atteint': 'arrêté : plafond de tours atteint',
  interrompu: 'interrompu par un redémarrage',
  arrete: 'arrêté',
  refuse: 'refusé',
  remplace: 'remplacé par un plan corrigé'
}

export const libelleEtat = (etat: EtatDuLot): string => LIBELLE_ETAT[etat]

const pluriel = (n: number, mot: string, motPluriel = `${mot}s`): string =>
  `${n} ${n > 1 ? motPluriel : mot}`

/** Deux écritures d'un même chemin (casse, `\`, `./`) désignent le même fichier sous Windows. */
export function normaliserChemin(chemin: string): string {
  return chemin
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

const refus = (erreur: string): LecturePlan => ({ ok: false, erreur })

/**
 * Lecture STRICTE du plan déposé par l'agent du chef. Rien n'est deviné : un plan mal formé est
 * refusé en entier, avec le lot et le champ fautifs nommés. Seul le parallélisme trop grand est
 * ramené à la borne — et la carte d'accord le dit.
 */
export function lirePlanDeLots(brut: unknown): LecturePlan {
  if (brut === undefined || brut === null) return refus('plan absent : rien à lancer.')
  let source = brut
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch (e) {
      return refus(`plan en JSON illisible (${(e as Error).message}).`)
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source))
    return refus('plan : objet attendu, avec une liste « lots ».')
  const plan = source as Record<string, unknown>
  if (plan.lots === undefined)
    return refus('lots absents : le plan doit porter une liste « lots ».')
  if (!Array.isArray(plan.lots)) return refus('lots : liste attendue.')
  const n = plan.lots.length
  if (n === 0) return refus('plan vide : aucun lot.')
  if (n === 1) return refus('un seul lot : pas besoin de chef, lance-le directement dans un fil.')
  if (n > LOTS_MAX)
    return refus(`${n} lots : ${LOTS_MAX} lots au plus, regroupe-les en lots plus gros.`)
  if (plan.titre !== undefined && (typeof plan.titre !== 'string' || !plan.titre.trim()))
    return refus('titre du plan : texte attendu.')

  const lots: PlanLu['lots'] = []
  for (let i = 0; i < n; i++) {
    const rang = i + 1
    const brutLot = plan.lots[i]
    if (!brutLot || typeof brutLot !== 'object' || Array.isArray(brutLot))
      return refus(`lot ${rang} : objet attendu ({ titre, demande, fichiers }).`)
    const l = brutLot as Record<string, unknown>
    if (typeof l.demande !== 'string' || !l.demande.trim())
      return refus(`lot ${rang} : demande vide — le message que recevra son fil est obligatoire.`)
    const demande = l.demande.trim()
    if (demande.length > DEMANDE_MAX)
      return refus(`lot ${rang} : demande de ${demande.length} caractères, ${DEMANDE_MAX} au plus.`)
    if (l.titre !== undefined && (typeof l.titre !== 'string' || !l.titre.trim()))
      return refus(`lot ${rang} : titre — texte attendu.`)
    let fichiers: string[] = []
    if (l.fichiers !== undefined) {
      if (!Array.isArray(l.fichiers) || l.fichiers.some((f) => typeof f !== 'string' || !f.trim()))
        return refus(`lot ${rang} : fichiers — liste de chemins non vides attendue.`)
      if (l.fichiers.length > FICHIERS_MAX)
        return refus(`lot ${rang} : ${l.fichiers.length} fichiers, ${FICHIERS_MAX} au plus.`)
      fichiers = (l.fichiers as string[]).map((f) => f.trim())
    }
    const titre =
      typeof l.titre === 'string'
        ? l.titre.trim().slice(0, TITRE_MAX)
        : (demande.split('\n')[0] ?? '').slice(0, 60)
    lots.push({ titre, demande, fichiers })
  }

  const avertissements: string[] = []
  let parallele = PARALLELE_MAX
  if (plan.parallele !== undefined) {
    const p = plan.parallele
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1)
      return refus(`parallélisme « ${String(p)} » : entier de 1 à ${PARALLELE_MAX} attendu.`)
    if (p > PARALLELE_MAX) avertissements.push(`parallélisme ${p} ramené à ${PARALLELE_MAX}.`)
    parallele = Math.min(p, PARALLELE_MAX)
  }
  let plafondTours = n * TOURS_PAR_LOT_DEFAUT
  if (plan.plafondTours !== undefined) {
    const t = plan.plafondTours
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 1)
      return refus(`plafond de tours « ${String(t)} » : entier positif attendu.`)
    if (t > n * TOURS_PAR_LOT_MAX)
      return refus(
        `plafond de ${t} tours : ${TOURS_PAR_LOT_MAX} par lot au plus (${n * TOURS_PAR_LOT_MAX}).`
      )
    if (t < n) avertissements.push(`le plafond de ${t} tours ne couvre que ${t} lots sur ${n}.`)
    plafondTours = t
  }
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const communs = lots[i].fichiers.filter((f) =>
        lots[j].fichiers.some((g) => normaliserChemin(g) === normaliserChemin(f))
      )
      if (communs.length)
        avertissements.push(
          `les lots ${i + 1} et ${j + 1} annoncent le même fichier (${communs[0]}) : ils passeront l’un après l’autre.`
        )
    }
  const titre =
    typeof plan.titre === 'string' ? plan.titre.trim().slice(0, TITRE_MAX) : `Plan de ${n} lots`
  return { ok: true, plan: { titre, parallele, plafondTours, lots }, avertissements }
}

/** Empreinte FNV-1a du contenu lu : stable, sans dépendance, utilisable côté écran. */
export function empreintePlan(plan: PlanLu): string {
  const texte = JSON.stringify([
    plan.titre,
    plan.parallele,
    plan.plafondTours,
    plan.lots.map((l) => [l.titre, l.demande, l.fichiers.map(normaliserChemin)])
  ])
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function creerPlan(
  lu: PlanLu,
  opts: { id: string; chef: string; maintenant: number; avertissements?: string[] }
): PlanDeLots {
  return {
    id: opts.id,
    chef: opts.chef,
    cle: empreintePlan(lu),
    titre: lu.titre,
    parallele: lu.parallele,
    plafondTours: lu.plafondTours,
    toursLances: 0,
    statut: 'attente-accord',
    avertissements: opts.avertissements ?? [],
    creeLe: opts.maintenant,
    lots: lu.lots.map((l, i) => ({ ...l, fichiers: [...l.fichiers], rang: i + 1, etat: 'a-faire' }))
  }
}

const STATUTS_ACTIFS: ReadonlySet<StatutDuPlan> = new Set([
  'en-cours',
  'suspendu-quota',
  'interrompu'
])

/**
 * Un dépôt de plan dans le fil `chef` : même contenu qu'un plan vivant → ce plan ; un plan qui
 * tourne → refus ; un plan en attente d'accord avec un autre contenu → remplacé (l'agent a corrigé
 * son plan avant ton clic).
 */
export function decisionDeDepot(
  plans: readonly PlanDeLots[],
  chef: string,
  cle: string
):
  | { type: 'existant'; plan: PlanDeLots }
  | { type: 'refus'; raison: string }
  | { type: 'nouveau'; remplace?: string } {
  const siens = plans.filter((p) => p.chef === chef)
  const meme = siens.find(
    (p) => p.cle === cle && (p.statut === 'attente-accord' || STATUTS_ACTIFS.has(p.statut))
  )
  if (meme) return { type: 'existant', plan: meme }
  const actif = siens.find((p) => STATUTS_ACTIFS.has(p.statut))
  if (actif) {
    const b = bilanDuPlan(actif)
    return {
      type: 'refus',
      raison: `un plan est déjà en cours (${b.faits}/${b.total} faits) — ${actif.id} : attends sa fin, ou demande à l’utilisateur de l’arrêter.`
    }
  }
  const attente = siens.find((p) => p.statut === 'attente-accord')
  return attente ? { type: 'nouveau', remplace: attente.id } : { type: 'nouveau' }
}

/**
 * Les lots qui peuvent partir MAINTENANT, dans l'ordre du plan : places libres (parallélisme),
 * budget de tours restant, et aucun fichier annoncé en commun avec un lot en cours. Un lot bloqué
 * par un fichier laisse passer le suivant qui est libre.
 *
 * `filOccupe` : un lot qui repart dans SON fil (relance, reprise) attend tant qu'un tour y tourne,
 * sans prendre de place. Sinon un agent repris après un redémarrage et un nouvel agent écriraient
 * dans la même session (conv-260 ; objection du juge, conv-1150).
 */
export function lotsAPartir(plan: PlanDeLots, filOccupe?: (fil: string) => boolean): number[] {
  if (plan.statut !== 'en-cours') return []
  const enCours = plan.lots.filter((l) => l.etat === 'en-cours')
  let places = plan.parallele - enCours.length
  let budget = plan.plafondTours - plan.toursLances
  const pris = new Set(enCours.flatMap((l) => l.fichiers.map(normaliserChemin)))
  const partants: number[] = []
  for (const lot of plan.lots) {
    if (places <= 0 || budget <= 0) break
    if (lot.etat !== 'a-faire') continue
    if (lot.fil && filOccupe?.(lot.fil)) continue
    const fichiers = lot.fichiers.map(normaliserChemin)
    if (fichiers.some((f) => pris.has(f))) continue
    for (const f of fichiers) pris.add(f)
    partants.push(lot.rang)
    places--
    budget--
  }
  return partants
}

const avecLot = (plan: PlanDeLots, rang: number, modif: Partial<LotDuPlan>): PlanDeLots => ({
  ...plan,
  lots: plan.lots.map((l) => (l.rang === rang ? { ...l, ...modif } : l))
})

/** Le lot `rang` part dans `fil` : il compte un tour, AVANT le lancement (la place est réservée). */
export function marquerLance(
  plan: PlanDeLots,
  rang: number,
  fil: string,
  maintenant: number
): PlanDeLots {
  const p = avecLot(plan, rang, {
    etat: 'en-cours',
    fil,
    tour: undefined,
    raison: undefined,
    debut: maintenant,
    fin: undefined
  })
  return { ...p, toursLances: plan.toursLances + 1 }
}

/** Le tour du lot est connu (le lancement rend la main au DÉMARRAGE du tour). */
export function noterTourDuLot(plan: PlanDeLots, rang: number, tour: string): PlanDeLots {
  const lot = plan.lots.find((l) => l.rang === rang)
  if (!lot || lot.etat !== 'en-cours' || lot.tour) return plan
  return avecLot(plan, rang, { tour })
}

/** Recalcule le statut d'un plan en cours : terminé, ou arrêté par le plafond. */
function statutApres(plan: PlanDeLots): PlanDeLots {
  if (plan.statut !== 'en-cours') return plan
  const enCours = plan.lots.some((l) => l.etat === 'en-cours')
  const restants = plan.lots.filter((l) => l.etat === 'a-faire').length
  if (!enCours && restants === 0) return { ...plan, statut: 'termine', raison: undefined }
  if (!enCours && lotsAPartir(plan).length === 0)
    return {
      ...plan,
      statut: 'plafond-atteint',
      raison: `plafond de ${plan.plafondTours} tours atteint : ${pluriel(restants, 'lot restant', 'lots restants')}.`
    }
  return plan
}

export interface IssueDuTour {
  ok: boolean
  tour?: string
  annule?: boolean
  erreur?: string
  /** Texte final du tour : la matière du compte rendu au chef. */
  texte?: string
  /** Tour REPRIS après un redémarrage (`reprendreAppelChat`, index.ts) : son agent a survécu. */
  repris?: boolean
  /** Clos SANS résultat : l'agent est mort avec l'app (reprise « sans signe de vie »). */
  perdu?: boolean
}

/**
 * Fin d'un tour dans le fil `fil`. Seule la fin du tour d'un lot EN COURS compte : une seconde
 * annonce, un fil hors plan ou un autre tour du même fil ne changent rien (plan rendu tel quel).
 * Un échec ne relance rien. Un mur de QUOTA suspend le plan entier : aucun lot ne repart seul.
 *
 * Exception : la fin du tour REPRIS d'un lot interrompu (son agent a survécu au redémarrage) est
 * notée — sinon son résultat et son compte rendu étaient perdus (objection du juge, conv-1150).
 * Le plan reste interrompu (rien ne repart seul), et se termine si plus aucun lot n'attend. Un
 * agent PERDU (mort avec l'app) n'apporte rien : le lot reste interrompu, « Reprendre » le relance.
 */
export function noterFinDeTour(
  plan: PlanDeLots,
  fil: string,
  issue: IssueDuTour,
  maintenant: number
): { plan: PlanDeLots; effet: 'note' | 'deja-note' | 'hors-plan' | 'autre-tour'; lot?: LotDuPlan } {
  const lot = plan.lots.find((l) => l.fil === fil)
  if (!lot) return { plan, effet: 'hors-plan' }
  const reprisApresRedemarrage =
    lot.etat === 'interrompu' && issue.repris === true && issue.perdu !== true
  if (lot.etat !== 'en-cours' && !reprisApresRedemarrage) return { plan, effet: 'deja-note', lot }
  if (issue.tour && lot.tour && issue.tour !== lot.tour) return { plan, effet: 'autre-tour', lot }
  const erreur = (issue.erreur ?? '').trim()
  const raison = issue.ok
    ? undefined
    : issue.annule
      ? 'tour arrêté avant la fin'
      : (erreur || 'le tour a échoué sans message').slice(0, RAISON_MAX)
  let suivant = avecLot(plan, lot.rang, {
    etat: issue.ok ? 'fait' : 'echec',
    raison,
    fin: maintenant
  })
  if (!issue.ok && estMurDeQuota(erreur) && suivant.statut === 'en-cours')
    suivant = {
      ...suivant,
      statut: 'suspendu-quota',
      raison: `limite de quota atteinte pendant le lot ${lot.rang} : aucun lot ne repart seul.`
    }
  if (
    suivant.statut === 'interrompu' &&
    suivant.lots.every((l) => l.etat === 'fait' || l.etat === 'echec')
  )
    suivant = { ...suivant, statut: 'termine', raison: undefined }
  suivant = statutApres(suivant)
  return { plan: suivant, effet: 'note', lot: suivant.lots.find((l) => l.rang === lot.rang) }
}

/** Un lot qui n'a pas pu partir (fil non créé) : en échec, sans compter de tour. */
export function marquerEchec(
  plan: PlanDeLots,
  rang: number,
  raison: string,
  maintenant: number
): PlanDeLots {
  return statutApres(
    avecLot(plan, rang, { etat: 'echec', raison: raison.slice(0, RAISON_MAX), fin: maintenant })
  )
}

/** Le statut du plan après des lancements (un plafond bas peut l'arrêter sans fin de lot). */
export function statutApresLancements(plan: PlanDeLots): PlanDeLots {
  return statutApres(plan)
}

/** Redémarrage de l'app : un lot en cours a perdu son tour. Rien ne repart seul. */
export function interrompreAuDemarrage(plan: PlanDeLots): PlanDeLots {
  if (plan.statut !== 'en-cours' && !plan.lots.some((l) => l.etat === 'en-cours')) return plan
  return {
    ...plan,
    statut: plan.statut === 'en-cours' ? 'interrompu' : plan.statut,
    raison:
      plan.statut === 'en-cours'
        ? 'l’app a redémarré pendant le plan : reprends-le avec le bouton « Reprendre ».'
        : plan.raison,
    lots: plan.lots.map((l) =>
      l.etat === 'en-cours'
        ? { ...l, etat: 'interrompu', raison: 'l’app a redémarré pendant ce lot.' }
        : l
    )
  }
}

/**
 * Reprise d'un plan suspendu (quota), interrompu (redémarrage) ou arrêté — GESTE DE L'UTILISATEUR
 * (bouton du tableau), jamais automatique. Les lots interrompus repartent dans LEUR fil.
 *
 * `filOccupe` : un lot interrompu dont le fil tourne encore (agent repris après le redémarrage) est
 * ADOPTÉ — remis en cours sans nouveau tour, sa fin le notera. Le relancer aurait mis un second
 * agent dans la même session (objection du juge, conv-1150).
 */
export function reprendrePlan(
  plan: PlanDeLots,
  filOccupe?: (fil: string) => boolean
): { ok: true; plan: PlanDeLots } | { ok: false; erreur: string } {
  if (!['suspendu-quota', 'interrompu', 'arrete'].includes(plan.statut))
    return { ok: false, erreur: `plan ${LIBELLE_STATUT[plan.statut]} : rien à reprendre.` }
  const repris: PlanDeLots = {
    ...plan,
    statut: 'en-cours',
    raison: undefined,
    lots: plan.lots.map((l): LotDuPlan => {
      if (l.etat === 'interrompu' && l.fil && filOccupe?.(l.fil))
        return { ...l, etat: 'en-cours', raison: undefined }
      // Un lot coupé par le quota n'a pas échoué sur son contenu : il repart avec le plan.
      return l.etat === 'interrompu' || (l.etat === 'echec' && estMurDeQuota(l.raison))
        ? { ...l, etat: 'a-faire', raison: undefined, tour: undefined }
        : l
    })
  }
  return { ok: true, plan: statutApres(repris) }
}

/**
 * Relance d'un lot en échec ou interrompu, demandée par le chef. Elle consomme un tour du plafond.
 * Refusée sur un plan suspendu par le quota : seul l'utilisateur reprend après la limite.
 */
export function relancerLot(
  plan: PlanDeLots,
  rang: number
): { ok: true; plan: PlanDeLots } | { ok: false; erreur: string } {
  const lot = plan.lots.find((l) => l.rang === rang)
  if (!lot)
    return { ok: false, erreur: `lot ${rang} inconnu : le plan a ${plan.lots.length} lots.` }
  if (plan.statut === 'suspendu-quota')
    return {
      ok: false,
      erreur:
        'plan suspendu par la limite de quota : seul l’utilisateur le reprend (bouton « Reprendre » du tableau).'
    }
  if (!['en-cours', 'termine'].includes(plan.statut))
    return { ok: false, erreur: `plan ${LIBELLE_STATUT[plan.statut]} : relance impossible.` }
  if (lot.etat !== 'echec' && lot.etat !== 'interrompu')
    return { ok: false, erreur: `le lot ${rang} est ${LIBELLE_ETAT[lot.etat]} : rien à relancer.` }
  if (plan.toursLances >= plan.plafondTours)
    return {
      ok: false,
      erreur: `plafond de ${plan.plafondTours} tours atteint : relance impossible.`
    }
  const p = avecLot(plan, rang, { etat: 'a-faire', raison: undefined, tour: undefined })
  return { ok: true, plan: { ...p, statut: 'en-cours', raison: undefined } }
}

export interface BilanDuPlan {
  total: number
  faits: number
  echecs: number
  enCours: number
  aFaire: number
  interrompus: number
  texte: string
}

export function bilanDuPlan(plan: PlanDeLots): BilanDuPlan {
  const compte = (etat: EtatDuLot): number => plan.lots.filter((l) => l.etat === etat).length
  const b = {
    total: plan.lots.length,
    faits: compte('fait'),
    echecs: compte('echec'),
    enCours: compte('en-cours'),
    aFaire: compte('a-faire'),
    interrompus: compte('interrompu')
  }
  const texte =
    `${pluriel(b.faits, 'fait')}, ${b.echecs} en échec, ${b.enCours} en cours, ${b.aFaire} à faire` +
    (b.interrompus ? `, ${pluriel(b.interrompus, 'interrompu')}` : '') +
    ` sur ${b.total} — ${pluriel(plan.toursLances, 'tour')} sur ${plan.plafondTours}`
  return { ...b, texte }
}

/** Le message que reçoit le fil d'un lot. La demande reste EN TÊTE : un `/build …` y est reconnu. */
export function promptDuLot(plan: PlanDeLots, lot: LotDuPlan): string {
  const fichiers = lot.fichiers.length
    ? `Fichiers prévus pour ce lot : ${lot.fichiers.join(', ')}. N’en touche pas d’autres sans nécessité : d’autres fils travaillent en même temps dans ce dossier.`
    : 'Aucun fichier annoncé pour ce lot : d’autres fils travaillent en même temps dans ce dossier.'
  return [
    lot.demande,
    '',
    '---',
    `Lot ${lot.rang} sur ${plan.lots.length} du plan « ${plan.titre} », confié par le fil chef ${plan.chef} (${plan.id}).`,
    fichiers,
    'Ta réponse finale sera remise au fil chef comme compte rendu : termine-la par un résumé court — ce qui est fait, la preuve (commande et code de sortie), ce qui reste.'
  ].join('\n')
}

/**
 * Le compte rendu d'un lot, écrit au chef dans le journal des messages entre fils. Il tient dans
 * la borne du journal ; une réponse longue est coupée par le DÉBUT (le résumé demandé est à la fin)
 * et renvoie au fil enfant.
 */
export function compteRenduDuLot(plan: PlanDeLots, lot: LotDuPlan, reponse?: string): string {
  const tete =
    `Lot ${lot.rang}/${plan.lots.length} « ${lot.titre} » : ${LIBELLE_ETAT[lot.etat]} dans ${lot.fil ?? '?'}` +
    (lot.raison ? ` (${lot.raison})` : '') +
    `.\nAvancement du plan : ${bilanDuPlan(plan).texte}.`
  const corps = (reponse ?? '').trim()
  if (!corps) return tete.slice(0, COMPTE_RENDU_MAX)
  const entete = `${tete}\nRéponse du fil (fin) :\n`
  const renvoi = `\n(suite dans ${lot.fil ?? 'le fil du lot'})`
  if (entete.length + corps.length <= COMPTE_RENDU_MAX) return entete + corps
  const place = Math.max(0, COMPTE_RENDU_MAX - entete.length - renvoi.length - 1)
  return `${entete}…${corps.slice(corps.length - place)}${renvoi}`.slice(0, COMPTE_RENDU_MAX)
}

/** Le tour lancé par l'app dans le fil chef quand des lots ont fini. */
export function promptDeReveil(plan: PlanDeLots, rangs: readonly number[]): string {
  const nouveaux = rangs
    .map((r) => plan.lots.find((l) => l.rang === r))
    .filter((l): l is LotDuPlan => Boolean(l))
    .map(
      (l) =>
        `lot ${l.rang} « ${l.titre} » : ${LIBELLE_ETAT[l.etat]}${l.raison ? ` (${l.raison})` : ''}, fil ${l.fil ?? '?'}`
    )
  return [
    `RÉVEIL DU PLAN DE LOTS « ${plan.titre} » (${plan.id}) — message de l’app, pas de l’utilisateur.`,
    `Lots qui viennent de finir : ${nouveaux.length ? nouveaux.join(' ; ') : 'aucun'}.`,
    `Avancement : ${bilanDuPlan(plan).texte}. Statut du plan : ${LIBELLE_STATUT[plan.statut]}${plan.raison ? ` — ${plan.raison}` : ''}.`,
    'Les comptes rendus détaillés sont dans les messages de tes fils (en tête de ce tour, ou par lire_mes_messages).',
    'Ce que tu fais maintenant :',
    '- vérifie le résultat des lots finis (conversation_read sur leur fil) sans refaire leur travail ;',
    '- un lot en échec dont la cause se corrige : relance-le avec plan_de_lots (action « relancer », lot N) ; sinon dis-le ;',
    '- les lots suivants partent seuls : n’en lance aucun à la main ;',
    '- quand le plan est terminé ou arrêté, rends à l’utilisateur le bilan assemblé : ce qui est fait, avec quelle preuve, ce qui reste.',
    'Si rien n’est à faire, réponds en une ligne.'
  ].join('\n')
}

/** Ce que l'écran reçoit du canal `os:plansDeLots` (preload). */
export interface VuePlanDeLots {
  plan: PlanDeLots
  role: 'chef' | 'enfant'
  rang?: number
}
export type GestePlanDeLots = 'voir' | 'accepter' | 'refuser' | 'arreter' | 'reprendre'
export type ReponsePlansDeLots =
  | { ok: true; vue?: VuePlanDeLots | null; plan?: PlanDeLots; detail?: string; deja?: boolean }
  | { ok: false; erreur: string }
