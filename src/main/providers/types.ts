/**
 * Contrat d'adaptateur provider — l'interface interne STABLE d'Autowin OS.
 *
 * Toute voie modèle (Claude via claude-bridge, Codex via OAuth device-code, et
 * tout futur provider) implémente `ProviderAdapter`. Le reste de l'app ne parle
 * JAMAIS à un provider directement : il passe par cette interface + le routeur.
 * C'est la garde « adaptateur souverain » du framing (l'API non documentée d'un
 * provider ne fuit jamais au-delà de son implémentation d'adaptateur).
 */

/** Rôle d'un message dans une conversation. `system` = injection kit (SOUL). */
export type Role = 'system' | 'user' | 'assistant'

export interface Attachment {
  name: string
  mimeType: string
  size: number
  kind: 'text' | 'image' | 'file'
  /** UTF-8 pour `text`, base64 sans préfixe data URL pour `image` et `file`. */
  content: string
}

export interface Message {
  role: Role
  content: string
  attachments?: Attachment[]
}

/** Options d'un tour d'envoi. */
export interface SendOptions {
  /** Modèle exact choisi dans Agents. */
  model?: string
  /** Niveau d'effort choisi dans Agents, si le provider le supporte. */
  reasoningEffort?: string
  /**
   * Bloc système à injecter (le kit condensé SOUL.md). Le routeur le fournit ;
   * chaque adaptateur est responsable de le poser sur SON canal natif
   * (request["system"] concaténé pour Claude-bridge, champ `instructions` pour
   * Codex) — l'équivalence est au niveau CONTENU, pas protocole.
   */
  system?: string
  /** Reprise d'une session existante (cache-friendly) si l'adaptateur le gère. */
  resumeSessionId?: string
  /** Signal d'annulation coopératif. */
  signal?: AbortSignal
  /** Observation du payload final, juste avant spawn/fetch. Jamais transmis au provider. */
  observePrompt?: (prompt: PromptEnvelope) => void
}

/** Enveloppe observable réellement remise à l'adaptateur, avant transport provider. */
export interface PromptEnvelope {
  provider: string
  model?: string
  transport: string
  system?: string
  messages: Message[]
  options: Record<string, unknown>
  limitation: string
}

/** Fragment de réponse streamée. */
export interface StreamChunk {
  /** Texte incrémental. */
  delta: string
}

/** Consommation réelle d'un tour, telle que remontée par le provider. */
export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  costUsd?: number
}

/** Résultat final d'un tour, après consommation du stream. */
export interface SendResult {
  /** Texte complet assemblé. */
  text: string
  /** Identité du provider ayant répondu (traçabilité / log de tour). */
  provider: string
  /** Id de session à réutiliser pour un `resume` ultérieur, si fourni. */
  sessionId?: string
  /** Le bloc système a-t-il bien été injecté sur ce tour (preuve d'injection). */
  systemInjected: boolean
  /** Tokens/coût réels du tour (undefined si le provider ne les remonte pas). */
  usage?: Usage
}

/**
 * Un adaptateur provider. Contrat minimal : identité, auth, envoi streamé, reprise.
 * `send` est un async-generator : il yield des `StreamChunk` puis retourne un
 * `SendResult` final (via la valeur de retour du generator).
 */
export interface ProviderAdapter {
  /** Identifiant stable, ex. 'claude' | 'codex'. */
  readonly id: string

  /**
   * S'assure que l'adaptateur est authentifié (OAuth abonnement, PAS clé API).
   * Retourne true si prêt à servir des complétions.
   */
  auth(): Promise<boolean>

  /**
   * Envoie une conversation et streame la réponse.
   * @returns un async generator qui yield des chunks et RETOURNE le SendResult final.
   */
  send(messages: Message[], opts?: SendOptions): AsyncGenerator<StreamChunk, SendResult, void>
  describePrompt?(messages: Message[], opts: SendOptions, model?: string): PromptEnvelope
}
