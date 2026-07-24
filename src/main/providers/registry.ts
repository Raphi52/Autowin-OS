import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './types'
import { withHardDeadline } from './watchdog'

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

function assertOutsideLegacyFabricBridge(providerId: string): void {
  if (providerId.startsWith('fabric:')) {
    throw new Error('Une ressource Fabric exige autowin.tool-stream/v1, hors bridge legacy')
  }
}

/**
 * Routeur d'adaptateurs. Le seul point par lequel l'app envoie un tour :
 * choisit l'adaptateur par id, INJECTE le bloc système (kit condensé) de façon
 * uniforme, délègue le streaming à l'adaptateur, et centralise la traçabilité.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  /** Bloc système par défaut (kit condensé SOUL) injecté sur CHAQUE tour. */
  constructor(private readonly systemBlock: string | undefined = undefined) {}

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

  private resolve(id: string, opts: SendOptions): { id: string; opts: SendOptions } {
    assertOutsideLegacyFabricBridge(id)
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
    const gen = adapter.send(messages, { ...route.opts, system })

    // Pompe du stream, enveloppée d'un PLAFOND DUR de coordination : si l'adaptateur ne rend jamais la
    // main (zombie, `close` jamais émis), la course rejette au lieu de pendre à l'infini. Garantie que
    // l'orchestrateur se règle TOUJOURS ; le watchdog de flux des adaptateurs tue le process bien avant.
    const pump = (async (): Promise<SendResult> => {
      let step = await gen.next()
      while (!step.done) {
        onChunk?.(step.value)
        step = await gen.next()
      }
      // Valeur de retour du generator = SendResult final.
      return step.value
    })()
    return withHardDeadline(
      pump,
      COORDINATION_CEILING_MS,
      `Sous-agent ${route.id} sans réponse depuis ${Math.round(COORDINATION_CEILING_MS / 1000)}s (watchdog coordination) — abandonné pour ne pas bloquer le run.`
    )
  }
}
