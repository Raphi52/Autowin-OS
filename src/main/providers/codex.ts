import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './types'
import { loadTokens, refreshTokens, saveTokens, type FetchLike, type Tokens } from './codex-auth'

/**
 * Adaptateur voie Codex — abonnement ChatGPT via OAuth device-code (cf. codex-auth).
 * Inférence par HTTP direct sur l'API Responses (chatgpt.com/backend-api/codex),
 * PAS de spawn CLI. Injection système via le champ NATIF `instructions` (les
 * messages role=system y sont ignorés) — divergence protocole vs Claude, mais
 * équivalence de CONTENU (même bloc SOUL).
 */
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

export function codexContent(message: Message): Array<Record<string, string>> {
  const content: Array<Record<string, string>> = [{ type: 'input_text', text: message.content }]
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === 'text') {
      content.push({
        type: 'input_text',
        text: `<fichier nom="${escapeAttribute(attachment.name)}">\n${attachment.content}\n</fichier>`
      })
    } else if (attachment.kind === 'image') {
      content.push({
        type: 'input_image',
        image_url: `data:${attachment.mimeType || 'application/octet-stream'};base64,${attachment.content}`
      })
    } else {
      content.push({
        type: 'input_file',
        filename: attachment.name,
        file_data: `data:${attachment.mimeType || 'application/octet-stream'};base64,${attachment.content}`
      })
    }
  }
  return content
}

/** Extrait `chatgpt_account_id` du claim JWT de l'access_token (header exigé par le backend). */
export function accountIdFromJwt(token: string): string | undefined {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return undefined
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const claims = JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >
    const auth = claims['https://api.openai.com/auth'] as
      { chatgpt_account_id?: string } | undefined
    return auth?.chatgpt_account_id
  } catch {
    return undefined
  }
}

export interface CodexAdapterOptions {
  fetchFn?: FetchLike
  /** Fournit/rafraîchit les tokens ; défaut = store Autowin OS. */
  loadTokensFn?: () => Tokens | null
  model?: string
  timeoutMs?: number
}

export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex'
  private readonly fetchFn: FetchLike
  private readonly loadTokensFn: () => Tokens | null
  private readonly model: string

  constructor(opts: CodexAdapterOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch
    this.loadTokensFn = opts.loadTokensFn ?? (() => loadTokens())
    // gpt-5.6-terra : modèle réel accepté par Codex/compte ChatGPT (vérifié live ;
    // gpt-5-codex renvoie « model not supported »). Suffixe -terra = vrai variant.
    this.model = opts.model ?? 'gpt-5.6-terra'
  }

  async auth(): Promise<boolean> {
    return this.loadTokensFn() !== null
  }

  describePrompt(messages: Message[], opts: SendOptions, model?: string): PromptEnvelope {
    return {
      provider: this.id,
      model: model ?? opts.model ?? this.model,
      transport: 'Codex Responses API · instructions + input',
      system: opts.system,
      messages: messages.filter((message) => message.role !== 'system'),
      options: { store: false, stream: true, effort: opts.reasoningEffort },
      limitation:
        'Corps applicatif capturé avant sérialisation. Les instructions internes du service Codex ne sont pas exposées.'
    }
  }

  private async accessToken(): Promise<string> {
    let tok = this.loadTokensFn()
    if (!tok) throw new Error('codex non authentifié — lance npm run codex:login')
    // rafraîchit si proche de l'expiration (marge 5 min)
    if (tok.expiresInSec && Date.now() - tok.obtainedAt > (tok.expiresInSec - 300) * 1000) {
      tok = await refreshTokens(tok, this.fetchFn)
      saveTokens(tok)
    }
    return tok.accessToken
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const system = opts.system
    const systemInjected = typeof system === 'string' && system.length > 0
    const token = await this.accessToken()

    // Responses API : `instructions` = système natif ; `input` = historique (role=system ignoré).
    const input = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: codexContent(m) }))

    // fix-ok: contrat live (Hermes auxiliary_client.py:748) — chatgpt.com/backend-api/codex
    // exige store:false + les headers originator/User-Agent/ChatGPT-Account-ID (sinon 400/403
    // Cloudflare). L'account-id est extrait du claim JWT chatgpt_account_id.
    const body = {
      model: opts.model ?? this.model,
      instructions: systemInjected ? system : undefined,
      input,
      store: false,
      stream: true,
      reasoning: opts.reasoningEffort ? { effort: opts.reasoningEffort } : undefined
    }
    const serializedBody = JSON.stringify(body)
    opts.observePrompt?.({
      provider: this.id,
      model: body.model,
      transport: 'Codex Responses API fetch body',
      system: body.instructions,
      messages: [{ role: 'user', content: serializedBody }],
      options: { body },
      limitation: 'Corps JSON exact remis a fetch. Les instructions internes du service Codex ne sont pas exposees.'
    })

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      originator: 'codex_cli_rs',
      'User-Agent': 'codex_cli_rs/0.0.0 (autowin-os)'
    }
    const acct = accountIdFromJwt(token)
    if (acct) headers['ChatGPT-Account-ID'] = acct

    const res = await this.fetchFn(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers,
      body: serializedBody,
      signal: opts.signal
    })
    if (!res.ok || !res.body) throw new Error(`codex responses HTTP ${res.status}`)

    // Parse le flux SSE : events `response.output_text.delta` (delta) + `response.completed`.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let responseId: string | undefined
    let usage: SendResult['usage']

    // Traite une ligne SSE ; retourne un delta éventuel à yield (ou null).
    const parseLine = (raw: string): string | null => {
      const line = raw.trim()
      if (!line.startsWith('data:')) return null
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return null
      try {
        const ev = JSON.parse(payload) as {
          type?: string
          delta?: string
          response?: {
            id?: string
            usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }
          }
        }
        if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string')
          return ev.delta
        if (ev.type === 'response.completed') {
          responseId = ev.response?.id
          const measured = ev.response?.usage
          if (measured && (measured.input_tokens !== undefined || measured.output_tokens !== undefined)) {
            usage = {
              inputTokens: measured.input_tokens ?? 0,
              outputTokens: measured.output_tokens ?? 0,
              cacheReadTokens: measured.input_tokens_details?.cached_tokens
            }
          }
        }
      } catch {
        /* event non-JSON — ignoré */
      }
      return null
    }

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        const delta = parseLine(line)
        if (delta !== null) {
          text += delta
          yield { delta }
        }
      }
    }
    // Flush du reliquat : dernier `data: {...}` (delta ou response.completed) sans '\n'.
    if (buffer.trim()) {
      const delta = parseLine(buffer)
      if (delta !== null) {
        text += delta
        yield { delta }
      }
    }

    return { text, provider: this.id, sessionId: responseId, systemInjected, usage }
  }
}
