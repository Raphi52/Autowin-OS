import type { WatchdogGuards } from './types'
export { lineSignature } from './watchdog-line'

/**
 * Les bornes d'un declencheur EVENEMENTIEL. Module PUR (une horloge injectee, aucun etat global) —
 * c'est la piece qu'il faut pouvoir eprouver sans monter d'app.
 *
 * Pourquoi ces gardes n'existaient pas pour les taches horaires : une heure se produit une fois. Un
 * evenement, lui, arrive en rafale (un log qui deraille en ecrit mille par seconde) et, quand l'agent
 * reveille a l'autorite d'ECRIRE, il peut produire lui-meme le prochain evenement. Un declencheur
 * evenementiel sans borne n'est pas une fonctionnalite fragile : c'est une boucle qui ecrit sur le
 * poste sans temoin.
 *
 * Les trois refus, dans l'ordre ou ils sont evalues :
 *  1. `depth`   — la chaine causale est trop profonde (anti-recursion) ;
 *  2. `dedup`   — ce signal exact vient d'etre traite (fenetre d'apaisement) ;
 *  3. `rate`    — le plafond horaire de cette regle est atteint.
 * L'ordre compte : un signal refuse pour profondeur ne doit pas consommer le budget horaire.
 */

export type WatchdogRejection =
  'depth' | 'dedup' | 'rate' | 'daily-rate' | 'cost-budget' | 'unpriced-budget' | 'root-width'

export type WatchdogVerdict =
  { admitted: true } | { admitted: false; reason: WatchdogRejection; detail: string }

export interface WatchdogAdmission {
  eventId?: string
  signature: string
  rootSignature: string
  admittedAt: number
  knownCostUsd?: number
  unpricedCalls?: number
}

/** Valeurs par defaut : genereuses pour l'usage normal, fermes sur les trois pathologies. */
export const DEFAULT_WATCHDOG_GUARDS: WatchdogGuards = {
  dedupWindowMs: 60_000,
  maxTriggersPerHour: 12,
  // 0 par defaut : un reveil ne peut PAS en engendrer un autre. C'est le reglage sur : l'utilisateur
  // qui veut une chaine doit la demander explicitement.
  maxChainDepth: 0,
  // Borne la LARGEUR d'une cascade. Sans elle, une chaine peu profonde mais qui s'elargit passe
  // toutes les autres gardes (mesure du depot : 8 -> 11 -> 104 -> 681 par niveau).
  maxPerRoot: 20
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export class WatchdogGuardBook {
  /** Derniere admission par signature, pour la fenetre d'apaisement. */
  private readonly lastAdmitted = new Map<string, number>()
  /** Horodatages des admissions sur 24 h ; le compteur horaire en est une fenetre. */
  private readonly admissions: number[] = []
  /** Reglements connus sur 24 h, separes des admissions car le provider solde apres le reveil. */
  private readonly settlements: Array<{
    eventId?: string
    at: number
    knownCostUsd: number
    unpricedCalls: number
  }> = []
  /** Admissions récentes par cause racine, pour borner la largeur sans retenir les racines à vie. */
  private readonly perRoot = new Map<string, number[]>()

  constructor(
    private guards: WatchdogGuards,
    private readonly now: () => number
  ) {}

  updateGuards(guards: WatchdogGuards): void {
    this.guards = guards
  }

  /**
   * Recharge les admissions persistées après un redémarrage/HMR. Sans cette étape, les limites
   * affichées dans le Task Manager existent bien sur disque mais le moteur repart à zéro et peut
   * relancer plusieurs Auto-kaizen sur le même incident.
   */
  restore(admissions: readonly WatchdogAdmission[]): void {
    const at = this.now()
    for (const admission of admissions
      .filter(
        ({ signature, rootSignature, admittedAt }) =>
          signature.length > 0 &&
          rootSignature.length > 0 &&
          Number.isFinite(admittedAt) &&
          admittedAt <= at &&
          at - admittedAt < DAY_MS
      )
      .sort((left, right) => left.admittedAt - right.admittedAt)) {
      const previous = this.lastAdmitted.get(admission.signature)
      if (previous === undefined || admission.admittedAt > previous) {
        this.lastAdmitted.set(admission.signature, admission.admittedAt)
      }
      this.admissions.push(admission.admittedAt)
      if (
        (typeof admission.knownCostUsd === 'number' && admission.knownCostUsd > 0) ||
        (typeof admission.unpricedCalls === 'number' && admission.unpricedCalls > 0)
      ) {
        this.settlements.push({
          ...(admission.eventId ? { eventId: admission.eventId } : {}),
          at: admission.admittedAt,
          knownCostUsd: Math.max(0, admission.knownCostUsd ?? 0),
          unpricedCalls: Math.max(0, Math.floor(admission.unpricedCalls ?? 0))
        })
      }
      const fromRoot = this.perRoot.get(admission.rootSignature) ?? []
      fromRoot.push(admission.admittedAt)
      this.perRoot.set(admission.rootSignature, fromRoot)
    }
  }

  /**
   * Decide si un signal merite de reveiller un agent. N'enregistre l'admission QUE si elle passe :
   * un signal refuse ne doit pas peser sur les refus suivants, sinon une rafale refusee finirait par
   * murer la regle contre un signal legitime.
   */
  admit(signature: string, depth: number, rootSignature = signature): WatchdogVerdict {
    const at = this.now()

    if (depth > this.guards.maxChainDepth) {
      return {
        admitted: false,
        reason: 'depth',
        detail:
          `Chaine causale trop profonde (${depth} > ${this.guards.maxChainDepth}) : ce reveil a ete ` +
          `provoque par un reveil precedent. Arret pour ne pas boucler.`
      }
    }

    this.forgetOlderThanADay(at)

    const previous = this.lastAdmitted.get(signature)
    if (previous !== undefined && at - previous < this.guards.dedupWindowMs) {
      return {
        admitted: false,
        reason: 'dedup',
        detail: `Signal identique deja traite il y a ${at - previous} ms (fenetre ${this.guards.dedupWindowMs} ms).`
      }
    }

    // Largeur AVANT budget horaire : une cascade qui s'elargit ne doit pas consommer le quota de
    // la regle, sinon elle etouffe les signaux legitimes en plus de se propager.
    const fromRoot = this.perRoot.get(rootSignature) ?? []
    while (fromRoot.length && at - fromRoot[0] >= HOUR_MS) fromRoot.shift()
    if (fromRoot.length >= this.guards.maxPerRoot) {
      return {
        admitted: false,
        reason: 'root-width',
        detail:
          `Cascade trop LARGE : ${fromRoot.length} reveils issus de la meme cause racine ` +
          `(plafond ${this.guards.maxPerRoot}). La profondeur tenait, la largeur non.`
      }
    }

    const dailyLimit = this.guards.maxTriggersPerDay
    if (dailyLimit !== undefined && this.admissions.length >= dailyLimit) {
      return {
        admitted: false,
        reason: 'daily-rate',
        detail: `Plafond atteint : ${dailyLimit} reveils sur les 24 dernieres heures.`
      }
    }

    const knownCostUsd = this.settlements.reduce(
      (sum, settlement) => sum + settlement.knownCostUsd,
      0
    )
    const costLimit = this.guards.maxKnownCostUsdPerDay
    if (costLimit !== undefined && knownCostUsd >= costLimit) {
      return {
        admitted: false,
        reason: 'cost-budget',
        detail: `Budget atteint : ${knownCostUsd.toFixed(4)} $ connus sur 24 h (plafond ${costLimit.toFixed(4)} $).`
      }
    }

    const unpricedCalls = this.settlements.reduce(
      (sum, settlement) => sum + settlement.unpricedCalls,
      0
    )
    const unpricedLimit = this.guards.maxUnpricedCallsPerDay
    if (unpricedLimit !== undefined && unpricedCalls >= unpricedLimit) {
      return {
        admitted: false,
        reason: 'unpriced-budget',
        detail: `Budget inconnu atteint : ${unpricedCalls} appel(s) non chiffre(s) sur 24 h (plafond ${unpricedLimit}).`
      }
    }

    const admittedLastHour = this.admissions.filter(
      (admittedAt) => at - admittedAt < HOUR_MS
    ).length
    if (admittedLastHour >= this.guards.maxTriggersPerHour) {
      return {
        admitted: false,
        reason: 'rate',
        detail: `Plafond atteint : ${this.guards.maxTriggersPerHour} reveils sur l'heure glissante.`
      }
    }

    this.lastAdmitted.set(signature, at)
    this.admissions.push(at)
    fromRoot.push(at)
    this.perRoot.set(rootSignature, fromRoot)
    return { admitted: true }
  }

  /**
   * Enregistre un cout SOLDE apres coup.
   *
   * Le provider ne facture pas au moment du reveil : il solde plus tard, parfois apres la fin du
   * tour. Sans ce point d'entree, les plafonds de cout ne verraient que ce qui etait connu a
   * l'admission — c'est-a-dire presque rien — et ne mordraient jamais.
   *
   * `eventId` deduplique une publication rejouable : le meme reglage republie au redemarrage ne doit
   * pas etre compte deux fois contre le budget.
   */
  recordSettlement(usage: {
    eventId?: string
    knownCostUsd?: number
    unpricedCalls?: number
  }): void {
    const knownCostUsd = Math.max(0, usage.knownCostUsd ?? 0)
    const unpricedCalls = Math.max(0, Math.floor(usage.unpricedCalls ?? 0))
    if (!knownCostUsd && !unpricedCalls) return
    if (usage.eventId && this.settlements.some((entry) => entry.eventId === usage.eventId)) return
    const at = this.now()
    this.forgetOlderThanADay(at)
    this.settlements.push({
      ...(usage.eventId ? { eventId: usage.eventId } : {}),
      at,
      knownCostUsd,
      unpricedCalls
    })
  }

  /** Reveils admis sur l'heure glissante — sert au compteur visible dans la vue. */
  admittedLastHour(): number {
    const at = this.now()
    this.forgetOlderThanADay(at)
    return this.admissions.filter((admittedAt) => at - admittedAt < HOUR_MS).length
  }

  /**
   * Oublie ce qui est sorti de la fenetre de 24 h.
   *
   * Les trois collections vieillissent ENSEMBLE : admissions (plafonds horaire et quotidien),
   * reglements (le provider solde APRES le reveil, donc plus tard que l'admission) et racines de
   * cascade. Les purger separement laisserait un plafond mordre sur des donnees qu'un autre a deja
   * oubliees, et la regle deviendrait impossible a expliquer.
   */
  private forgetOlderThanADay(at: number): void {
    while (this.admissions.length && at - this.admissions[0] >= DAY_MS) this.admissions.shift()
    while (this.settlements.length && at - this.settlements[0].at >= DAY_MS)
      this.settlements.shift()
    for (const [root, stamps] of this.perRoot) {
      while (stamps.length && at - stamps[0] >= DAY_MS) stamps.shift()
      if (!stamps.length) this.perRoot.delete(root)
    }
    for (const [signature, seenAt] of this.lastAdmitted) {
      if (at - seenAt >= DAY_MS) this.lastAdmitted.delete(signature)
    }
  }
}
