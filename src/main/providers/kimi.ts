import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './types'

/** Résolution sans shell : le CLI Kimi Code officiel appartient au compte local. */
export type KimiCommand = { executable: string; prefix: string[] }

/** Sous Windows, appelle directement l'entrypoint ESM : spawn ne lance pas kimi.cmd sans shell. */
export function resolveKimiCommand(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env
): KimiCommand {
  const configured = explicit ?? environment.KIMI_BIN
  if (configured) {
    if (/\.cmd$/i.test(configured))
      throw new Error('KIMI_BIN doit viser un executable, pas le shim kimi.cmd.')
    return { executable: configured, prefix: [] }
  }
  if (process.platform === 'win32' && environment.APPDATA) {
    const entrypoint = join(
      environment.APPDATA,
      'npm',
      'node_modules',
      '@moonshot-ai',
      'kimi-code',
      'dist',
      'main.mjs'
    )
    if (existsSync(entrypoint)) return { executable: process.execPath, prefix: [entrypoint] }
  }
  return { executable: 'kimi', prefix: [] }
}

/**
 * Kimi Code n'expose pas de champ system séparé en mode `-p`.
 * Le bloc est donc explicitement matérialisé dans la consigne transmise au CLI,
 * avec une séparation visible qui reste inspectable dans Workflows.
 */
export function buildKimiPrompt(messages: Message[], system?: string): string {
  const history = messages
    .filter((message) => message.role !== 'system')
    .map(
      (message) =>
        `${message.role === 'assistant' ? 'ASSISTANT' : 'UTILISATEUR'}:\n${message.content}`
    )
    .join('\n\n')
  const parts: string[] = []
  if (system?.trim()) {
    parts.push(`INSTRUCTIONS SYSTEME AUTOWIN OS (applique-les) :\n${system.trim()}`)
  }
  parts.push(
    'Réponds uniquement au contenu conversationnel suivant. N’utilise aucun outil, ne lis ni n’écris aucun fichier et n’exécute aucune commande.',
    history || 'UTILISATEUR:\n'
  )
  return parts.join('\n\n---\n\n')
}

/** Extrait du texte des variantes JSONL documentées/compatibles du CLI Kimi. */
export function kimiTextFromEvent(event: Record<string, unknown>): string {
  if (typeof event.delta === 'string') return event.delta
  if (typeof event.text === 'string') return event.text
  const message = event.message
  if (typeof message === 'string') return message
  if (message && typeof message === 'object') {
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part
          if (
            part &&
            typeof part === 'object' &&
            typeof (part as { text?: unknown }).text === 'string'
          ) {
            return (part as { text: string }).text
          }
          return ''
        })
        .join('')
    }
  }
  return ''
}

export interface KimiCliAdapterOptions {
  bin?: string
  timeoutMs?: number
}

/**
 * Pont compte Kimi Code : réutilise exclusivement l'OAuth détenu par le CLI
 * officiel dans `%USERPROFILE%\\.kimi-code`, sans jamais lire/copier son token.
 */
export class KimiCliAdapter implements ProviderAdapter {
  readonly id = 'kimi'
  private readonly command: KimiCommand
  private readonly timeoutMs: number

  constructor(opts: KimiCliAdapterOptions = {}) {
    this.command = resolveKimiCommand(opts.bin)
    this.timeoutMs = opts.timeoutMs ?? 120_000
  }

  /** Vérifie uniquement la disponibilité du CLI. L'OAuth reste privé au CLI. */
  async auth(): Promise<boolean> {
    return await new Promise((resolve) => {
      try {
        const child = spawn(this.command.executable, [...this.command.prefix, '--version'], {
          shell: false
        })
        child.on('error', () => resolve(false))
        child.on('close', (code) => resolve(code === 0))
      } catch {
        resolve(false)
      }
    })
  }

  /** Ouvre le device-login officiel sans lire ni copier le code ou les tokens. */
  startLogin(): void {
    const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
    const command = `& ${quote(this.command.executable)} ${this.command.prefix.map(quote).join(' ')} login`
    const child = spawn('powershell.exe', ['-NoExit', '-Command', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()
  }

  describePrompt(messages: Message[], opts: SendOptions, model?: string): PromptEnvelope {
    return {
      provider: this.id,
      model: model ?? opts.model,
      transport: 'Kimi Code CLI · --prompt + --output-format stream-json · OAuth compte local',
      system: opts.system,
      messages: messages.filter((message) => message.role !== 'system'),
      options: { resumed: false, effortIgnored: Boolean(opts.reasoningEffort) },
      limitation:
        'Exact à l’entrée du CLI Kimi. Kimi Code ne fournit pas de canal system distinct en `-p` ; le bloc est préfixé dans la consigne. Auth OAuth et transformations internes restent privées au CLI.'
    }
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const systemInjected = typeof opts.system === 'string' && opts.system.trim().length > 0
    const sandbox = mkdtempSync(join(tmpdir(), 'autowin-os-kimi-'))
    const args = [
      '--prompt',
      buildKimiPrompt(messages, opts.system),
      '--output-format',
      'stream-json',
      '--skills-dir',
      sandbox
    ]
    if (opts.model) args.push('--model', opts.model)
    const child = spawn(this.command.executable, [...this.command.prefix, ...args], {
      shell: false,
      cwd: sandbox
    })
    opts.signal?.addEventListener('abort', () => child.kill())

    const timer = setTimeout(() => child.kill(), this.timeoutMs)
    let buffer = ''
    let text = ''
    let done = false
    let errored: Error | null = null
    let wake: (() => void) | undefined
    const queue: StreamChunk[] = []

    const emitLine = (line: string): void => {
      try {
        const delta = kimiTextFromEvent(JSON.parse(line) as Record<string, unknown>)
        if (delta) {
          text += delta
          queue.push({ delta })
        }
      } catch {
        /* le contrat stream-json peut évoluer : bruit ignoré, stderr reste diagnostic CLI */
      }
    }
    const notify = (): void => {
      wake?.()
      wake = undefined
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) emitLine(line)
      }
      notify()
    })
    child.on('error', (error) => {
      errored = error
      done = true
      notify()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const rest = buffer.trim()
      if (rest) emitLine(rest)
      if (code !== 0 && !errored) {
        errored = new Error(
          `Kimi Code indisponible ou non connecté (exit ${code}). Installe Kimi Code puis lance \`kimi login\` pour relier ton compte.`
        )
      }
      rmSync(sandbox, { recursive: true, force: true })
      done = true
      notify()
    })

    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!
      } else if (!done) {
        await new Promise<void>((resolve) => (wake = resolve))
      }
    }
    if (errored) throw errored
    return { text, provider: this.id, systemInjected }
  }
}
