import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { codexLauncher } from './providers/codex'
import { killEscalate } from './providers/watchdog'

/*
 * CATALOGUE DES MODÈLES CHATGPT — rétabli le 2026-10-31 (conv-1414, « ajoute les modèles de ChatGPT
 * à Autowin OS et branche tout ce qu'il faut »), après son retrait du 2026-09-04 (db73f84d).
 *
 * La source est le protocole officiel `codex app-server` (`model/list`) du CLI installé et connecté :
 * c'est le catalogue RÉEL du compte, jamais une liste figée. Mesuré le 2026-10-31 : le CLI 0.151
 * rendait terra/luna 5.6 ; le 0.166 ajoute `gpt-6-luna` (défaut). La liste dépend donc aussi de la
 * version du CLI, pas seulement du compte.
 */

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
  /** Injectable pour le test : sinon `process.arch`, qui decide du triplet du binaire natif. */
  arch?: string
  /** Injectable pour le test : présence d'un fichier sur le disque. */
  exists?: (path: string) => boolean
}

function commandSpec(options: CodexModelSourceOptions): { command: string; args: string[] } {
  const configured = options.codexBin ?? process.env.CODEX_BIN
  if (configured) return { command: configured, args: ['app-server'] }
  // MÊME résolution que `codex exec` : binaire NATIF d'abord (le wrapper `codex.js` relance le natif
  // sans `windowsHide`, d'où une console visible — mesuré le 2026-08-05), préfixe npm de %APPDATA%
  // puis PATH. Elle jette « Codex CLI introuvable » quand rien n'est installé.
  const launcher = codexLauncher(
    'appData' in options ? options.appData : process.env.APPDATA,
    options.exists,
    options.platform,
    options.arch
  )
  return { command: launcher.executable, args: [...launcher.prefixArgs, 'app-server'] }
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
  const timeoutMs = options.timeoutMs ?? 10_000

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
