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

export type WatchdogRejection = 'depth' | 'dedup' | 'rate' | 'root-width'

export type WatchdogVerdict =
  { admitted: true } | { admitted: false; reason: WatchdogRejection; detail: string }

export interface WatchdogAdmission {
  signature: string
  rootSignature: string
  admittedAt: number
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

export class WatchdogGuardBook {
  /** Derniere admission par signature, pour la fenetre d'apaisement. */
  private readonly lastAdmitted = new Map<string, number>()
  /** Horodatages des admissions, pour le plafond horaire. */
  private readonly admissions: number[] = []
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
          at - admittedAt < HOUR_MS
      )
      .sort((left, right) => left.admittedAt - right.admittedAt)) {
      const previous = this.lastAdmitted.get(admission.signature)
      if (previous === undefined || admission.admittedAt > previous) {
        this.lastAdmitted.set(admission.signature, admission.admittedAt)
      }
      this.admissions.push(admission.admittedAt)
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

    this.forgetOlderThanAnHour(at)
    if (this.admissions.length >= this.guards.maxTriggersPerHour) {
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

  /** Reveils admis sur l'heure glissante — sert au compteur visible dans la vue. */
  admittedLastHour(): number {
    this.forgetOlderThanAnHour(this.now())
    return this.admissions.length
  }

  private forgetOlderThanAnHour(at: number): void {
    while (this.admissions.length && at - this.admissions[0] >= HOUR_MS) this.admissions.shift()
    for (const [root, admissions] of this.perRoot) {
      while (admissions.length && at - admissions[0] >= HOUR_MS) admissions.shift()
      if (admissions.length === 0) this.perRoot.delete(root)
    }
  }
}
