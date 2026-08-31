import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSurvivable } from '../runs/survivable-spawn'
import { killEscalate, resolveProviderTimeoutMs } from './watchdog'
import { abortFailure } from './abort-diagnostic'
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

export function buildGeminiPrompt(
  messages: Message[],
  system?: string,
  tooled = false
): string {
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
    tooled
      ? 'Tu travailles en mode agent outillé dans le dossier de travail fourni : utilise tes outils, lis et modifie les fichiers nécessaires pour accomplir la demande, puis rends compte de ce que tu as fait.'
      : 'Réponds uniquement au contenu conversationnel suivant. N’utilise aucun outil et ne modifie aucun fichier.',
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
  const timeoutMinutes = Math.max(
    1,
    Math.ceil(resolveProviderTimeoutMs(opts.execution?.providerTimeoutMs, 120_000) / 60_000)
  )
  // Antigravity CLI 1.1.x n'accepte que deux modes : `plan` (lecture) et `accept-edits`
  // (outillé, écriture). L'écriture n'est ouverte QUE pour une exécution orchestrée dont le
  // sandbox demandé autorise la mutation ; le chat et le read-only restent en plan sandboxé.
  const tooled =
    opts.execution?.sandbox === 'workspace-write' ||
    opts.execution?.sandbox === 'danger-full-access'
  const args = ['--print', buildGeminiPrompt(messages, opts.system, tooled), '--mode']
  if (tooled) {
    args.push('accept-edits', '--dangerously-skip-permissions')
    if (opts.execution?.cwd) args.push('--add-dir', opts.execution.cwd)
  } else {
    args.push('plan', '--sandbox')
  }
  args.push('--print-timeout', `${timeoutMinutes}m`)
  if (opts.model) args.push('--model', opts.model)
  return args
}

export function isAntigravityAuthProbe(code: number | null, output: string): boolean {
  return code === 0 && output.trim() === 'AUTOWIN_AUTH_OK'
}

/** Pont vers le compte Google détenu par Antigravity ; aucun token n'est lu par Autowin OS. */
export class GeminiCliAdapter implements ProviderAdapter {
  readonly id = 'gemini'
  /** Antigravity exécute réellement des outils en `accept-edits` : plus de repli vers un quota payant. */
  readonly supportsExecution = true
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
    const cleanupSandbox = (): void => {
      try {
        rmSync(sandbox, { recursive: true, force: true })
      } catch {
        // Windows peut garder le cwd du processus verrouillé quelques ms après kill/close.
      }
    }
    return await new Promise((resolve) => {
      try {
        const args = buildGeminiArgs(
          [{ role: 'user', content: 'Réponds exactement AUTOWIN_AUTH_OK' }],
          { model: 'Gemini 3.5 Flash (Low)', system: 'Réponds sans outil.' }
        )
        const run = spawnSurvivable({
          bin: this.command.executable,
          args: [...this.command.prefix, ...args],
          cwd: sandbox,
          journalRoot: sandbox,
          runId: `gemini-auth-${randomUUID()}`
        })
        const child = run.child
        let output = ''
        let childClosed = false
        let settled = false
        const tailSettled = run
          .tail((line) => (output += `${line}\n`), { isComplete: () => childClosed })
          .then(
            () => undefined,
            (error: unknown) => error
          )
        const finish = async (code: number | null, transportOk: boolean): Promise<void> => {
          if (settled) return
          settled = true
          childClosed = true
          clearTimeout(timer)
          const tailError = await tailSettled
          run.release()
          cleanupSandbox()
          resolve(transportOk && !tailError && isAntigravityAuthProbe(code, output))
        }
        const timer = setTimeout(() => {
          killEscalate(child)
          void finish(null, false)
        }, 20_000)
        child.on('error', () => {
          void finish(null, false)
        })
        child.on('close', (code) => {
          childClosed = true
          void finish(code, true)
        })
      } catch {
        cleanupSandbox()
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
      systemBlocks: opts.systemBlocks,
      contextBlocks: opts.contextBlocks,
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
    // Une exécution orchestrée doit muter le WORKSPACE du run, pas un dossier jetable.
    const workingDir = opts.execution?.cwd ?? sandbox
    const args = buildGeminiArgs(messages, opts)
    const spawnToken = randomUUID()
    opts.execution?.onSpawnIntent?.(spawnToken, true)
    const run = spawnSurvivable({
      bin: this.command.executable,
      args: [...this.command.prefix, ...args],
      cwd: workingDir,
      journalRoot: process.env.AUTOWIN_RUN_JOURNAL_ROOT ?? join(sandbox, '.run'),
      runId: spawnToken,
      onJournalPrepared:
        (opts.execution?.onJournal ?? opts.onJournal)
          ? (journalPath) =>
              (opts.execution?.onJournal ?? opts.onJournal)?.(spawnToken, journalPath)
          : undefined
    })
    const child = run.child
    const childPid = child.pid
    if (childPid) {
      if (opts.execution?.onSpawned) opts.execution.onSpawned(spawnToken, childPid)
      else {
        opts.execution?.onProcess?.(childPid, true)
        opts.execution?.onSpawnIntent?.(spawnToken, false)
      }
    }
    let text = ''
    let done = false
    let childClosed = false
    let exitCode: number | null = null
    let errored: Error | null = null
    let wake: (() => void) | undefined
    const queue: StreamChunk[] = []
    const tailController = new AbortController()
    const timer = setTimeout(
      () => {
        errored = new Error('Gemini via Antigravity a dépassé la durée maximale.')
        killEscalate(child)
        forceTerminate(errored)
      },
      resolveProviderTimeoutMs(opts.execution?.providerTimeoutMs, this.timeoutMs)
    )
    const onAbort = (): void => {
      const error = abortFailure('Envoi Gemini', opts.signal)
      error.name = 'AbortError'
      errored = error
      killEscalate(child)
      forceTerminate(error)
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const notify = (): void => {
      wake?.()
      wake = undefined
    }
    const cleanupSandbox = (): void => {
      try {
        rmSync(sandbox, { recursive: true, force: true })
      } catch {
        // Le processus peut encore conserver son cwd quelques instants apres l'escalade de kill.
      }
    }
    function forceTerminate(error: Error): void {
      if (done) return
      errored = error
      done = true
      queue.length = 0
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      tailController.abort(error)
      run.release()
      cleanupSandbox()
      notify()
    }
    opts.execution?.registerTermination?.((reason) => {
      killEscalate(child)
      forceTerminate(new Error(reason))
    })
    const consumeLine = (line: string): void => {
      if (done) return
      const delta = `${line}\n`
      text += delta
      queue.push({ delta })
      notify()
    }
    child.on('error', (error) => {
      if (!childPid) opts.execution?.onSpawnIntent?.(spawnToken, false)
      forceTerminate(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (childPid) opts.execution?.onProcess?.(childPid, false)
      exitCode = code
      childClosed = true
    })
    void run
      .tail(consumeLine, {
        isComplete: () => childClosed,
        signal: opts.signal
          ? AbortSignal.any([opts.signal, tailController.signal])
          : tailController.signal
      })
      .then(() => {
        if (exitCode !== 0 && !errored) {
          const detail = text.trim().split(/\r?\n/).at(-1)
          errored = new Error(
            `Gemini via Antigravity indisponible ou non connecté (exit ${exitCode}). Ouvre « Connecter Gemini » pour relier ton compte Google.${detail ? ` ${detail}` : ''}`
          )
        }
      })
      .catch((error: unknown) => {
        if (!errored) errored = error instanceof Error ? error : new Error(String(error))
      })
      .finally(() => {
        run.release()
        cleanupSandbox()
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
