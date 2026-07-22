import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Attachment,
  ExecutionEvidence,
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './types'

/**
 * Mappe un outil Claude (tool_use) vers le type de preuve d'exécution commun (mutation / vérification
 * / inspection), miroir de codex. Contrat provider-agnostique : tout exécuteur émet ce même shape.
 */
export function claudeToolEvidenceKind(name: string, command: string): ExecutionEvidence['kind'] {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/i.test(name)) return 'mutation'
  const verify =
    /\b(vitest|jest|pytest|cargo\s+test|dotnet\s+test|go\s+test|tsc|eslint|npm(?:\.cmd)?\s+(?:test|run\s+(?:test|typecheck|build|lint))|pnpm\s+(?:test|run)|node\s+-e)\b/i
  if (/^Bash$/i.test(name)) return verify.test(command) ? 'verification' : 'inspection'
  return 'inspection'
}

export interface MaterializedAttachments {
  dir: string
  paths: string[]
  promptSuffix: string
  cleanup: () => void
}

export function materializeClaudeAttachments(attachments: Attachment[]): MaterializedAttachments {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-os-attachments-'))
  const paths = attachments.map((attachment, index) => {
    const safeName =
      Array.from(attachment.name.replace(/[\\/:*?"<>|]/g, '_'), (character) =>
        character.charCodeAt(0) <= 31 ? '_' : character
      )
        .join('')
        .replace(/^\.+/, '') || 'fichier'
    const path = join(dir, `${index + 1}-${safeName}`)
    const data =
      attachment.kind === 'text' ? attachment.content : Buffer.from(attachment.content, 'base64')
    writeFileSync(path, data)
    return path
  })
  return {
    dir,
    paths,
    promptSuffix:
      '\n\nPIÈCES JOINTES EXPLICITEMENT FOURNIES PAR L’UTILISATEUR :\n' +
      paths.map((path) => `- ${path}`).join('\n') +
      '\nUtilise Read uniquement pour consulter ces fichiers si nécessaire.',
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Résout le binaire natif `claude.exe` (ou `claude`) SANS passer par le shim
 * shell — indispensable pour spawner avec `shell:false` (args séparés → aucune
 * injection d'arguments possible, et --system-prompt à espaces/accents intact).
 */
export function resolveClaudeBin(explicit?: string): string {
  if (explicit) return explicit
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA
    if (appdata) {
      const p = join(
        appdata,
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'bin',
        'claude.exe'
      )
      if (existsSync(p)) return p
    }
  }
  return 'claude'
}

/**
 * Adaptateur voie Claude — SOUVERAIN (aucune dépendance externe).
 *
 * Spawne le CLI officiel `claude -p` (abonnement, JAMAIS de replay du token OAuth
 * Anthropic — sanctionné HTTP 400 depuis 2026-06-15 ; la voie couverte par
 * l'abonnement est le CLI). Injection système via `--system-prompt` (REMPLACE le
 * prompt Claude Code par défaut → souverain + ~3× moins cher que --append) et
 * consigne LÉGITIME de style/discipline (le modèle refuse à raison une "consigne
 * secrète" d'allure injectée — l'injection se fait par contenu légitime).
 * Sortie parsée en `--output-format stream-json --verbose`.
 */
export interface ClaudeAdapterOptions {
  /** Binaire claude (défaut: 'claude' résolu via PATH). */
  bin?: string
  /** Timeout d'un tour en ms. */
  timeoutMs?: number
}

/** Ajoute au spawn les choix Agents réellement supportés par le CLI installé. */
export function appendClaudeSelectionArgs(args: string[], opts: SendOptions): void {
  if (opts.model) args.push('--model', opts.model)
  if (opts.reasoningEffort && opts.reasoningEffort !== 'none') {
    args.push('--effort', opts.reasoningEffort)
  }
}

export function claudeTransportEnvelope(
  messages: Message[],
  opts: SendOptions,
  materialized: MaterializedAttachments | undefined,
  args: string[]
): PromptEnvelope {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  return {
    provider: 'claude',
    model: opts.model,
    transport: 'claude CLI spawn argv',
    system: opts.system,
    messages: [
      {
        role: 'user',
        content: `${lastUserMessage?.content ?? ''}${materialized?.promptSuffix ?? ''}`,
        attachments: lastUserMessage?.attachments
      }
    ],
    options: { argv: [...args] },
    limitation:
      'Arguments exacts remis au CLI Claude. Les ajouts internes du CLI et la requete Anthropic finale ne sont pas exposes.'
  }
}

export class ClaudeCliAdapter implements ProviderAdapter {
  readonly id = 'claude'
  // B — Claude EST un exécuteur outillé (Claude Code). Quand `opts.execution` est fourni, on lance
  // le CLI avec les outils activés + un mode permission autonome, et on remonte l'executionEvidence.
  readonly supportsExecution = true
  private readonly bin: string
  private readonly timeoutMs: number

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.bin = resolveClaudeBin(opts.bin)
    this.timeoutMs = opts.timeoutMs ?? 120_000
  }

  /** L'auth vit dans le CLI (abonnement déjà loggé) — on vérifie qu'il répond. */
  async auth(): Promise<boolean> {
    return await new Promise((resolve) => {
      const p = spawn(this.bin, ['--version'], { shell: false })
      p.on('error', () => resolve(false))
      p.on('close', (code) => resolve(code === 0))
    })
  }

  describePrompt(messages: Message[], opts: SendOptions, model?: string): PromptEnvelope {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    return {
      provider: this.id,
      model: model ?? opts.model,
      transport: 'claude CLI · -p + --system-prompt[-file]',
      system: opts.system,
      messages: lastUser ? [lastUser] : [],
      options: {
        toolsDisabled: true,
        strictMcpConfig: true,
        resumed: Boolean(opts.resumeSessionId),
        effort: opts.reasoningEffort
      },
      limitation:
        'Exact à l’entrée du CLI Claude. Les ajouts dynamiques internes du CLI et la requête Anthropic finale ne sont pas exposés.'
    }
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const materialized = lastUserMessage?.attachments?.length
      ? materializeClaudeAttachments(lastUserMessage.attachments)
      : undefined
    const lastUser = `${lastUserMessage?.content ?? ''}${materialized?.promptSuffix ?? ''}`
    const system = opts.system
    const systemInjected = typeof system === 'string' && system.length > 0

    const execution = opts.execution
    const args = ['-p', lastUser, '--output-format', 'stream-json', '--verbose', '--strict-mcp-config']
    if (execution) {
      // B — mode exécuteur : outils activés + permission autonome, dans le cwd borné. A (générique) :
      // read-only ⇒ pas d'écriture/Bash-mutation ; workspace-write/danger ⇒ édition + Bash.
      const write = execution.sandbox !== 'read-only'
      const tools = write ? 'Read,Grep,Glob,Bash,Edit,Write,MultiEdit' : 'Read,Grep,Glob'
      args.push('--permission-mode', 'bypassPermissions', '--add-dir', execution.cwd, '--allowedTools', tools)
    } else if (materialized) {
      args.push('--tools', 'Read', '--allowedTools', 'Read')
    } else {
      args.push('--disallowedTools', '*')
    }
    let systemPromptDir: string | undefined
    if (systemInjected && system!.length > 4_000) {
      systemPromptDir = mkdtempSync(join(tmpdir(), 'autowin-os-system-'))
      const systemPromptFile = join(systemPromptDir, 'system.md')
      writeFileSync(systemPromptFile, system!, 'utf8')
      args.push('--system-prompt-file', systemPromptFile)
    } else if (systemInjected) {
      args.push('--system-prompt', system!)
    }
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId)
    appendClaudeSelectionArgs(args, opts)

    opts.observePrompt?.(claudeTransportEnvelope(messages, opts, materialized, args))

    const child = spawn(this.bin, args, { shell: false, cwd: execution?.cwd })
    opts.signal?.addEventListener('abort', () => child.kill())

    const timer = setTimeout(() => child.kill(), this.timeoutMs)
    let buffer = ''
    let text = ''
    let sessionId: string | undefined
    let usage: SendResult['usage']
    const executionEvidence: ExecutionEvidence[] = []
    const pendingTools = new Map<string, { name: string; command: string }>()
    const queue: StreamChunk[] = []
    let done = false
    let errored: Error | null = null
    let resolveWait: (() => void) | null = null

    const wake = (): void => {
      resolveWait?.()
      resolveWait = null
    }

    const handleEvent = (o: Record<string, unknown>): void => {
      const t = o['type']
      if (t === 'assistant') {
        const msg = o['message'] as
          | {
              content?: Array<{
                type: string
                text?: string
                id?: string
                name?: string
                input?: Record<string, unknown>
              }>
            }
          | undefined
        for (const part of msg?.content ?? []) {
          if (part.type === 'text' && part.text) {
            text += part.text
            queue.push({ delta: part.text })
          } else if (part.type === 'tool_use' && part.id && part.name) {
            // B — mémorise l'appel outil ; la preuve (ok/échec) arrive dans le tool_result associé.
            const command = String(part.input?.command ?? part.input?.file_path ?? '')
            pendingTools.set(part.id, { name: part.name, command })
          }
        }
      } else if (t === 'user') {
        // tool_result : apparie l'appel outil → executionEvidence (shape commun à tous les exécuteurs).
        const msg = o['message'] as
          | { content?: Array<{ type: string; tool_use_id?: string; is_error?: boolean }> }
          | undefined
        for (const part of msg?.content ?? []) {
          if (part.type !== 'tool_result' || !part.tool_use_id) continue
          const call = pendingTools.get(part.tool_use_id)
          if (!call) continue
          pendingTools.delete(part.tool_use_id)
          executionEvidence.push({
            type: call.name,
            kind: claudeToolEvidenceKind(call.name, call.command),
            status: part.is_error ? 'failed' : 'completed',
            ok: part.is_error !== true,
            summary: `${call.name} ${call.command}`.trim()
          })
        }
      } else if (t === 'result') {
        if (typeof o['result'] === 'string' && !text) text = o['result'] as string
        if (typeof o['session_id'] === 'string') sessionId = o['session_id'] as string
        if (o['is_error'] === true)
          errored = new Error(`claude result error: ${String(o['result'] ?? '')}`)
        // Tokens/coût RÉELS du tour (le result event du CLI les porte).
        const u = o['usage'] as
          | { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
          | undefined
        if (u) {
          usage = {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens,
            costUsd:
              typeof o['total_cost_usd'] === 'number' ? (o['total_cost_usd'] as number) : undefined
          }
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          handleEvent(JSON.parse(line) as Record<string, unknown>)
        } catch {
          /* ligne non-JSON (bruit) — ignorée */
        }
      }
      wake()
    })
    child.on('error', (e) => {
      errored = e
      done = true
      wake()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (systemPromptDir) rmSync(systemPromptDir, { recursive: true, force: true })
      materialized?.cleanup()
      // Flush du reliquat : un dernier event JSON sans '\n' terminal ne serait
      // jamais parsé (result/session_id perdus silencieusement) — on le traite ici.
      const rest = buffer.trim()
      if (rest) {
        try {
          handleEvent(JSON.parse(rest) as Record<string, unknown>)
        } catch {
          /* reliquat non-JSON — ignoré */
        }
        buffer = ''
      }
      if (code !== 0 && !errored) errored = new Error(`claude CLI exit ${code}`)
      done = true
      wake()
    })

    // pompe : yield les chunks au fil de l'eau
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!
        continue
      }
      if (done) break
      await new Promise<void>((r) => (resolveWait = r))
    }

    if (errored) throw errored
    return {
      text,
      provider: this.id,
      sessionId,
      systemInjected,
      usage,
      executionEvidence: executionEvidence.length ? executionEvidence : undefined
    }
  }
}
