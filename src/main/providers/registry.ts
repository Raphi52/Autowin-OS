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
 * Routeur d'adaptateurs. Le seul point par lequel l'app envoie un tour :
 * choisit l'adaptateur par id, INJECTE le bloc système (kit condensé) de façon
 * uniforme, délègue le streaming à l'adaptateur, et centralise la traçabilité.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  /** Bloc système par défaut (kit condensé SOUL) injecté sur CHAQUE tour. */
  constructor(
    private readonly systemBlock: string | undefined = undefined,
    private readonly executionSupervisor?: ExecutionSupervisor
  ) {}

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
    const route = this.resolve(id, opts)
    const adapter = this.get(route.id)
    if (route.opts.execution && adapter.supportsExecution !== true) {
      throw new Error(`Provider ${route.id} sans exécuteur local outillé`)
    }
    // `systemBlock` = la CONSTITUTION (source unique du soul, cf. constitution.ts). Elle sert ici de
    // FALLBACK uniquement quand aucun `opts.system` explicite n'est fourni (os.chat/chat_send).
    // Depuis l'unification chat↔orchestrateur, le chat cockpit ET les phases orchestrées injectent
    // la MÊME CONSTITUTION explicitement via leurs propres `parts` (agent-pilot.ts / orchestrator.ts) :
    // ce fallback ne les concerne donc pas — ce n'est plus une exclusion voulue du soul.
    const system = route.opts.system ?? this.systemBlock
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
    const pump = (async (): Promise<SendResult> => {
      let step = await nextStep()
      while (!step.done) {
        // Une fois l'appel annulé, continuer à drainer le générateur pour observer sa vraie fin,
        // mais ne plus livrer de delta à une conversation déjà clôturée.
        if (!effectiveOptions.signal.aborted && !spawnFailure) onChunk?.(step.value)
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
          throw error
        }
      )
      .finally(() => {
        if (drainGraceTimer) clearTimeout(drainGraceTimer)
      })
    return withHardDeadline(
      trackedPump,
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
