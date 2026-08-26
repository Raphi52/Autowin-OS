import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Usage } from './providers/types'
import type { ExecutionQuote } from './execution-quote'
import { splitInputTokens } from '../shared/cost-estimate'
import { refusAvecIssue } from './issue-de-refus'

export type TokenCoverage = 'complete' | 'partial'

export interface ExecutionUsageSnapshot {
  quoteId: string
  /** Nombre d'agents CLI admis. Optionnel pour relire les checkpoints anterieurs a ce compteur. */
  startedAgents?: number
  startedCalls: number
  completedCalls: number
  failedCalls: number
  activeCalls: number
  /** Identités causales des réservations encore actives, persistées avec leur agent exact. */
  activeReservationIds?: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /**
   * OPTIONNEL a dessein : le runtime le renseigne toujours, mais l'exiger invaliderait une douzaine
   * d'instantanes deja persistes (et de fixtures) qui n'ont jamais porte ce compteur.
   */
  cacheCreationTokens?: number
  totalTokens: number
  freshTokens: number
  knownCostUsd: number | null
  unpricedCalls: number
  unmeteredCalls: number
  tokenCoverage: TokenCoverage
  stoppedReason?: string
}

type ComparableExecutionUsage = Omit<ExecutionUsageSnapshot, 'quoteId'> & { quoteId?: string }

/** Comparaison explicite pour dedupliquer les publications terminales sans masquer un compteur. */
export function sameExecutionUsage(
  left: ComparableExecutionUsage | undefined,
  right: ComparableExecutionUsage | undefined
): boolean {
  if (!left || !right) return left === right
  const leftReservations = [...(left.activeReservationIds ?? [])].sort()
  const rightReservations = [...(right.activeReservationIds ?? [])].sort()
  return (
    (left.quoteId === undefined || right.quoteId === undefined || left.quoteId === right.quoteId) &&
    left.startedAgents === right.startedAgents &&
    left.startedCalls === right.startedCalls &&
    left.completedCalls === right.completedCalls &&
    left.failedCalls === right.failedCalls &&
    left.activeCalls === right.activeCalls &&
    leftReservations.length === rightReservations.length &&
    leftReservations.every((id, index) => id === rightReservations[index]) &&
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheCreationTokens === right.cacheCreationTokens &&
    left.totalTokens === right.totalTokens &&
    left.freshTokens === right.freshTokens &&
    left.knownCostUsd === right.knownCostUsd &&
    left.unpricedCalls === right.unpricedCalls &&
    left.unmeteredCalls === right.unmeteredCalls &&
    left.tokenCoverage === right.tokenCoverage &&
    left.stoppedReason === right.stoppedReason
  )
}

interface ExecutionRuntime {
  executionId: string
  quote: ExecutionQuote
  deadlineAtMs: number
  /**
   * Reamorce l'echeance d'IMMOBILITE. Appele a chaque progression observable d'un appel provider.
   * Absent hors execution, et retire des la fin du run pour qu'un reglage tardif ne rearme rien.
   */
  progresse?: () => void
  controller: AbortController
  signal: AbortSignal
  startedAgents: number
  startedCalls: number
  completedCalls: number
  failedCalls: number
  activeCalls: number
  activeReservationIds: Set<string>
  reservedTotalTokens: number
  reservedFreshTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  freshTokens: number
  knownCostUsd: number
  pricedCalls: number
  unpricedCalls: number
  unmeteredCalls: number
  finished: boolean
  onLateSettlement?: (usage: ExecutionUsageSnapshot) => void
  stoppedReason?: string
}

interface ProviderReservation {
  id: string
  signal: AbortSignal
  complete: (usage?: Usage) => void
  fail: (usage?: Usage) => void
  /** Annule tout le run sans prétendre que le provider sous-jacent s'est déjà arrêté. */
  abort: (reason: string) => void
}

export class ExecutionBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionBudgetExceededError'
  }
}

function combinedSignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const available = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (available.length === 0) return new AbortController().signal
  if (available.length === 1) return available[0]
  return AbortSignal.any(available)
}

function snapshot(runtime: ExecutionRuntime): ExecutionUsageSnapshot {
  return {
    quoteId: runtime.quote.id,
    startedAgents: runtime.startedAgents,
    startedCalls: runtime.startedCalls,
    completedCalls: runtime.completedCalls,
    failedCalls: runtime.failedCalls,
    activeCalls: runtime.activeCalls,
    activeReservationIds: [...runtime.activeReservationIds],
    inputTokens: runtime.inputTokens,
    outputTokens: runtime.outputTokens,
    cacheReadTokens: runtime.cacheReadTokens,
    cacheCreationTokens: runtime.cacheCreationTokens,
    totalTokens: runtime.totalTokens,
    freshTokens: runtime.freshTokens,
    knownCostUsd: runtime.pricedCalls > 0 ? runtime.knownCostUsd : null,
    unpricedCalls: runtime.unpricedCalls,
    unmeteredCalls: runtime.unmeteredCalls,
    tokenCoverage: runtime.unmeteredCalls > 0 ? 'partial' : 'complete',
    ...(runtime.stoppedReason ? { stoppedReason: runtime.stoppedReason } : {})
  }
}

/**
 * Autorite unique d'admission des appels provider d'un run. AsyncLocalStorage garde les compteurs
 * locaux au run, y compris quand plusieurs orchestrations s'entrelacent dans le process principal.
 */
/**
 * Raison d'un arret par IMMOBILITE. Le texte dit explicitement que ce n'est PAS une coupe pour
 * longueur : c'est le malentendu qui a coute un run de 45 minutes le 2026-08-19.
 */
function raisonImmobilite(ms: number): string {
  return `aucune progression depuis ${ms} ms — run considere comme pendu, pas comme trop long`
}

export class ExecutionSupervisor {
  private readonly storage = new AsyncLocalStorage<ExecutionRuntime>()
  private latest?: ExecutionUsageSnapshot
  private latestExecutionId?: string

  currentQuote(): ExecutionQuote | undefined {
    return this.storage.getStore()?.quote
  }

  currentSignal(): AbortSignal | undefined {
    return this.storage.getStore()?.signal
  }

  currentSnapshot(): ExecutionUsageSnapshot | undefined {
    const runtime = this.storage.getStore()
    return runtime ? snapshot(runtime) : undefined
  }

  lastSnapshot(): ExecutionUsageSnapshot | undefined {
    return this.latest ? { ...this.latest } : undefined
  }

  /**
   * Lance une autorite independante sans heriter du devis AsyncLocalStorage de l'appelant. Les
   * callbacks d'evenement peuvent s'executer avant la fin du parent ; un reveil de fond doit alors
   * ouvrir son propre livre de couts, jamais depenser dans celui qui l'a reveille.
   */
  runOutsideCurrent<T>(execute: () => T): T {
    return this.storage.exit(execute)
  }

  async run<T>(
    quote: ExecutionQuote,
    outerSignal: AbortSignal | undefined,
    execute: () => Promise<T>,
    prior?: ExecutionUsageSnapshot,
    onLateSettlement?: (usage: ExecutionUsageSnapshot) => void
  ): Promise<T> {
    const controller = new AbortController()
    /*
     * L'échéance court depuis le DÉBUT DE CETTE EXÉCUTION, pas depuis la création du devis.
     *
     * Constaté en réel le 2026-08-05 : deux runs repris au démarrage ont échoué INSTANTANÉMENT —
     * « budget duree depasse (7200000 ms) » — sans jouer une seule phase. Le devis étant persisté
     * avec le run, son échéance était calculée depuis sa création d'origine : un run tué à 14 h 10
     * et repris à 17 h avec 2 h de budget était condamné avant de commencer. La durée mesurait le
     * temps écoulé DANS LE MONDE, pas le temps travaillé — donc toute reprise après une longue
     * interruption perdait le travail déjà payé.
     *
     * La sémantique retenue, et elle est cohérente : la DURÉE borne une exécution (elle protège de
     * l'emballement d'un run qui tourne), le COÛT borne le run entier et reste cumulatif à travers
     * les reprises via `prior` (jetons, appels, agents ci-dessous). Une reprise est un acte
     * délibéré de l'utilisateur ; lui rendre son temps de travail ne lui rend pas son budget.
     */
    const deadlineAtMs = Date.now() + quote.limits.maxDurationMs
    const runtime: ExecutionRuntime = {
      executionId: randomUUID(),
      quote,
      deadlineAtMs,
      controller,
      signal: combinedSignal(outerSignal, controller.signal),
      // Les checkpoints antérieurs au compteur agents ne doivent jamais recréer un budget vierge.
      // Dans une orchestration historique, chaque appel payé est une borne haute conservatrice du
      // nombre d'agents déjà admis. Mieux vaut refuser une reprise ambiguë que doubler son fan-out.
      startedAgents: prior ? (prior.startedAgents ?? prior.startedCalls) : 0,
      startedCalls: prior?.startedCalls ?? 0,
      completedCalls: prior?.completedCalls ?? 0,
      failedCalls: prior?.failedCalls ?? 0,
      // Une reprise ne doit jamais effacer un provider encore vivant du checkpoint. Le refus
      // conservateur ci-dessous empeche deux transports de consommer le meme budget en parallele.
      activeCalls: prior?.activeCalls ?? 0,
      activeReservationIds: new Set(prior?.activeReservationIds ?? []),
      reservedTotalTokens: 0,
      reservedFreshTokens: 0,
      inputTokens: prior?.inputTokens ?? 0,
      outputTokens: prior?.outputTokens ?? 0,
      cacheReadTokens: prior?.cacheReadTokens ?? 0,
      cacheCreationTokens: prior?.cacheCreationTokens ?? 0,
      totalTokens: prior?.totalTokens ?? 0,
      freshTokens: prior?.freshTokens ?? 0,
      knownCostUsd: prior?.knownCostUsd ?? 0,
      pricedCalls: prior?.knownCostUsd === null || prior?.knownCostUsd === undefined ? 0 : 1,
      unpricedCalls: prior?.unpricedCalls ?? 0,
      unmeteredCalls: prior?.unmeteredCalls ?? 0,
      finished: false,
      onLateSettlement
    }
    if (prior && prior.quoteId !== quote.id) {
      throw new Error('Reprise refusee : le devis ne correspond pas aux compteurs persistants.')
    }
    const publishTerminalSnapshot = (): ExecutionUsageSnapshot => {
      runtime.finished = true
      const terminal = snapshot(runtime)
      this.latestExecutionId = runtime.executionId
      this.latest = terminal
      try {
        runtime.onLateSettlement?.({ ...terminal })
      } catch {
        // L'observation UI/persistance ne doit jamais changer le resultat du run.
      }
      return terminal
    }
    if (prior && prior.activeCalls > 0) {
      runtime.stoppedReason = `Reprise refusee : ${prior.activeCalls} appel(s) provider encore actif(s).`
      controller.abort(runtime.stoppedReason)
      publishTerminalSnapshot()
      throw new ExecutionBudgetExceededError(runtime.stoppedReason)
    }
    const remainingDurationMs = deadlineAtMs - Date.now()
    /*
     * FILET CONTRE UN RUN PENDU — et RIEN d'autre.
     *
     * Histoire de ce bloc, pour que personne ne le rejoue a l'aveugle. Il bornait la DUREE TOTALE :
     * mesure du 2026-08-19, l'application a livre un correctif de production en deux commits puis son
     * tour a ete tue sur « budget duree depasse (2700000 ms) » avant d'ecrire ses tests. Couper une
     * tache parce qu'elle est LONGUE ne protege rien : ca detruit du travail deja paye. Le guetteur a
     * donc ete retire entierement par une session concurrente, decision utilisateur assumee et
     * documentee. Puis l'utilisateur a demande le filet en retour, une fois le cout connu : un run
     * PENDU — `git` mort, worker disparu — ne consomme aucun jeton, donc aucun plafond de depense ne
     * l'arrete jamais, et le detecteur de derive (`route-drift.ts`) se declenche sur la SORTIE, donc
     * il ne voit pas un silence total.
     *
     * Ce que ce filet fait, et sa seule justification : l'echeance est REPOUSSEE a chaque progression
     * observable d'un appel provider. Une tache longue tourne donc librement — y compris pendant une
     * verification de suite complete, qui dure ~8 min sans regler un seul appel, largement sous le
     * plus petit budget de regime (15 min). Ce qui reste attrape est l'immobilite complete.
     *
     * La course contre l'abort n'est pas un ornement : `controller.abort` n'est observe que par un
     * appel provider EN VOL. Sans elle, un run pendu sans appel actif restait pendu indefiniment et le
     * minuteur ne servait a rien — le garde jumeau a l'admission ne mordait qu'au prochain appel,
     * c'est-a-dire jamais. Elle est armee UNIQUEMENT pour l'immobilite : un refus de depense garde son
     * chemin d'origine, et transformer son abort en rejet exterieur changerait tous les plafonds.
     */
    if (remainingDurationMs <= 0) {
      runtime.stoppedReason = raisonImmobilite(quote.limits.maxDurationMs)
      controller.abort(runtime.stoppedReason)
      publishTerminalSnapshot()
      throw new ExecutionBudgetExceededError(runtime.stoppedReason)
    }
    let arretPourImmobilite = false
    const arreterPourImmobilite = (): void => {
      arretPourImmobilite = true
      runtime.stoppedReason = raisonImmobilite(quote.limits.maxDurationMs)
      controller.abort(runtime.stoppedReason)
    }
    let deadline = setTimeout(arreterPourImmobilite, remainingDurationMs)
    deadline.unref?.()
    runtime.progresse = (): void => {
      if (runtime.finished) return
      // La borne LUE A L'ADMISSION doit avancer avec le minuteur, sinon le garde jumeau continue de
      // refuser au nom d'une echeance que le minuteur vient de lever.
      runtime.deadlineAtMs = Date.now() + quote.limits.maxDurationMs
      clearTimeout(deadline)
      deadline = setTimeout(arreterPourImmobilite, quote.limits.maxDurationMs)
      deadline.unref?.()
    }
    const rejetSurImmobilite = new Promise<never>((_, rejeter) => {
      const surArret = (): void => {
        if (!arretPourImmobilite) return
        rejeter(new ExecutionBudgetExceededError(runtime.stoppedReason ?? 'execution interrompue'))
      }
      if (controller.signal.aborted) surArret()
      else controller.signal.addEventListener('abort', surArret, { once: true })
    })
    try {
      return await Promise.race([this.storage.run(runtime, execute), rejetSurImmobilite])
    } finally {
      runtime.progresse = undefined
      clearTimeout(deadline)
      // Publier MEME si le provider s'est regle dans la micro-fenetre entre la cloture
      // orchestrateur et ce finally. Sans cela, la fermeture persistait un faux activeCalls=1.
      publishTerminalSnapshot()
    }
  }

  reserveProviderCall(
    externalSignal?: AbortSignal,
    launchesAgent = false
  ): ProviderReservation | undefined {
    const runtime = this.storage.getStore()
    if (!runtime) return undefined
    runtime.signal.throwIfAborted()
    const limits = runtime.quote.limits
    const deny = (reason: string, abortRun = true): never => {
      runtime.stoppedReason = reason
      if (abortRun) runtime.controller.abort(reason)
      throw new ExecutionBudgetExceededError(reason)
    }
    // L'IMMOBILITE et la CONCURRENCE sont toujours enforcees : la premiere protege d'un run PENDU (et
    // d'un run pendu seulement — `deadlineAtMs` avance a chaque progression, voir `progresse`), la
    // seconde de la saturation de la machine en process. Ni l'une ni l'autre ne protege le
    // portefeuille — elles ne relevent donc pas du reglage ci-dessous.
    if (Date.now() >= runtime.deadlineAtMs) {
      deny(raisonImmobilite(limits.maxDurationMs))
    }
    //
    // Plafonds de DÉPENSE : `blocking` refuse l'appel SUIVANT, jamais la finalisation d'un appel
    // déjà payé. `metering-only` continue de tout compter sans refuser.
    // L'ORDRE des contrôles est celui d'origine : il détermine QUEL motif est rendu quand deux
    // plafonds sont atteints en même temps, et des tests s'appuient dessus.
    const enforceSpend = limits.spendEnforcement === 'blocking'
    if (
      enforceSpend &&
      limits.maxUsd !== null &&
      runtime.pricedCalls > 0 &&
      runtime.knownCostUsd >= limits.maxUsd
    ) {
      deny(refusAvecIssue('budget-depense', `${limits.maxUsd} USD`), false)
    }
    // Le NOMBRE d'appels et d'agents est une invariante STRUCTURELLE, pas une limite de dépense :
    // un tour de chat vaut UN appel provider (`maxProviderCalls: 1` posé par os.ts et par le
    // routeur de conversation), et le relâcher laisserait un même tour appeler deux fois.
    // Régression attrapée le 2026-08-12 par `os.chat-supervisor.test.ts` après avoir rangé ces
    // deux compteurs avec les jetons : ce sont les JETONS et l'USD qui tuaient des runs, pas eux.
    if (runtime.startedCalls >= limits.maxProviderCalls) {
      deny(refusAvecIssue('budget-appels', `${limits.maxProviderCalls} appels`))
    }
    if (launchesAgent && runtime.startedAgents >= limits.maxAgents) {
      deny(`Budget d'agents atteint (${limits.maxAgents})`)
    }
    if (runtime.activeCalls >= limits.maxConcurrency) {
      deny(`Budget de concurrence atteint (${limits.maxConcurrency})`)
    }
    if (enforceSpend && runtime.totalTokens >= limits.maxTotalTokens) {
      deny(`Budget tokens total atteint (${limits.maxTotalTokens})`, false)
    }
    if (enforceSpend && runtime.freshTokens >= limits.maxFreshTokens) {
      deny(`Budget tokens frais atteint (${limits.maxFreshTokens})`, false)
    }
    const remainingCalls = Math.max(1, limits.maxProviderCalls - runtime.startedCalls)
    const totalReservation = Math.ceil(
      Math.max(0, limits.maxTotalTokens - runtime.totalTokens - runtime.reservedTotalTokens) /
        remainingCalls
    )
    const freshReservation = Math.ceil(
      Math.max(0, limits.maxFreshTokens - runtime.freshTokens - runtime.reservedFreshTokens) /
        remainingCalls
    )
    if (enforceSpend && totalReservation <= 0) {
      deny(`Budget tokens total entierement reserve (${limits.maxTotalTokens})`, false)
    }
    if (enforceSpend && freshReservation <= 0) {
      deny(`Budget tokens frais entierement reserve (${limits.maxFreshTokens})`, false)
    }
    if (
      enforceSpend &&
      runtime.totalTokens + runtime.reservedTotalTokens + totalReservation > limits.maxTotalTokens
    ) {
      deny(`Budget tokens total atteint (${limits.maxTotalTokens})`, false)
    }
    if (
      enforceSpend &&
      runtime.freshTokens + runtime.reservedFreshTokens + freshReservation > limits.maxFreshTokens
    ) {
      deny(`Budget tokens frais atteint (${limits.maxFreshTokens})`, false)
    }

    const reservationId = randomUUID()
    // Les deux compteurs sont reserves dans la meme section synchrone, avant que l'adaptateur ne
    // voie l'appel. Deux fan-outs concurrents ne peuvent donc pas tous deux franchir le plafond.
    if (launchesAgent) runtime.startedAgents += 1
    runtime.startedCalls += 1
    runtime.activeCalls += 1
    // PROGRESSION : un appel qui demarre prouve que le run n'est pas pendu.
    runtime.progresse?.()
    runtime.activeReservationIds.add(reservationId)
    runtime.reservedTotalTokens += totalReservation
    runtime.reservedFreshTokens += freshReservation
    let settled = false
    const settle = (usage: Usage | undefined, failed: boolean): void => {
      if (settled) return
      settled = true
      runtime.activeCalls = Math.max(0, runtime.activeCalls - 1)
      runtime.activeReservationIds.delete(reservationId)
      runtime.reservedTotalTokens = Math.max(0, runtime.reservedTotalTokens - totalReservation)
      runtime.reservedFreshTokens = Math.max(0, runtime.reservedFreshTokens - freshReservation)
      if (failed) runtime.failedCalls += 1
      else runtime.completedCalls += 1
      // PROGRESSION : un appel qui se REGLE prouve que le run avance, quel qu'en soit le verdict.
      runtime.progresse?.()
      if (!usage) {
        runtime.unmeteredCalls += 1
        runtime.unpricedCalls += 1
        runtime.totalTokens += totalReservation
        runtime.freshTokens += freshReservation
      } else {
        const input = Number.isFinite(usage.inputTokens) ? Math.max(0, usage.inputTokens) : 0
        const output = Number.isFinite(usage.outputTokens) ? Math.max(0, usage.outputTokens) : 0
        // L'invariant « le cache est un sous-ensemble de l'entree » est arbitre par UN SEUL
        // endroit, partage avec l'estimateur de cout : l'ecriture bornee d'abord, la lecture sur
        // ce qu'il reste. Ce module l'arbitrait dans l'ordre INVERSE, soit un facteur 12 d'ecart
        // sur la part litigieuse d'un usage incoherent.
        const { cacheRead: cache, cacheWrite } = splitInputTokens({
          inputTokens: input,
          cacheReadTokens: Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0,
          cacheCreationTokens: Number.isFinite(usage.cacheCreationTokens)
            ? usage.cacheCreationTokens
            : 0
        })
        runtime.inputTokens += input
        runtime.outputTokens += output
        runtime.cacheReadTokens += cache
        runtime.cacheCreationTokens += cacheWrite
        runtime.totalTokens += input + output
        runtime.freshTokens += Math.max(0, input - cache) + output
        if (Number.isFinite(usage.costUsd)) {
          runtime.knownCostUsd += Math.max(0, usage.costUsd as number)
          runtime.pricedCalls += 1
        } else runtime.unpricedCalls += 1
      }
      // C'est ICI que le run mourait après coup, une fois la dépense déjà engagée : le règlement
      // constatait le dépassement et avortait, emportant un travail déjà produit et déjà payé.
      // Dans tous les modes on enregistre la consommation et on laisse cet appel aller à sa clôture.
      if (enforceSpend) {
        if (runtime.totalTokens > limits.maxTotalTokens) {
          runtime.stoppedReason = `Budget tokens total depasse (${runtime.totalTokens}/${limits.maxTotalTokens})`
        } else if (runtime.totalTokens + runtime.reservedTotalTokens > limits.maxTotalTokens) {
          runtime.stoppedReason =
            `Budget tokens total compromis ` +
            `(${runtime.totalTokens + runtime.reservedTotalTokens}/${limits.maxTotalTokens}, reservations actives incluses)`
        } else if (runtime.freshTokens > limits.maxFreshTokens) {
          runtime.stoppedReason = `Budget tokens frais depasse (${runtime.freshTokens}/${limits.maxFreshTokens})`
        } else if (runtime.freshTokens + runtime.reservedFreshTokens > limits.maxFreshTokens) {
          runtime.stoppedReason =
            `Budget tokens frais compromis ` +
            `(${runtime.freshTokens + runtime.reservedFreshTokens}/${limits.maxFreshTokens}, reservations actives incluses)`
        } else if (limits.maxUsd !== null && runtime.knownCostUsd > limits.maxUsd) {
          runtime.stoppedReason = `Budget USD depasse (${runtime.knownCostUsd}/${limits.maxUsd})`
        }
        // Un appel déjà réglé reste publiable. En revanche, les autres membres du même fan-out
        // encore en vol sont stoppés dès que leurs réservations ne tiennent plus dans le plafond.
        if (runtime.stoppedReason && runtime.activeCalls > 0) {
          runtime.controller.abort(runtime.stoppedReason)
        }
      }
      // `run()` peut avoir rendu la main sur un watchdog alors que le provider ignore encore
      // l'abort. Quand sa vraie fin arrive, republier ses compteurs sans laisser cet ancien run
      // écraser le snapshot d'un run plus récent.
      if (runtime.finished) {
        const updated = snapshot(runtime)
        if (this.latestExecutionId === runtime.executionId) this.latest = updated
        try {
          runtime.onLateSettlement?.({ ...updated })
        } catch {
          // L'observation UI/persistance ne doit jamais changer le règlement du provider.
        }
      }
    }
    return {
      id: reservationId,
      signal: combinedSignal(runtime.signal, externalSignal),
      complete: (usage) => settle(usage, false),
      fail: (usage) => settle(usage, true),
      abort: (reason) => {
        runtime.stoppedReason = reason
        runtime.controller.abort(reason)
      }
    }
  }
}
