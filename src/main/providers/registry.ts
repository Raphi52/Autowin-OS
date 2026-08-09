import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './types'
import { withHardDeadline } from './watchdog'
import type { ExecutionSupervisor } from '../execution-supervisor'

/**
 * Plafond DUR de coordination : même si un adaptateur défaille (promesse jamais réglée, event `close`
 * qui ne tire pas après un kill de zombie), `send` REJETTE au bout de ce délai → l'orchestrateur ne
 * pend JAMAIS indéfiniment. Volontairement TRÈS large : c'est un ultime filet, pas le vrai plafond —
 * l'inactivité/le cap total des adaptateurs (watchdog de flux) tranchent bien avant sur un vrai figé.
 * Réglable via AUTOWIN_SUBAGENT_CEILING_MS.
 */
const COORDINATION_CEILING_MS = ((): number => {
  const raw = Number(process.env.AUTOWIN_SUBAGENT_CEILING_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 45 * 60_000
})()

/** Grâce bornée laissée à l'adaptateur pour se régler après l'abort de coordination. */
const COORDINATION_DRAIN_GRACE_MS = ((): number => {
  const raw = Number(process.env.AUTOWIN_SUBAGENT_DRAIN_GRACE_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000
})()

/**
 * Reconnaît un quota d'abonnement ÉPUISÉ — et lui seul.
 *
 * Le discriminant est le VOCABULAIRE du refus, pas le code HTTP : un quota épuisé et un rate-limit
 * passager arrivent tous deux en 429, et les confondre coûte dans les deux sens. Ignorer le premier fait
 * tirer des centaines d'appels dans le vide (mesuré : 852 runs rouges) ; bloquer sur le second
 * transformerait une attente de 20 s en panne de provider pour tout le run.
 *
 * Deux sources acceptées : la signature structurée que pose l'adaptateur codex, et le texte brut — pour
 * qu'un provider qui n'a pas (encore) de signature soit couvert quand même.
 */
export function quotaWallReason(error: unknown): string | undefined {
  const signature = (error as { signature?: unknown } | null)?.signature
  const texte = error instanceof Error ? error.message : String(error ?? '')
  if (/retry after|try again in|rate limit exceeded/i.test(texte)) return undefined
  if (signature === 'usage-limit-reached') return texte
  return /usage[_ ]limit|purchase more credits|hit your usage|insufficient_quota/i.test(texte)
    ? texte
    : undefined
}

/**
 * Routeur d'adaptateurs. Le seul point par lequel l'app envoie un tour :
 * choisit l'adaptateur par id, INJECTE le bloc système (kit condensé) de façon
 * uniforme, délègue le streaming à l'adaptateur, et centralise la traçabilité.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  /**
   * Providers dont le quota est épuisé, avec le refus qu'ils ont écrit.
   *
   * AUCUNE SONDE AUTOMATIQUE, à dessein : re-tester périodiquement si le quota est revenu COÛTERAIT du
   * quota, pour une vérification que personne n'a demandée. Le mur tient donc toute la session, et c'est
   * l'utilisateur qui le lève en relançant l'app — un geste délibéré, au moment où il veut travailler.
   *
   * D'où l'état en mémoire : ce n'est pas une limite subie, c'est le mécanisme de levée.
   */
  private readonly quotaWalls = new Map<string, string>()
  private readonly quotaSuccessors = new Map<string, string>()
  private readonly quotaRotationFlights = new Map<string, Promise<string | undefined>>()

  /** Bloc système par défaut (kit condensé SOUL) injecté sur CHAQUE tour. */
  constructor(
    private readonly systemBlock: string | undefined = undefined,
    private readonly executionSupervisor?: ExecutionSupervisor,
    /**
     * Compte actif d'un provider, quand il en a plusieurs (Claude multi-comptes). Sert à indexer le
     * mur de quota sur le COUPLE (provider, compte) : deux abonnements distincts ne partagent pas
     * leur quota, donc ne doivent pas partager leur mur. Absent → un seul compte, clé = le provider,
     * comportement d'avant strictement inchangé.
     */
    private readonly activeAccountOf?: (providerId: string) => string | undefined,
    /**
     * ROTATION D'ABONNEMENT. Appelé quand le compte actif vient de heurter un quota épuisé : le pool
     * bascule sur un compte encore vivant et rend son id, ou `undefined` s'il n'en reste aucun.
     *
     * Le registre ne CHOISIT pas — il ne connaît pas le store de comptes. Il demande, puis constate.
     * C'est ce qui permet de tester la rotation sans Electron, et d'éviter que le routeur d'appels
     * devienne dépositaire de la politique de comptes.
     */
    private readonly rotateAccount?: (
      providerId: string,
      walledAccountId: string
    ) => string | undefined
  ) {}

  /**
   * Clé du mur de quota. Le quota est une propriété de l'ABONNEMENT, pas du binaire : murer
   * « claude » entier quand un seul de deux comptes est épuisé annulerait la raison d'avoir payé le
   * second. On sépare donc par compte actif.
   */
  private quotaWallKey(providerId: string, account = this.activeAccountOf?.(providerId)): string {
    return account ? `${providerId}\u0000${account}` : providerId
  }

  private async rotateAfterQuota(
    providerId: string,
    walledAccountId: string
  ): Promise<string | undefined> {
    const wallKey = this.quotaWallKey(providerId, walledAccountId)
    const knownSuccessor = this.quotaSuccessors.get(wallKey)
    if (knownSuccessor && this.activeAccountOf?.(providerId) === knownSuccessor) {
      return knownSuccessor
    }
    const currentFlight = this.quotaRotationFlights.get(wallKey)
    if (currentFlight) return currentFlight

    const flight = Promise.resolve().then(() => {
      const successor = this.rotateAccount?.(providerId, walledAccountId)
      if (successor) this.quotaSuccessors.set(wallKey, successor)
      return successor
    })
    this.quotaRotationFlights.set(wallKey, flight)
    try {
      return await flight
    } finally {
      if (this.quotaRotationFlights.get(wallKey) === flight) {
        this.quotaRotationFlights.delete(wallKey)
      }
    }
  }

  register(adapter: ProviderAdapter): this {
    this.adapters.set(adapter.id, adapter)
    return this
  }

  ids(): string[] {
    return [...this.adapters.keys()]
  }

  get(id: string): ProviderAdapter {
    const a = this.adapters.get(id)
    if (!a) throw new Error(`Provider inconnu: ${id} (connus: ${this.ids().join(', ') || 'aucun'})`)
    return a
  }

  /**
   * Cet adaptateur reprend-il VRAIMENT une session ? Un provider inconnu répond non : élider un
   * historique sur une capacité qu'on n'a pas pu vérifier est précisément le défaut à empêcher.
   */
  honoursSessionResume(id: string): boolean {
    return this.adapters.get(id)?.honoursSessionResume === true
  }

  private resolve(id: string, opts: SendOptions): { id: string; opts: SendOptions } {
    this.get(id)
    if (id.startsWith('fabric:') && opts.execution) {
      throw new Error(
        'Une ressource Fabric local-tools ne peut pas recevoir une exécution distante'
      )
    }
    if (opts.execution) {
      const requested = this.get(id)
      if (requested.supportsExecution === true) return { id, opts }

      // Un rôle NON-exécuteur demandant une exécution est délégué à un runner
      // outillé local. Ordre de préférence DÉTERMINISTE : codex (exécuteur canonique éprouvé) en
      // premier, sinon le 1er exécuteur déclaré. Évite qu'un nouvel exécuteur enregistré avant
      // (ex. claude, dont l'auth peut être expirée) devienne silencieusement le fallback par défaut.
      const executors = [...this.adapters.values()].filter((a) => a.supportsExecution === true)
      const localExecutor = executors.find((a) => a.id === 'codex') ?? executors[0]
      if (localExecutor) {
        return {
          id: localExecutor.id,
          opts: { ...opts, model: undefined, reasoningEffort: undefined }
        }
      }
      return { id, opts }
    }
    // Chat direct : route vers l'adaptateur du provider DEMANDÉ (le binding de rôle, ex. claude/
    // codex/kimi) tel quel. Chaque adaptateur streame nativement en mode conversation (send =
    // AsyncGenerator yield delta). Plus d'intermédiaire « transport » : le provider affiché EST
    // celui qui répond (fin de la redirection silencieuse + du throw obligatoire).
    this.get(id)
    return { id, opts }
  }

  describePrompt(
    id: string,
    messages: Message[],
    opts: SendOptions = {},
    model?: string
  ): PromptEnvelope {
    const route = this.resolve(id, opts)
    const adapter = this.get(route.id)
    const resolved = { ...route.opts, system: route.opts.system ?? this.systemBlock }
    return (
      adapter.describePrompt?.(messages, resolved, resolved.model ?? model) ?? {
        provider: route.id,
        model: resolved.model ?? model,
        transport: 'ProviderAdapter.send',
        system: resolved.system,
        systemBlocks: resolved.systemBlocks,
        messages,
        options: { resumed: Boolean(resolved.resumeSessionId) },
        limitation:
          'Capture exacte à la frontière Autowin OS ; ajouts internes du provider non observables.'
      }
    )
  }

  /**
   * Envoie un tour via le provider `id`. Le bloc système du registre est injecté
   * sauf si `opts.system` le surcharge explicitement. Streame les chunks au
   * callback `onChunk` et retourne le résultat final consolidé.
   */
  async send(
    id: string,
    messages: Message[],
    opts: SendOptions = {},
    onChunk?: (c: StreamChunk) => void
  ): Promise<SendResult> {
    return this.sendPossiblyRotating(id, messages, opts, onChunk, true)
  }

  /**
   * `mayRotate` autorise la recherche d'un compte encore disponible. `visitedWalls` empêche les
   * cycles et borne la recherche à huit comptes : chaque compte déjà marqué est sauté sans appel,
   * tandis qu'un nouveau refus de quota est observé une seule fois avant de poursuivre.
   */
  private async sendPossiblyRotating(
    id: string,
    messages: Message[],
    opts: SendOptions = {},
    onChunk?: (c: StreamChunk) => void,
    mayRotate = false,
    visitedWalls = new Set<string>()
  ): Promise<SendResult> {
    const route = this.resolve(id, opts)
    const adapter = this.get(route.id)
    // Figer le compte au départ : une autre requête peut faire tourner le pool pendant que celle-ci
    // attend sa réponse. Le mur et la rotation doivent viser le compte qui a réellement été appelé.
    const accountAtStart = this.activeAccountOf?.(route.id)
    const wallKeyAtStart = this.quotaWallKey(route.id, accountAtStart)
    if (route.opts.execution && adapter.supportsExecution !== true) {
      throw new Error(`Provider ${route.id} sans exécuteur local outillé`)
    }
    // `systemBlock` = la CONSTITUTION (source unique du soul, cf. constitution.ts). Elle sert ici de
    // FALLBACK uniquement quand aucun `opts.system` explicite n'est fourni (os.chat/chat_send).
    // Depuis l'unification chat↔orchestrateur, le chat cockpit ET les phases orchestrées injectent
    // la MÊME CONSTITUTION explicitement via leurs propres `parts` (agent-pilot.ts / orchestrator.ts) :
    // ce fallback ne les concerne donc pas — ce n'est plus une exclusion voulue du soul.
    const system = route.opts.system ?? this.systemBlock
    // DISJONCTEUR DE QUOTA, avant même la réservation : un appel refusé ne doit consommer aucun budget.
    // Même intention que l'admission ci-dessous — ne rien lancer qui soit condamné d'avance — mais pour
    // une cause EXTERNE : un quota d'abonnement épuisé se rétablit des JOURS plus tard, jamais par une
    // relance. Dépouillement du 2026-08-06 : 852 runs rouges (70 % des échecs réels) n'avaient que cette
    // cause, dont 285 APRÈS le correctif qui se contentait de la NOMMER sans fermer la porte.
    const mur = this.quotaWalls.get(wallKeyAtStart)
    if (mur) {
      if (
        mayRotate &&
        accountAtStart &&
        !visitedWalls.has(wallKeyAtStart) &&
        visitedWalls.size < 8
      ) {
        visitedWalls.add(wallKeyAtStart)
        const successor = await this.rotateAfterQuota(route.id, accountAtStart)
        if (successor && successor !== accountAtStart) {
          return this.sendPossiblyRotating(id, messages, opts, onChunk, true, visitedWalls)
        }
      }
      throw new Error(
        `Provider ${route.id} écarté : quota épuisé, plus aucun appel ne lui est envoyé. ` +
          `Relancer l'app remet le compteur à zéro. Refus du provider : ${mur.slice(0, 300)}`
      )
    }
    // Admission AVANT l'adaptateur : un budget epuise ne doit jamais faire apparaitre une fenetre,
    // ouvrir un stream ou lancer un CLI qui sera seulement tue apres sa reponse.
    // Toute execution outillee est un agent du devis. L'admission appels + agents est atomique et
    // precede adapter.send : fan-out, greedy, juge, synthese et reparation suivent le meme plafond.
    const reservation = this.executionSupervisor?.reserveProviderCall(
      route.opts.signal,
      Boolean(route.opts.execution)
    )
    const coordinationController = new AbortController()
    const providerSignal = reservation?.signal ?? route.opts.signal
    let spawnFailure: Error | undefined
    const spawnedTokens = new Set<string>()
    let terminateProvider: ((reason: string) => void) | undefined
    const execution = route.opts.execution
      ? {
          ...route.opts.execution,
          onSpawnIntent: (token: string, active: boolean) => {
            // Les adaptateurs retirent l'intention juste avant de rejeter lorsqu'un spawn échoue.
            // Régler d'abord la réservation garantit que la persistance déclenchée par le callback
            // ne peut jamais écrire le couple incohérent `agents=[]` + `activeCalls=1`.
            if (!active && !spawnedTokens.has(token)) {
              reservation?.fail()
              spawnFailure ??= new Error(
                `Lancement du sous-agent ${route.id} annulé avant création du processus (${token}).`
              )
            }
            if (active || !spawnedTokens.has(token)) {
              route.opts.execution?.onSpawnIntent?.(token, active)
            }
          },
          onSpawned: (token: string, pid: number) => {
            // Le registre fournit toujours ce callback. Les adaptateurs n'ont donc plus besoin de
            // traduire un PID réussi en `spawnIntent(false)` lorsque l'appelant ne suivait que les
            // processus. On reproduit ici ce fallback historique sans le confondre avec un échec.
            spawnedTokens.add(token)
            if (route.opts.execution?.onSpawned) {
              route.opts.execution.onSpawned(token, pid)
            } else {
              route.opts.execution?.onProcess?.(pid, true)
              route.opts.execution?.onSpawnIntent?.(token, false)
            }
          },
          registerTermination: (terminate: (reason: string) => void) => {
            terminateProvider = terminate
            route.opts.execution?.registerTermination?.(terminate)
          }
        }
      : undefined
    const effectiveOptions = {
      ...route.opts,
      system,
      ...(execution ? { execution } : {}),
      signal: providerSignal
        ? AbortSignal.any([providerSignal, coordinationController.signal])
        : coordinationController.signal
    }
    let gen: ReturnType<ProviderAdapter['send']>
    try {
      gen = adapter.send(messages, effectiveOptions)
    } catch (error) {
      reservation?.fail()
      throw error
    }

    // Pompe du stream, enveloppée d'un PLAFOND DUR de coordination : si l'adaptateur ne rend jamais la
    // main (zombie, `close` jamais émis), la course rejette au lieu de pendre à l'infini. Garantie que
    // l'orchestrateur se règle TOUJOURS ; le watchdog de flux des adaptateurs tue le process bien avant.
    let forceDrainReject!: (error: Error) => void
    const forcedDrain = new Promise<never>((_resolve, reject) => {
      forceDrainReject = reject
    })
    const nextStep = (): ReturnType<typeof gen.next> => Promise.race([gen.next(), forcedDrain])
    /**
     * Deltas déjà livrés à la conversation. Verrou de la rotation : une fois du texte affiché,
     * relancer le tour sur un autre compte le DUPLIQUERAIT sous les yeux de l'utilisateur. On ne
     * bascule donc que sur un refus survenu avant le premier delta — ce qui est le cas d'un quota
     * épuisé, refusé d'entrée.
     */
    let chunksLivres = 0
    const pump = (async (): Promise<SendResult> => {
      let step = await nextStep()
      while (!step.done) {
        // Une fois l'appel annulé, continuer à drainer le générateur pour observer sa vraie fin,
        // mais ne plus livrer de delta à une conversation déjà clôturée.
        if (!effectiveOptions.signal.aborted && !spawnFailure) {
          chunksLivres += 1
          onChunk?.(step.value)
        }
        step = await nextStep()
      }
      // `spawnIntent(false)` est terminal par contrat. Même un adaptateur défaillant qui retourne
      // ensuite un résultat ne peut donc faire valider un succès déjà persisté comme échec.
      if (spawnFailure) throw spawnFailure
      // Valeur de retour du generator = SendResult final.
      return step.value
    })()
    // La réservation suit la vraie fin pendant une grâce bornée. Au-delà, elle est réglée en échec
    // conservateur et la pompe du registre est coupée, même si un provider tiers ignore encore l'abort.
    let drainGraceTimer: ReturnType<typeof setTimeout> | undefined
    const trackedPump = pump
      .then(
        (result) => {
          if (effectiveOptions.signal.aborted) reservation?.fail(result.usage)
          else reservation?.complete(result.usage)
          return result
        },
        (error) => {
          reservation?.fail()
          // Toute défaillance passe ici : c'est le point unique où armer le disjoncteur. On l'arme sur
          // la PREUVE (le refus du provider), pas sur une supposition — `quotaWallReason` écarte
          // explicitement le rate-limit passager.
          const raison = quotaWallReason(error)
          if (raison) this.quotaWalls.set(wallKeyAtStart, raison)
          throw error
        }
      )
      .finally(() => {
        if (drainGraceTimer) clearTimeout(drainGraceTimer)
      })
    const rotationSiQuotaEpuise = async (error: unknown): Promise<SendResult> => {
      // Trois verrous, tous nécessaires : la PREUVE du quota (jamais un rate-limit passager), aucun
      // delta déjà livré (sinon duplication à l'écran), et aucun retour vers un compte déjà visité.
      const raison = quotaWallReason(error)
      const compteMure = accountAtStart
      if (
        !mayRotate ||
        !raison ||
        chunksLivres > 0 ||
        !compteMure ||
        visitedWalls.has(wallKeyAtStart) ||
        visitedWalls.size >= 8
      )
        throw error
      visitedWalls.add(wallKeyAtStart)
      // Le mur du compte épuisé a déjà été posé par le handler ci-dessus : la bascule ne l'efface pas.
      const suivant = await this.rotateAfterQuota(route.id, compteMure)
      if (!suivant) throw error
      return this.sendPossiblyRotating(id, messages, opts, onChunk, true, visitedWalls)
    }
    return withHardDeadline(
      trackedPump.catch(rotationSiQuotaEpuise),
      COORDINATION_CEILING_MS,
      `Sous-agent ${route.id} sans réponse depuis ${Math.round(COORDINATION_CEILING_MS / 1000)}s (watchdog coordination) — abandonné pour ne pas bloquer le run.`,
      () => {
        const reason = `Watchdog coordination expiré pour ${route.id}`
        coordinationController.abort(reason)
        reservation?.abort(reason)
        drainGraceTimer = setTimeout(() => {
          const error = new Error(
            `${reason} : drainage toujours actif après ${COORDINATION_DRAIN_GRACE_MS} ms`
          )
          try {
            terminateProvider?.(error.message)
          } catch {
            // La fermeture de l'adaptateur reste best-effort ; la pompe est bornée quoi qu'il arrive.
          }
          // Arrête la boucle du registre même si `gen.next()` reste bloqué dans un provider fautif.
          forceDrainReject(error)
          reservation?.fail()
          try {
            void gen.return?.(undefined as never).catch(() => undefined)
          } catch {
            // Un générateur tiers peut rejeter synchroniquement sa fermeture : réservation déjà close.
          }
        }, COORDINATION_DRAIN_GRACE_MS)
        drainGraceTimer.unref?.()
      }
    )
  }
}
