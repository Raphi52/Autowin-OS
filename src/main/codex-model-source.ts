import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { killEscalate } from './providers/watchdog'

export interface CodexAppServerModel {
  id: string
  model: string
  displayName: string
  hidden: boolean
  isDefault: boolean
  defaultReasoningEffort: string
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>
}

type SpawnCodex = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; windowsHide: boolean }
) => ChildProcessWithoutNullStreams

export interface CodexModelSourceOptions {
  spawnFn?: SpawnCodex
  timeoutMs?: number
  codexBin?: string
  appData?: string
  platform?: NodeJS.Platform
}

function commandSpec(options: CodexModelSourceOptions): { command: string; args: string[] } {
  const configured = options.codexBin ?? process.env.CODEX_BIN
  if (configured) return { command: configured, args: ['app-server', '--stdio'] }

  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    const appData = options.appData ?? process.env.APPDATA
    const entrypoint = appData
      ? join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
      : ''
    if (!entrypoint || !existsSync(entrypoint)) {
      throw new Error('Codex CLI npm introuvable')
    }
    return { command: process.execPath, args: [entrypoint, 'app-server', '--stdio'] }
  }

  return { command: 'codex', args: ['app-server', '--stdio'] }
}

/**
 * Interroge le catalogue du compte actuellement connecté au Codex CLI via le
 * protocole officiel app-server. Toutes les pages et les modèles masqués sont lus.
 */
export async function listCodexAppServerModels(
  options: CodexModelSourceOptions = {}
): Promise<CodexAppServerModel[]> {
  const spec = commandSpec(options)
  const spawnFn: SpawnCodex =
    options.spawnFn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions))
  const child = spawnFn(spec.command, spec.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const timeoutMs = options.timeoutMs ?? 6_000

  return new Promise<CodexAppServerModel[]>((resolve, reject) => {
    let settled = false
    let nextId = 1
    let pendingId = 1
    let pages = 0
    const models: CodexAppServerModel[] = []
    const seenCursors = new Set<string>()
    const stderr: string[] = []
    const lines = createInterface({ input: child.stdout })

    const cleanup = (): void => {
      clearTimeout(timeout)
      lines.close()
      try {
        child.stdin.end()
      } catch {
        // Process déjà fermé.
      }
      killEscalate(child)
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(models)
    }
    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    const requestPage = (cursor: string | null): void => {
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          finish(new Error(`Curseur de pagination Codex cyclique: ${cursor}`))
          return
        }
        seenCursors.add(cursor)
      }
      pendingId = ++nextId
      send({
        id: pendingId,
        method: 'model/list',
        params: { cursor, limit: 100, includeHidden: true }
      })
    }

    const timeout = setTimeout(
      () => finish(new Error(`Codex app-server silencieux après ${timeoutMs} ms`)),
      timeoutMs
    )
    timeout.unref?.()

    child.stderr.on('data', (chunk: Buffer | string) => {
      if (stderr.join('').length < 4_096) stderr.push(String(chunk))
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (!settled) {
        finish(
          new Error(
            `Codex app-server fermé avant le catalogue (${code ?? 'signal'})${stderr.length ? `: ${stderr.join('').trim()}` : ''}`
          )
        )
      }
    })
    lines.on('line', (line) => {
      if (settled || !line.trim()) return
      let message: {
        id?: number
        error?: { message?: string }
        result?: { data?: CodexAppServerModel[]; nextCursor?: string | null }
      }
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id !== pendingId) return
      if (message.error) {
        finish(new Error(message.error.message ?? 'Erreur Codex app-server'))
        return
      }
      if (pendingId === 1) {
        send({ method: 'initialized' })
        requestPage(null)
        return
      }
      if (!Array.isArray(message.result?.data)) {
        finish(new Error('Réponse model/list Codex invalide'))
        return
      }
      models.push(...message.result.data)
      pages += 1
      const cursor = message.result.nextCursor
      if (!cursor) {
        finish()
        return
      }
      if (pages >= 50) {
        finish(new Error('Pagination Codex incomplète après 50 pages'))
        return
      }
      requestPage(cursor)
    })

    send({
      id: pendingId,
      method: 'initialize',
      params: {
        clientInfo: { name: 'autowin-os', version: '1.0.0' },
        capabilities: {}
      }
    })
  })
}
