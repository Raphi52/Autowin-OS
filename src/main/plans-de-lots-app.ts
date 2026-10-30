import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import {
  LIBELLE_STATUT,
  adopterLotRepris,
  ajouterLots,
  bilanDuPlan,
  compteRenduDuLot,
  creerPlan,
  decisionDeDepot,
  empreintePlan,
  interrompreAuDemarrage,
  libelleEtat,
  lirePlanDeLots,
  lotsAPartir,
  marquerEchec,
  marquerLance,
  messageDeDecision,
  noterDecision,
  noterFinDeTour,
  noterTourDuLot,
  promptDeReveil,
  promptDuLot,
  relancerLot,
  reprendrePlan,
  statutApresLancements,
  suiteDeLOrdreAuLot,
  type IssueDuTour,
  type LotDuPlan,
  type PlanDeLots,
  type StatutDuPlan
} from '../shared/plan-de-lots'

/**
 * SUPER CONVERSATION, CÔTÉ APP (conv-1150, 2026-10-26) — le coordinateur des plans de lots.
 *
 * Le fil chef dépose un plan (`plan_de_lots`), qui part aussitôt (conv-1171 : plus de clic
 * d'accord ; « Lancer le plan » ne reste que pour un plan déposé avant ce changement). Ensuite
 * l'app, et non l'agent :
 *  - ouvre un fil par lot dans le dossier du chef et y lance la demande (au plus 3 à la fois) ;
 *  - à la fin du tour d'un fil enfant (`surFinDeTour`, branché dans index.ts AUTOUR du tour compté
 *    par `trackPreparation`, sinon le chef passerait pour occupé), note le lot, écrit au chef un
 *    compte rendu dans le journal des messages entre fils (expéditeur : le fil enfant), lance le
 *    lot suivant ;
 *  - réveille le chef. Chef occupé : le compte rendu attend la fin de SON tour, et part une fois.
 *
 * Pourquoi l'app et pas une consigne : un réveil Watchdog vers un fil occupé est ANNULÉ
 * (`task-manager/chat-dispatch.ts`), et un plan tenu dans la tête de l'agent n'a pas de tableau.
 * Pourquoi pas `aw-fils` ni la nature « ordre » : ces pièces n'étaient pas publiées au moment de
 * cette construction ; le coordinateur ne dépend que de `lancerDansConversation`, `tourDeChatActif`
 * et `ecrire_a_un_fil`, déjà en place.
 */

export const NOM_FICHIER_PLANS = 'plans-de-lots.json'
const PLANS_GARDES = 50

export interface DepsPlans {
  /** Crée un fil enfant dans le dossier du chef ; rend son identifiant. Lève en cas d'échec. */
  creerFil: (chef: string, titre: string) => string
  /**
   * Lance un tour dans le fil ; rend la main au démarrage du tour (`lancerDansConversation`).
   * `modele` : celui du lot (conv-1284) ; absent, le tour suit le modèle du fil.
   */
  lancer: (
    fil: string,
    prompt: string,
    modele?: string
  ) => Promise<{ ok: boolean; turnId?: string; error?: string }>
  tourActif: (fil: string) => boolean
  existe: (fil: string) => boolean
  /** Écrit au fil `a` comme le fil `de` (journal des messages entre fils). Lève sur refus. */
  ecrire: (de: string, a: string, texte: string) => void
  /** Prévient l'écran (tableau d'avancement). */
  signaler?: () => void
  stockage?: { lire: () => string; ecrire: (contenu: string) => void }
  maintenant?: () => number
  nouvelId?: () => string
  journaliser?: (message: string, detail?: unknown) => void
}

export type ResultatPlan =
  { ok: true; plan: PlanDeLots; detail: string; deja?: boolean } | { ok: false; erreur: string }

export function cheminFichierPlans(racine = autowinAppDataRoot()): string {
  return join(racine, NOM_FICHIER_PLANS)
}

function stockageFichier(chemin = cheminFichierPlans()): NonNullable<DepsPlans['stockage']> {
  return {
    lire: () => {
      try {
        return readFileSync(chemin, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return ''
        throw e
      }
    },
    // Écriture par fichier temporaire puis renommage : un arrêt brutal ne laisse pas un JSON coupé.
    ecrire: (contenu) => {
      mkdirSync(dirname(chemin), { recursive: true })
      const tmp = `${chemin}.tmp`
      writeFileSync(tmp, contenu, 'utf8')
      renameSync(tmp, chemin)
    }
  }
}

const ETATS = new Set(['a-faire', 'en-cours', 'fait', 'echec', 'interrompu', 'attend-chef'])
/** Un plan dont les lots peuvent encore tourner : son fil de lot n'en lance pas un autre. */
const PLAN_VIVANT: ReadonlySet<StatutDuPlan> = new Set([
  'attente-accord',
  'en-cours',
  'suspendu-quota',
  'interrompu',
  'bloque'
])
const STATUTS = new Set(Object.keys(LIBELLE_STATUT))

/** Un plan relu du disque est vérifié champ par champ : une entrée abîmée est sautée. */
function estPlanLisible(x: unknown): x is PlanDeLots {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.chef === 'string' &&
    typeof p.cle === 'string' &&
    typeof p.titre === 'string' &&
    typeof p.parallele === 'number' &&
    typeof p.plafondTours === 'number' &&
    typeof p.toursLances === 'number' &&
    STATUTS.has(String(p.statut)) &&
    (p.decisions === undefined || Array.isArray(p.decisions)) &&
    Array.isArray(p.lots) &&
    p.lots.every(
      (l) =>
        !!l &&
        typeof l === 'object' &&
        typeof (l as Record<string, unknown>).rang === 'number' &&
        typeof (l as Record<string, unknown>).demande === 'string' &&
        Array.isArray((l as Record<string, unknown>).fichiers) &&
        ETATS.has(String((l as Record<string, unknown>).etat))
    )
  )
}

/** Le tableau d'un plan en texte, pour l'agent du chef (`plan_de_lots`, action « etat »). */
export function tableauTexte(plan: PlanDeLots): string {
  return plan.lots
    .map(
      (l) =>
        `${l.rang}. ${l.titre} — ${libelleEtat(l.etat)}${l.raison ? ` (${l.raison})` : ''}${l.fil ? ` — ${l.fil}` : ''}`
    )
    .join('\n')
}

export class CoordinateurDesPlans {
  readonly #deps: DepsPlans
  readonly #stockage: NonNullable<DepsPlans['stockage']>
  #plans: PlanDeLots[] = []
  /** Chef → lots finis dont le compte rendu attend un réveil (chef occupé, ou réveil en cours). */
  readonly #enAttente = new Map<string, { planId: string; rangs: Set<number> }>()
  /** Chefs dont un tour de réveil est lancé et pas encore fini. */
  readonly #reveilEnCours = new Set<string>()

  constructor(deps: DepsPlans) {
    this.#deps = deps
    this.#stockage = deps.stockage ?? stockageFichier()
    this.#charger()
  }

  #maintenant(): number {
    return this.#deps.maintenant?.() ?? Date.now()
  }

  #journal(message: string, detail?: unknown): void {
    if (this.#deps.journaliser) this.#deps.journaliser(message, detail)
    else console.warn(`[plans de lots] ${message}`, detail ?? '')
  }

  #charger(): void {
    let brut = ''
    try {
      brut = this.#stockage.lire()
    } catch (e) {
      this.#journal('fichier des plans illisible : aucun plan chargé', e)
      return
    }
    if (!brut.trim()) return
    let lu: unknown
    try {
      lu = JSON.parse(brut)
    } catch (e) {
      this.#journal('fichier des plans en JSON illisible : aucun plan chargé', e)
      return
    }
    const plans = (lu as { plans?: unknown })?.plans
    if (!Array.isArray(plans)) return
    let change = false
    this.#plans = plans.filter(estPlanLisible).map((p) => {
      // Au démarrage, l'app a perdu le suivi des lots « en cours » : ils passent interrompus. Leur
      // agent a pu survivre : un fil déjà réservé par `reprendreAppelChat` (index.ts) est adopté ici,
      // les travaux reconnus plus tard le sont par `agentRepris` (conv-1308). Sa fin, annoncée
      // `repris`, compte, et « Reprendre » n'y lance jamais un second agent.
      const interrompu = interrompreAuDemarrage({
        ...p,
        avertissements: p.avertissements ?? [],
        // Une décision abîmée sur disque est sautée, pas le plan (conv-1284).
        ...(p.decisions
          ? {
              decisions: p.decisions.filter(
                (d) =>
                  !!d &&
                  typeof d.texte === 'string' &&
                  typeof d.de === 'string' &&
                  typeof d.le === 'number'
              )
            }
          : {})
      })
      const apres = interrompu.lots.reduce(
        (plan, l) =>
          l.fil && l.etat === 'interrompu' && this.#deps.tourActif(l.fil)
            ? adopterLotRepris(plan, l.fil)
            : plan,
        interrompu
      )
      if (apres !== p) change = true
      return apres
    })
    if (change) this.#enregistrer()
  }

  #enregistrer(): void {
    if (this.#plans.length > PLANS_GARDES) this.#plans = this.#plans.slice(-PLANS_GARDES)
    try {
      this.#stockage.ecrire(JSON.stringify({ version: 1, plans: this.#plans }, null, 2))
    } catch (e) {
      this.#journal('plans non enregistrés sur disque', e)
    }
  }

  /** Remplace le plan (même id), enregistre, prévient l'écran. */
  #poser(plan: PlanDeLots): PlanDeLots {
    const i = this.#plans.findIndex((p) => p.id === plan.id)
    if (i >= 0) this.#plans[i] = plan
    else this.#plans.push(plan)
    this.#enregistrer()
    this.#deps.signaler?.()
    return plan
  }

  #plan(id: string): PlanDeLots | undefined {
    return this.#plans.find((p) => p.id === id)
  }

  plans(): readonly PlanDeLots[] {
    return this.#plans
  }

  /** Le plan que montre un fil : celui qu'il mène (chef), sinon celui dont il fait un lot. */
  planDuFil(fil: string): { plan: PlanDeLots; role: 'chef' | 'enfant'; rang?: number } | undefined {
    for (let i = this.#plans.length - 1; i >= 0; i--) {
      const p = this.#plans[i]
      if (p.chef === fil && p.statut !== 'remplace') return { plan: p, role: 'chef' }
    }
    for (let i = this.#plans.length - 1; i >= 0; i--) {
      const lot = this.#plans[i].lots.find((l) => l.fil === fil)
      if (lot) return { plan: this.#plans[i], role: 'enfant', rang: lot.rang }
    }
    return undefined
  }

  deposer(chef: string, brut: unknown): ResultatPlan {
    if (!chef.trim() || !this.#deps.existe(chef))
      return { ok: false, erreur: `fil chef « ${chef} » inconnu.` }
    // PAS DE PLAN DANS UN LOT (conv-1284) — claude.exe refuse qu'une session lancée par une autre
    // en démarre une à son tour : sans borne, un lot qui juge sa part « longue » ouvrait ses
    // propres fils, hors du tableau et du plafond du chef.
    const vu = this.planDuFil(chef)
    if (vu?.role === 'enfant' && PLAN_VIVANT.has(vu.plan.statut))
      return {
        ok: false,
        erreur: `ce fil fait le lot ${vu.rang} du plan ${vu.plan.id} (chef ${vu.plan.chef}) : un lot ne lance pas de plan à lui. Fais ta part ici ; s’il manque du travail au chantier, écris-le au chef (ecrire_a_un_fil vers ${vu.plan.chef}) — lui peut ajouter des lots.`
      }
    const lecture = lirePlanDeLots(brut)
    if (!lecture.ok) return { ok: false, erreur: lecture.erreur }
    const decision = decisionDeDepot(this.#plans, chef, empreintePlan(lecture.plan))
    if (decision.type === 'refus') return { ok: false, erreur: decision.raison }
    if (decision.type === 'existant')
      return {
        ok: true,
        plan: decision.plan,
        deja: true,
        detail: `Ce plan est déjà déposé (${decision.plan.id}, ${LIBELLE_STATUT[decision.plan.statut]}) : rien de nouveau.`
      }
    if (decision.remplace) {
      const ancien = this.#plan(decision.remplace)
      if (ancien) this.#poser({ ...ancien, statut: 'remplace' })
    }
    const plan = this.#poser(
      creerPlan(lecture.plan, {
        id: `plan-${this.#deps.nouvelId?.() ?? randomUUID().slice(0, 8)}`,
        chef,
        maintenant: this.#maintenant(),
        avertissements: lecture.avertissements
      })
    )
    return {
      ok: true,
      plan,
      detail:
        `Plan ${plan.id} déposé : ${plan.lots.length} lots, ${plan.parallele} fils en parallèle, plafond ${plan.plafondTours} tours.` +
        (lecture.avertissements.length
          ? ` Avertissements : ${lecture.avertissements.join(' ')}`
          : '')
    }
  }

  #planDuChef(chef: string, planId: string): PlanDeLots | { erreur: string } {
    const plan = this.#plan(planId)
    if (!plan || plan.chef !== chef)
      return { erreur: `plan ${planId} inconnu pour le fil ${chef}.` }
    return plan
  }

  /** LE clic de l'utilisateur. Un second clic sur un plan déjà lancé ne relance rien. */
  async accepter(chef: string, planId: string): Promise<ResultatPlan> {
    const plan = this.#planDuChef(chef, planId)
    if ('erreur' in plan) return { ok: false, erreur: plan.erreur }
    if (plan.statut === 'en-cours')
      return { ok: true, plan, deja: true, detail: 'plan déjà lancé.' }
    if (plan.statut !== 'attente-accord')
      return { ok: false, erreur: `plan ${LIBELLE_STATUT[plan.statut]} : rien à lancer.` }
    // Statut posé AVANT tout `await` : un double clic voit le plan déjà lancé.
    this.#poser({ ...plan, statut: 'en-cours' })
    await this.#lancerLesSuivants(planId)
    const apres = this.#plan(planId) ?? plan
    return { ok: true, plan: apres, detail: bilanDuPlan(apres).texte }
  }

  refuser(chef: string, planId: string): ResultatPlan {
    const plan = this.#planDuChef(chef, planId)
    if ('erreur' in plan) return { ok: false, erreur: plan.erreur }
    if (plan.statut !== 'attente-accord')
      return { ok: false, erreur: `plan ${LIBELLE_STATUT[plan.statut]} : rien à refuser.` }
    return { ok: true, plan: this.#poser({ ...plan, statut: 'refuse' }), detail: 'plan refusé.' }
  }

  /** Arrêt par l'utilisateur : aucun nouveau lot ne part ; les tours en cours finissent. */
  arreter(chef: string, planId: string): ResultatPlan {
    const plan = this.#planDuChef(chef, planId)
    if ('erreur' in plan) return { ok: false, erreur: plan.erreur }
    if (!['en-cours', 'suspendu-quota', 'interrompu'].includes(plan.statut))
      return { ok: false, erreur: `plan ${LIBELLE_STATUT[plan.statut]} : rien à arrêter.` }
    return {
      ok: true,
      plan: this.#poser({
        ...plan,
        statut: 'arrete',
        raison: 'arrêté par l’utilisateur : aucun nouveau lot ne part, les lots en cours finissent.'
      }),
      detail: 'plan arrêté.'
    }
  }

  /**
   * Un travail continue dans ce fil après un redémarrage : tour de chat repris, ou run rattaché ou
   * relancé (conv-1308). Son lot redevient en cours et sa fin, annoncée par `surFinDeTour`, enchaîne
   * la suite. Aucun tour n'est lancé ici : le travail existe déjà.
   */
  agentRepris(fil: string, tour?: string): void {
    for (const plan of [...this.#plans]) {
      const adopte = adopterLotRepris(plan, fil, tour)
      if (adopte !== plan) this.#poser(adopte)
    }
  }

  /** Reprise par l'utilisateur (quota, redémarrage, arrêt) : jamais automatique. */
  async reprendre(chef: string, planId: string): Promise<ResultatPlan> {
    const plan = this.#planDuChef(chef, planId)
    if ('erreur' in plan) return { ok: false, erreur: plan.erreur }
    const r = reprendrePlan(plan, this.#deps.tourActif)
    if (!r.ok) return { ok: false, erreur: r.erreur }
    this.#poser(r.plan)
    await this.#lancerLesSuivants(planId)
    const apres = this.#plan(planId) ?? r.plan
    return { ok: true, plan: apres, detail: bilanDuPlan(apres).texte }
  }

  /**
   * Relance d'un lot en échec : par l'agent du chef (`plan_de_lots`), ou par l'utilisateur au
   * bouton « Relancer » du tableau (conv-1151, lot 3), qui nomme alors le plan qu'il VOIT — un
   * tableau périmé ne relance pas un lot d'un autre plan. Même règle et même tour compté.
   */
  async relancer(chef: string, rang: number, planId?: string): Promise<ResultatPlan> {
    let plan: PlanDeLots
    if (planId === undefined) {
      const vu = this.planDuFil(chef)
      if (!vu || vu.role !== 'chef') return { ok: false, erreur: 'aucun plan mené par ce fil.' }
      plan = vu.plan
    } else {
      const lu = this.#planDuChef(chef, planId)
      if ('erreur' in lu) return { ok: false, erreur: lu.erreur }
      plan = lu
    }
    const r = relancerLot(plan, rang)
    if (!r.ok) return { ok: false, erreur: r.erreur }
    this.#poser(r.plan)
    await this.#lancerLesSuivants(r.plan.id)
    const apres = this.#plan(r.plan.id) ?? r.plan
    return {
      ok: true,
      plan: apres,
      detail: `lot ${rang} remis en file. ${bilanDuPlan(apres).texte}`
    }
  }

  /** L'outil `plan_de_lots` de l'agent du chat. Un refus lève une erreur lisible. */
  async outil(chef: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!chef?.trim())
      throw new Error(
        "plan_de_lots : aucun fil connu — l'outil ne sert qu'à l'agent d'un fil de conversation."
      )
    const action =
      typeof args.action === 'string' && args.action.trim()
        ? args.action.trim()
        : args.plan !== undefined
          ? 'deposer'
          : 'etat'
    const resume = (p: PlanDeLots): Record<string, unknown> => ({
      id: p.id,
      statut: LIBELLE_STATUT[p.statut],
      ...(p.raison ? { raison: p.raison } : {}),
      bilan: bilanDuPlan(p).texte
    })
    if (action === 'deposer') {
      const r = this.deposer(chef, args.plan)
      if (!r.ok) throw new Error(`plan_de_lots : ${r.erreur}`)
      // LANCEMENT SANS CLIC (conv-1171, 2026-10-27) : « je ne veux pas avoir à confirmer, je veux que
      // ça se lance tout seul ». Le dépôt par l'agent vaut lancement ; l'utilisateur garde
      // « Arrêter » dans le tableau. Un plan déjà lancé (même contenu redéposé) n'est pas relancé.
      if (r.plan.statut !== 'attente-accord')
        return { ok: true, plan: resume(r.plan), detail: r.detail }
      const lance = await this.accepter(chef, r.plan.id)
      if (!lance.ok)
        throw new Error(`plan_de_lots : plan ${r.plan.id} déposé mais non lancé — ${lance.erreur}`)
      return {
        ok: true,
        plan: resume(lance.plan),
        detail:
          `${r.detail} LANCÉ : ${lance.detail}. L’app ouvre un fil par lot et te réveillera à chaque fin de lot ; ` +
          'l’utilisateur peut l’arrêter dans le tableau au-dessus de la zone de saisie. Dis-le-lui en une phrase, puis termine ton tour.'
      }
    }
    if (action === 'etat') {
      const vu = this.planDuFil(chef)
      if (!vu) return { ok: true, plan: null, detail: 'aucun plan dans ce fil.' }
      return {
        ok: true,
        role: vu.role,
        ...(vu.rang ? { lot: vu.rang } : {}),
        plan: resume(vu.plan),
        tableau: tableauTexte(vu.plan)
      }
    }
    if (action === 'noter') {
      const vu = this.planDuFil(chef)
      if (!vu) throw new Error('plan_de_lots : aucun plan dans ce fil — rien où noter.')
      const de = vu.role === 'chef' ? 'chef' : `lot ${vu.rang}`
      const r = noterDecision(vu.plan, args.decision, de, this.#maintenant())
      if (!r.ok) throw new Error(`plan_de_lots : ${r.erreur}`)
      if (r.deja)
        return { ok: true, plan: resume(r.plan), detail: 'décision déjà notée : rien de nouveau.' }
      this.#poser(r.plan)
      const decision = (r.plan.decisions ?? []).at(-1)
      const prevenus = decision ? this.#prevenirLesLotsEnCours(r.plan, chef, decision) : []
      return {
        ok: true,
        plan: resume(r.plan),
        detail:
          `décision notée (${de}) : ` +
          (prevenus.length
            ? `envoyée aux lots en cours : ${prevenus.join(', ')} ; `
            : 'aucun lot en cours à prévenir ; ') +
          'les lots qui partent ou repartent ensuite la recevront dans leur demande.'
      }
    }
    if (action === 'ajouter') {
      const vu = this.planDuFil(chef)
      if (!vu || vu.role !== 'chef')
        throw new Error('plan_de_lots : seul le fil chef ajoute des lots à son plan.')
      const avant = vu.plan.lots.length
      const r = ajouterLots(vu.plan, args.plan ?? args.lots)
      if (!r.ok) throw new Error(`plan_de_lots : ${r.erreur}`)
      this.#poser(r.plan)
      await this.#lancerLesSuivants(r.plan.id)
      const apres = this.#plan(r.plan.id) ?? r.plan
      const ajoutes = apres.lots.length - avant
      return {
        ok: true,
        plan: resume(apres),
        detail:
          `${ajoutes} lot${ajoutes > 1 ? 's' : ''} ajouté${ajoutes > 1 ? 's' : ''} (rang${ajoutes > 1 ? 's' : ''} ${avant + 1}${ajoutes > 1 ? ` à ${apres.lots.length}` : ''}), plafond porté à ${apres.plafondTours} tours.` +
          (r.avertissements.length ? ` Avertissements : ${r.avertissements.join(' ')}` : '')
      }
    }
    if (action === 'relancer') {
      const rang = Number(args.lot)
      if (!Number.isInteger(rang) || rang < 1)
        throw new Error('plan_de_lots : « lot » — numéro du lot à relancer attendu (1, 2…).')
      const r = await this.relancer(chef, rang)
      if (!r.ok) throw new Error(`plan_de_lots : ${r.erreur}`)
      return { ok: true, plan: resume(r.plan), detail: r.detail }
    }
    throw new Error(
      `plan_de_lots : action « ${action} » inconnue. Actions : deposer, etat, relancer, noter, ajouter.`
    )
  }

  /**
   * Fin d'un tour de chat, dans n'importe quel fil. Ne lève jamais : un défaut ici ne doit pas
   * remonter dans le tour qui vient de finir.
   */
  async surFinDeTour(fil: string, issue: IssueDuTour): Promise<void> {
    try {
      // 1. Le fil est un chef : son tour vient de finir, les comptes rendus en attente partent.
      if (this.#reveilEnCours.delete(fil) || this.#enAttente.has(fil)) await this.#reveiller(fil)
      // 2. Le fil fait un lot : en cours, ou interrompu dont l'agent a survécu au redémarrage.
      const plan = this.#plans.find((p) =>
        p.lots.some(
          (l) =>
            l.fil === fil && (l.etat === 'en-cours' || (l.etat === 'interrompu' && issue.repris))
        )
      )
      if (!plan) {
        // 3. Un lot attendait que son fil se libère (`lotsAPartir`, fil occupé) : il part maintenant.
        const enAttente = this.#plans.find(
          (p) =>
            p.statut === 'en-cours' && p.lots.some((l) => l.fil === fil && l.etat === 'a-faire')
        )
        if (enAttente) await this.#lancerLesSuivants(enAttente.id)
        return
      }
      const note = noterFinDeTour(plan, fil, issue, this.#maintenant())
      if (note.effet !== 'note' || !note.lot) return
      const suivant = note.plan
      if (!this.#deps.existe(plan.chef)) {
        this.#poser(this.#arretChefSupprime(suivant))
        return
      }
      this.#poser(suivant)
      try {
        this.#deps.ecrire(fil, plan.chef, compteRenduDuLot(suivant, note.lot, issue.texte))
      } catch (e) {
        // Le tableau et le réveil portent l'essentiel : le compte rendu manque, rien d'autre.
        this.#journal(`compte rendu du lot ${note.lot.rang} non écrit au chef ${plan.chef}`, e)
      }
      await this.#lancerLesSuivants(plan.id)
      this.#noterAttente(plan.chef, plan.id, note.lot.rang)
      await this.#reveiller(plan.chef)
    } catch (e) {
      this.#journal(`fin de tour de ${fil} non traitée`, e)
    }
  }

  /**
   * Une décision notée va aussi, par message, aux lots EN COURS (conv-1284, demande de
   * l'utilisateur) : sans cela un lot déjà parti travaillait jusqu'au bout sur une consigne
   * périmée. L'expéditeur est le fil qui a noté ; ni lui ni un lot fini ne la reçoivent. Un envoi
   * refusé (plafond horaire, fil disparu) ne bloque ni la note ni les autres envois. Rend les fils
   * prévenus.
   */
  #prevenirLesLotsEnCours(
    plan: PlanDeLots,
    auteur: string,
    decision: { texte: string; de: string }
  ): string[] {
    const prevenus: string[] = []
    for (const lot of plan.lots) {
      if (lot.etat !== 'en-cours' || !lot.fil || lot.fil === auteur || !this.#deps.existe(lot.fil))
        continue
      try {
        this.#deps.ecrire(auteur, lot.fil, messageDeDecision(plan, decision))
        prevenus.push(lot.fil)
      } catch (e) {
        this.#journal(`décision non envoyée au lot ${lot.rang} (${lot.fil})`, e)
      }
    }
    return prevenus
  }

  /**
   * LE LOT BLOQUÉ RÉVEILLÉ PAR L'ORDRE DU CHEF (conv-1284, 2026-10-29, demande de l'utilisateur :
   * « réveiller directement un lot bloqué par la réponse du chef » au lieu de répondre puis relancer).
   * `ecrire_a_un_fil` (commands.ts) fait passer par ici le lancement du tour d'un ordre : si
   * l'expéditeur est le CHEF d'un plan et le destinataire le fil d'un de ses lots qui ATTEND sa
   * réponse (« attend le chef ») ou en ÉCHEC, ce tour
   * vaut relance — mêmes règles que `relancerLot` (plafond, quota), un tour compté, le lot marqué en
   * cours AVANT le lancement (aucun second agent par `#lancerLesSuivants`), et sa fin notée comme
   * celle d'un lot. Tout autre ordre part tel quel. Un refus (plafond) ne lance rien : l'ordre reste
   * en attente et la raison remonte au chef par le détail de son envoi. Le tour part avec le MODÈLE
   * du lot : sans lui, le lot 1 du test réel (conv-1299, en sonnet) avait repris en opus.
   */
  async lancerParOrdre(
    de: string,
    fil: string,
    prompt: string,
    lancer: (
      fil: string,
      prompt: string,
      modele?: string
    ) => Promise<{ ok: boolean; turnId?: string; error?: string }>
  ): Promise<{ ok: boolean; turnId?: string; error?: string }> {
    const reprenable = (l: LotDuPlan): boolean =>
      l.fil === fil && (l.etat === 'attend-chef' || l.etat === 'echec')
    const plan = this.#plans.find((p) => p.chef === de && p.lots.some(reprenable))
    const lot = plan?.lots.find(reprenable)
    if (!plan || !lot) return lancer(fil, prompt)
    const relance = relancerLot(plan, lot.rang)
    if (!relance.ok)
      return { ok: false, error: `lot ${lot.rang} du plan ${plan.id} : ${relance.erreur}` }
    const lance = this.#poser(marquerLance(relance.plan, lot.rang, fil, this.#maintenant()))
    const lotLance = lance.lots.find((l) => l.rang === lot.rang) ?? lot
    let r: { ok: boolean; turnId?: string; error?: string }
    try {
      const suite = prompt + suiteDeLOrdreAuLot(lance, lotLance)
      r = lotLance.modele ? await lancer(fil, suite, lotLance.modele) : await lancer(fil, suite)
    } catch (e) {
      r = { ok: false, error: (e as Error)?.message ?? String(e) }
    }
    if (r.ok) {
      const apres = this.#plan(plan.id)
      if (apres && r.turnId) {
        const avecTour = noterTourDuLot(apres, lot.rang, r.turnId)
        if (avecTour !== apres) this.#poser(avecTour)
      }
      return r
    }
    // Même sortie qu'un lancement refusé (`#lancerUnLot`) : le lot repasse en échec, le chef le saura.
    await this.surFinDeTour(fil, {
      ok: false,
      erreur: `réveil par l’ordre du chef non lancé : ${r.error ?? 'raison inconnue'}`,
      nonDemarre: true
    })
    return r
  }

  #arretChefSupprime(plan: PlanDeLots): PlanDeLots {
    const actif: StatutDuPlan[] = ['en-cours', 'suspendu-quota', 'interrompu', 'attente-accord']
    return actif.includes(plan.statut)
      ? { ...plan, statut: 'arrete', raison: 'fil chef supprimé : aucun lot ne repart.' }
      : plan
  }

  #noterAttente(chef: string, planId: string, rang: number): void {
    const attente = this.#enAttente.get(chef)
    if (attente && attente.planId === planId) attente.rangs.add(rang)
    else this.#enAttente.set(chef, { planId, rangs: new Set([rang]) })
  }

  /** Réveille le chef s'il a des comptes rendus en attente et qu'aucun tour n'y tourne. */
  async #reveiller(chef: string): Promise<void> {
    const attente = this.#enAttente.get(chef)
    if (!attente?.rangs.size || this.#reveilEnCours.has(chef)) return
    const plan = this.#plan(attente.planId)
    if (!plan) {
      this.#enAttente.delete(chef)
      return
    }
    if (!this.#deps.existe(chef)) {
      this.#enAttente.delete(chef)
      this.#poser(this.#arretChefSupprime(plan))
      return
    }
    // Chef occupé : il lira le compte rendu à son prochain outil ; le réveil part à la fin du tour.
    if (this.#deps.tourActif(chef)) return
    this.#enAttente.delete(chef)
    this.#reveilEnCours.add(chef)
    let r: { ok: boolean; error?: string }
    try {
      r = await this.#deps.lancer(chef, promptDeReveil(plan, [...attente.rangs]))
    } catch (e) {
      r = { ok: false, error: (e as Error)?.message ?? String(e) }
    }
    if (!r.ok) {
      // Pas de tour lancé : la fin de tour attendue ne viendra pas. Les rangs restent en attente
      // pour le prochain tour du chef, quel qu'il soit.
      this.#reveilEnCours.delete(chef)
      for (const rang of attente.rangs) this.#noterAttente(chef, attente.planId, rang)
      this.#journal(`réveil du chef ${chef} non lancé`, r.error)
    }
  }

  /**
   * Lance tout ce qui peut partir. Chaque lot est MARQUÉ lancé avant le moindre `await` : un appel
   * concurrent (fin d'un autre lot, double clic) voit la place prise et ne le relance pas.
   */
  async #lancerLesSuivants(planId: string): Promise<void> {
    const lancements: Array<Promise<void>> = []
    for (;;) {
      const plan = this.#plan(planId)
      if (!plan) break
      if (plan.statut === 'en-cours' && !this.#deps.existe(plan.chef)) {
        this.#poser(this.#arretChefSupprime(plan))
        break
      }
      // Jamais un second agent dans un fil où un tour tourne encore (agent repris, saisie manuelle).
      const [rang] = lotsAPartir(plan, this.#deps.tourActif)
      if (rang === undefined) {
        const recalcule = statutApresLancements(plan)
        if (recalcule !== plan) this.#poser(recalcule)
        break
      }
      const lot = plan.lots.find((l) => l.rang === rang)
      if (!lot) break
      let fil = lot.fil && this.#deps.existe(lot.fil) ? lot.fil : undefined
      if (!fil) {
        try {
          fil = this.#deps.creerFil(plan.chef, `Lot ${rang}/${plan.lots.length} — ${lot.titre}`)
        } catch (e) {
          this.#poser(
            marquerEchec(
              plan,
              rang,
              `fil non créé : ${(e as Error)?.message ?? e}`,
              this.#maintenant()
            )
          )
          continue
        }
      }
      const lance = this.#poser(marquerLance(plan, rang, fil, this.#maintenant()))
      const lotLance = lance.lots.find((l) => l.rang === rang) ?? lot
      lancements.push(
        this.#lancerUnLot(planId, rang, fil, promptDuLot(lance, lotLance), lotLance.modele)
      )
    }
    await Promise.all(lancements)
  }

  async #lancerUnLot(
    planId: string,
    rang: number,
    fil: string,
    prompt: string,
    modele?: string
  ): Promise<void> {
    let r: { ok: boolean; turnId?: string; error?: string }
    try {
      r = modele
        ? await this.#deps.lancer(fil, prompt, modele)
        : await this.#deps.lancer(fil, prompt)
    } catch (e) {
      r = { ok: false, error: (e as Error)?.message ?? String(e) }
    }
    if (r.ok) {
      const plan = this.#plan(planId)
      if (plan && r.turnId) {
        const avecTour = noterTourDuLot(plan, rang, r.turnId)
        if (avecTour !== plan) this.#poser(avecTour)
      }
      return
    }
    await this.surFinDeTour(fil, {
      ok: false,
      erreur: `lancement refusé : ${r.error ?? 'raison inconnue'}`,
      nonDemarre: true
    })
  }
}
