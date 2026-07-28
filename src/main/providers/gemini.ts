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

export type GeminiCommand = { executable: string; prefix: string[] }

/** Résout le binaire officiel Antigravity, successeur de Gemini CLI pour les comptes personnels. */
export function resolveGeminiCommand(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env
): GeminiCommand {
  const configured = explicit ?? environment.AGY_BIN
  if (configured) {
    if (/\.cmd$/i.test(configured))
      throw new Error('AGY_BIN doit viser un exécutable, pas un shim cmd.')
    return { executable: configured, prefix: [] }
  }
  if (process.platform === 'win32' && environment.LOCALAPPDATA) {
    return { executable: join(environment.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'), prefix: [] }
  }
  return { executable: 'agy', prefix: [] }
}

export function buildGeminiPrompt(messages: Message[], system?: string): string {
  const history = messages
    .filter((message) => message.role !== 'system')
    .map(
      (message) =>
        `${message.role === 'assistant' ? 'ASSISTANT' : 'UTILISATEUR'}:\n${message.content}`
    )
    .join('\n\n')
  const parts: string[] = []
  if (system?.trim())
    parts.push(`INSTRUCTIONS SYSTEME AUTOWIN OS (applique-les) :\n${system.trim()}`)
  parts.push(
    'Réponds uniquement au contenu conversationnel suivant. N’utilise aucun outil et ne modifie aucun fichier.',
    history || 'UTILISATEUR:\n'
  )
  return parts.join('\n\n---\n\n')
}

export interface GeminiCliAdapterOptions {
  bin?: string
  /** Injection de transport réservée aux tests de cycle de vie du processus. */
  command?: GeminiCommand
  timeoutMs?: number
}

export function buildGeminiArgs(messages: Message[], opts: SendOptions): string[] {
  const args = [
    '--print',
    buildGeminiPrompt(messages, opts.system),
    '--mode',
    'plan',
    '--sandbox',
    '--print-timeout',
    '2m'
  ]
  if (opts.model) args.push('--model', opts.model)
  return args
}

export function isAntigravityAuthProbe(code: number | null, output: string): boolean {
  return code === 0 && output.trim() === 'AUTOWIN_AUTH_OK'
}

/** Pont vers le compte Google détenu par Antigravity ; aucun token n'est lu par Autowin OS. */
export class GeminiCliAdapter implements ProviderAdapter {
  readonly id = 'gemini'
  private readonly command: GeminiCommand
  private readonly timeoutMs: number

  constructor(opts: GeminiCliAdapterOptions = {}) {
    this.command = opts.command ?? resolveGeminiCommand(opts.bin)
    this.timeoutMs = opts.timeoutMs ?? 120_000
  }

  /** Micro-sonde réelle : évite d'annoncer connecté quand seul le binaire est installé. */
  async auth(): Promise<boolean> {
    if (!existsSync(this.command.executable) && this.command.executable !== 'agy') return false
    const sandbox = mkdtempSync(join(tmpdir(), 'autowin-os-gemini-auth-'))
    return await new Promise((resolve) => {
      try {
        const args = buildGeminiArgs(
          [{ role: 'user', content: 'Réponds exactement AUTOWIN_AUTH_OK' }],
          { model: 'Gemini 3.5 Flash (Low)', system: 'Réponds sans outil.' }
        )
        const child = spawn(this.command.executable, [...this.command.prefix, ...args], {
          shell: false,
          windowsHide: true,
          cwd: sandbox
        })
        let output = ''
        child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
        const timer = setTimeout(() => {
          child.kill()
          rmSync(sandbox, { recursive: true, force: true })
          resolve(false)
        }, 20_000)
        child.on('error', () => {
          clearTimeout(timer)
          rmSync(sandbox, { recursive: true, force: true })
          resolve(false)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          rmSync(sandbox, { recursive: true, force: true })
          resolve(isAntigravityAuthProbe(code, output))
        })
      } catch {
        rmSync(sandbox, { recursive: true, force: true })
        resolve(false)
      }
    })
  }

  /** Ouvre le flux interactif officiel ; Google conserve seul les credentials OAuth. */
  startLogin(): void {
    const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
    const command = `& ${quote(this.command.executable)} ${this.command.prefix.map(quote).join(' ')}`
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
      transport: 'Antigravity CLI officiel · --print · compte Google local',
      system: opts.system,
      messages: messages.filter((message) => message.role !== 'system'),
      options: {
        model: opts.model,
        mode: 'plan',
        sandbox: true,
        resumed: false,
        effortIgnored: Boolean(opts.reasoningEffort)
      },
      limitation:
        'Exact à l’entrée d’Antigravity CLI. Le CLI 1.1.4 ne remonte ni session ni tokens en mode --print ; ses transformations et credentials restent privés.'
    }
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    if (opts.signal?.aborted) {
      const error = new Error('Envoi Gemini annulé avant son démarrage.')
      error.name = 'AbortError'
      throw error
    }
    const systemInjected = typeof opts.system === 'string' && opts.system.trim().length > 0
    const sandbox = mkdtempSync(join(tmpdir(), 'autowin-os-gemini-'))
    const args = buildGeminiArgs(messages, opts)

    const child = spawn(this.command.executable, [...this.command.prefix, ...args], {
      shell: false,
      cwd: sandbox,
      windowsHide: true
    })
    const timer = setTimeout(() => child.kill(), this.timeoutMs)
    let stderr = ''
    let text = ''
    let done = false
    let errored: Error | null = null
    let wake: (() => void) | undefined
    const queue: StreamChunk[] = []
    const onAbort = (): void => {
      const error = new Error('Envoi Gemini annulé.')
      error.name = 'AbortError'
      errored = error
      child.kill()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const notify = (): void => {
      wake?.()
      wake = undefined
    }
    child.stdout.on('data', (chunk: Buffer) => {
      const delta = chunk.toString('utf8')
      text += delta
      queue.push({ delta })
      notify()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4_000)
    })
    child.on('error', (error) => {
      errored = error
      done = true
      notify()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (code !== 0 && !errored) {
        const detail = stderr.trim().split(/\r?\n/).at(-1)
        errored = new Error(
          `Gemini via Antigravity indisponible ou non connecté (exit ${code}). Ouvre « Connecter Gemini » pour relier ton compte Google.${detail ? ` ${detail}` : ''}`
        )
      }
      rmSync(sandbox, { recursive: true, force: true })
      done = true
      notify()
    })

    while (!done || queue.length > 0) {
      if (queue.length > 0) yield queue.shift()!
      else if (!done) await new Promise<void>((resolve) => (wake = resolve))
    }
    if (errored) throw errored
    return { text: text.trim(), provider: this.id, systemInjected }
  }
}
