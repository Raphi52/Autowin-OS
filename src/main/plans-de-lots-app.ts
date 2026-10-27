import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import {
  LIBELLE_STATUT,
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
  noterFinDeTour,
  noterTourDuLot,
  promptDeReveil,
  promptDuLot,
  relancerLot,
  reprendrePlan,
  statutApresLancements,
  type IssueDuTour,
  type PlanDeLots,
  type StatutDuPlan
} from '../shared/plan-de-lots'

/**
 * SUPER CONVERSATION, CÔTÉ APP (conv-1150, 2026-10-26) — le coordinateur des plans de lots.
 *
 * Le fil chef dépose un plan (`plan_de_lots`) ; l'utilisateur l'accepte d'UN clic (tableau du fil,
 * canal `os:plansDeLots`). Ensuite l'app, et non l'agent :
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
  /** Lance un tour dans le fil ; rend la main au démarrage du tour (`lancerDansConversation`). */
  lancer: (fil: string, prompt: string) => Promise<{ ok: boolean; turnId?: string; error?: string }>
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

const ETATS = new Set(['a-faire', 'en-cours', 'fait', 'echec', 'interrompu'])
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
      // agent a pu survivre (`reprendreAppelChat`, index.ts) : sa fin, annoncée `repris`, compte
      // encore, et « Reprendre » adopte un lot dont le fil tourne au lieu d'y lancer un second agent.
      const apres = interrompreAuDemarrage({
        ...p,
        avertissements: p.avertissements ?? []
      })
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
          : '') +
        ' RIEN N’EST LANCÉ : l’utilisateur doit cliquer « Lancer le plan » dans le tableau au-dessus de la zone de saisie de ce fil. Dis-le-lui en une phrase, puis termine ton tour : l’app te réveillera à chaque fin de lot.'
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
      return { ok: true, plan: resume(r.plan), detail: r.detail }
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
    if (action === 'relancer') {
      const rang = Number(args.lot)
      if (!Number.isInteger(rang) || rang < 1)
        throw new Error('plan_de_lots : « lot » — numéro du lot à relancer attendu (1, 2…).')
      const r = await this.relancer(chef, rang)
      if (!r.ok) throw new Error(`plan_de_lots : ${r.erreur}`)
      return { ok: true, plan: resume(r.plan), detail: r.detail }
    }
    throw new Error(
      `plan_de_lots : action « ${action} » inconnue. Actions : deposer, etat, relancer.`
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
      lancements.push(this.#lancerUnLot(planId, rang, fil, promptDuLot(lance, lotLance)))
    }
    await Promise.all(lancements)
  }

  async #lancerUnLot(planId: string, rang: number, fil: string, prompt: string): Promise<void> {
    let r: { ok: boolean; turnId?: string; error?: string }
    try {
      r = await this.#deps.lancer(fil, prompt)
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
      erreur: `lancement refusé : ${r.error ?? 'raison inconnue'}`
    })
  }
}
