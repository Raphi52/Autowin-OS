import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './types'

/**
 * Routeur d'adaptateurs. Le seul point par lequel l'app envoie un tour :
 * choisit l'adaptateur par id, INJECTE le bloc système (kit condensé) de façon
 * uniforme, délègue le streaming à l'adaptateur, et centralise la traçabilité.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()
  private conversationTransport: {
    provider: string
    model: string
    reasoningEffort?: string
  } | null = null

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

  setConversationTransport(route: {
    provider: string
    model: string
    reasoningEffort?: string
  }): void {
    this.get(route.provider)
    if (route.provider !== 'omniroute') throw new Error('OmniRoute est le seul transport autorisé')
    if (!route.model.trim()) throw new Error('Modèle de transport vide')
    this.conversationTransport = { ...route }
  }

  getConversationTransport(): {
    provider: string
    model: string
    reasoningEffort?: string
  } | null {
    return this.conversationTransport ? { ...this.conversationTransport } : null
  }

  private resolve(id: string, opts: SendOptions): { id: string; opts: SendOptions } {
    if (opts.execution) {
      const requested = this.get(id)
      if (requested.supportsExecution === true) return { id, opts }

      // Un rôle NON-exécuteur (ex. OmniRoute) demandant une exécution est délégué à un runner
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
    if (!this.conversationTransport)
      throw new Error('OmniRoute obligatoire : aucun transport conversationnel configuré')
    return {
      id: this.conversationTransport.provider,
      opts: {
        ...opts,
        model: this.conversationTransport.model,
        // L'effort choisi pour la route (UI) prime ; sinon on garde celui de la requête.
        reasoningEffort: this.conversationTransport.reasoningEffort ?? opts.reasoningEffort
      }
    }
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
    // F4 (décision : SOUL chat-only, intentionnel) — `systemBlock` = le kit SOUL, injecté par
    // DÉFAUT (chat direct). L'orchestration passe TOUJOURS `opts.system` (SKILL.md + discipline +
    // style + capacités + contexte), qui REMPLACE le soul : les phases ne reçoivent donc pas le
    // soul, et c'est VOULU (le SKILL.md de la phase porte déjà la discipline pertinente ; concaténer
    // le soul long à chaque phase gonflerait les tokens sans valeur nette).
    const system = route.opts.system ?? this.systemBlock
    const gen = adapter.send(messages, { ...route.opts, system })

    let step = await gen.next()
    while (!step.done) {
      onChunk?.(step.value)
      step = await gen.next()
    }
    // Valeur de retour du generator = SendResult final.
    return step.value
  }
}
