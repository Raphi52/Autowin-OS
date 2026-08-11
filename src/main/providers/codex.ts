import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk,
  ExecutionEvidence
} from './types'
import { executionEvidencePath } from './execution-evidence-path'
import { isShellMutation, isVerificationCommand } from './evidence-vocabulary'
import {
  appendWorkspaceMutationEvidence,
  captureWorkspaceMutationSnapshot
} from './workspace-mutation-evidence'
import { loadTokens, refreshTokens, saveTokens, type FetchLike, type Tokens } from './codex-auth'
import { joinThinking } from './thinking'
import {
  assertArgvWithinLimit,
  createStreamWatchdog,
  killEscalate,
  SUBAGENT_INACTIVITY_MS,
  SUBAGENT_TOTAL_MS
} from './watchdog'
import { spawnSurvivable } from '../runs/survivable-spawn'
import { findNpmGlobalFile } from './npm-global-resolve'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { ProviderArtifactCandidate } from '../../shared/artifacts'
import { artifactsFromExecutionEvidence, normalizeProviderArtifacts } from './artifacts'
import { addedLineFingerprintsFromUnifiedDiff } from '../exact-line-fingerprint'
import { attestIsolatedVerificationEvidence } from './causal-verification-evidence'

/**
 * Adaptateur voie Codex — abonnement ChatGPT via OAuth device-code (cf. codex-auth).
 * Inférence par HTTP direct sur l'API Responses (chatgpt.com/backend-api/codex),
 * PAS de spawn CLI. Injection système via le champ NATIF `instructions` (les
 * messages role=system y sont ignorés) — divergence protocole vs Claude, mais
 * équivalence de CONTENU (même bloc SOUL).
 */
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

export type CodexStructuralFailureSignature =
  | 'json-trailing-characters'
  | 'missing-supports-reasoning-summaries'
  /**
   * Quota d'abonnement épuisé — la réinitialisation est annoncée des JOURS plus tard, donc relancer
   * est inutile par nature. Mesuré le 2026-08-04 : faute de cette signature, 310 appels de sous-agents
   * ont été lancés dans un quota mort (182 en phase kaizen, 128 en build) sur 410 échecs au total.
   */
  | 'usage-limit-reached'

/** Erreur non transitoire : la relancer sans changement de provider/configuration est inutile. */
export class CodexStructuralFailure extends Error {
  readonly structuralProviderFailure = true

  constructor(
    readonly provider: 'codex',
    readonly signature: CodexStructuralFailureSignature,
    readonly causeText: string
  ) {
    super(causeText)
    this.name = 'CodexStructuralFailure'
  }
}

/**
 * Distingue un quota ÉPUISÉ d'un rate-limit PASSAGER — les deux arrivent en HTTP 429, et les confondre
 * coûte dans les deux sens : ignorer le premier fait tirer des centaines d'appels dans le vide (mesuré),
 * bloquer sur le second transformerait une attente de 20 s en panne de provider pour tout le run.
 * Le discriminant est le VOCABULAIRE du refus, pas le code HTTP.
 */
function isUsageLimit(cause: string): boolean {
  if (/retry after|try again in|rate limit exceeded/i.test(cause)) return false
  return /usage[_ ]limit|purchase more credits|hit your usage/i.test(cause)
}

export function codexStructuralFailure(error: unknown): Error {
  if (error instanceof CodexStructuralFailure) return error
  const cause = error instanceof Error ? error.message : String(error)
  const signature = /trailing characters/i.test(cause)
    ? 'json-trailing-characters'
    : /supports_reasoning_summaries/i.test(cause)
      ? 'missing-supports-reasoning-summaries'
      : isUsageLimit(cause)
        ? 'usage-limit-reached'
        : undefined
  return signature ? new CodexStructuralFailure('codex', signature, cause) : new Error(cause)
}

/** Élément d'exécution brut remonté par Codex (sous-ensemble typé utile à la preuve). */
export interface CodexExecItem {
  type?: string
  status?: string
  command?: string
  exit_code?: number
  aggregated_output?: string
  changes?: unknown
}

/**
 * Le vocabulaire de classement vit dans `evidence-vocabulary.ts`, PARTAGÉ avec le provider Claude.
 *
 * Il était dupliqué ici, et les deux copies avaient divergé : la version locale ne contenait AUCUN
 * verbe git, donc `git -C "<depot>" stash push` — la commande EXACTE de l'incident fondateur du
 * 2026-08-04 — était classée `inspection` sous Codex et `mutation` sous Claude. La même tâche
 * passait le gate sous un provider et échouait sous l'autre. C'est cette duplication qui a permis
 * la dérive ; il n'en reste qu'une source.
 */
/**
 * Classe une opération Codex sans confondre une lecture avec une preuve. Une assertion PowerShell
 * est une vérification seulement si elle porte un oracle explicite : branche succès `exit 0` ET
 * branche d'échec non nulle (ou `throw`). C'est le format naturel des preuves sous Windows.
 */
export function codexExecutionEvidenceKind(item: CodexExecItem): ExecutionEvidence['kind'] {
  const command = item.command ?? ''
  if (item.type === 'file_change' || isShellMutation(command)) return 'mutation'
  if (item.type !== 'command_execution') return 'other'
  const powershellAssertion =
    /\bif\s*\(/i.test(command) &&
    /\bexit\s+0\b/i.test(command) &&
    /(?:\bexit\s+[1-9]\d*\b|\bthrow\b)/i.test(command)
  return isVerificationCommand(command) || powershellAssertion ? 'verification' : 'inspection'
}

/**
 * Extrait les champs STRUCTURÉS d'une preuve d'exécution (pour un rendu lisible inline dans le Chat :
 * diff pour un file_change, stdout/exit pour une commande). Bornés pour ne pas gonfler le payload.
 * Pur → testable isolément.
 */
export function structuredEvidenceFields(
  item: CodexExecItem,
  executionCwd?: string
): {
  command?: string
  exitCode?: number
  stdout?: string
  diff?: string
  path?: string
  paths?: string[]
  writtenLineFingerprints?: string[]
} {
  if (item.type === 'command_execution') {
    return {
      command: item.command,
      exitCode: item.exit_code,
      stdout: (item.aggregated_output ?? '').slice(-20_000)
    }
  }
  if (item.type === 'file_change') {
    const paths =
      item.changes && typeof item.changes === 'object'
        ? Object.keys(item.changes as Record<string, unknown>).map((path) =>
            executionEvidencePath(path, executionCwd)
          )
        : []
    return {
      diff: (typeof item.changes === 'string'
        ? item.changes
        : JSON.stringify(item.changes ?? {}, null, 2)
      ).slice(0, 20_000),
      path: paths.join(', ') || undefined,
      paths: paths.length ? paths : undefined,
      ...(typeof item.changes === 'string'
        ? {
            writtenLineFingerprints: addedLineFingerprintsFromUnifiedDiff(item.changes)
          }
        : {})
    }
  }
  return {}
}

/**
 * Transforme un événement outil Codex en preuves, aussi bien pendant le stream qu'après un crash.
 * Garder cette projection unique évite qu'une reprise accepte le texte terminal mais perde les
 * mutations/vérifications qui ouvrent le gate.
 */
export function codexExecutionEvidenceFromItem(
  item: CodexExecItem,
  executionCwd?: string
): ExecutionEvidence[] {
  if (!item.type || item.type === 'agent_message' || item.type === 'reasoning') return []
  const command = item.command ?? ''
  const ok =
    item.type === 'file_change'
      ? item.status !== 'failed'
      : item.type === 'command_execution'
        ? item.exit_code === 0 && item.status !== 'failed'
        : item.status !== 'failed'
  const kind = codexExecutionEvidenceKind(item)
  const summary =
    item.type === 'command_execution'
      ? `${item.command ?? ''}\nexit=${item.exit_code ?? 'unknown'}\n${item.aggregated_output ?? ''}`
      : JSON.stringify(item.changes ?? item)
  const evidence: ExecutionEvidence[] = [
    {
      type: item.type,
      kind,
      status: item.status ?? 'completed',
      ok,
      summary: summary.slice(-4_000),
      ...structuredEvidenceFields(item, executionCwd)
    }
  ]
  const embeddedVerification =
    kind === 'mutation' &&
    /\b(ReadAllText|ReadAllBytes|Get-Content|Test-Path)\b[\s\S]*\b(if|throw|Compare-Object)\b/i.test(
      command
    )
  if (embeddedVerification) {
    evidence.push({
      type: item.type,
      kind: 'verification',
      status: item.status ?? 'completed',
      ok,
      summary: summary.slice(-4_000)
    })
  }
  return evidence
}

export interface CodexExecSpec {
  executable: string
  args: string[]
  cwd: string
}

/** Sous-chemin de l'entrypoint Node du paquet npm `@openai/codex`. */
export const CODEX_PACKAGE_ENTRY = join('node_modules', '@openai', 'codex', 'bin', 'codex.js')

/**
 * Sous Windows, le wrapper `codex.js` relance le binaire natif sans `windowsHide` : chaque fan-out
 * recrée alors un `conhost.exe` visible. On résout le même binaire que le wrapper afin de le lancer
 * directement avec les drapeaux du runner survivable.
 */
export function codexNativeBinaryFromEntrypoint(
  entrypoint: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  exists: (path: string) => boolean = existsSync
): string | undefined {
  if (platform !== 'win32') return undefined
  const target =
    arch === 'x64'
      ? { packageName: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc' }
      : arch === 'arm64'
        ? { packageName: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' }
        : undefined
  if (!target) return undefined

  const packageRoot = dirname(dirname(entrypoint))
  const nativeFrom = (vendorRoot: string): string =>
    join(vendorRoot, target.triple, 'bin', 'codex.exe')
  const conventional = nativeFrom(
    join(packageRoot, 'node_modules', ...target.packageName.split('/'), 'vendor')
  )
  if (exists(conventional)) return conventional

  try {
    const packageJson = createRequire(entrypoint).resolve(`${target.packageName}/package.json`)
    const resolved = nativeFrom(join(dirname(packageJson), 'vendor'))
    if (exists(resolved)) return resolved
  } catch {
    // Installation sans dépendance native résoluble : le wrapper produira son erreur habituelle.
  }

  const bundled = nativeFrom(join(packageRoot, 'vendor'))
  return exists(bundled) ? bundled : undefined
}

export function codexExecSpec(
  cwd: string,
  model: string,
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access',
  reasoningEffort?: string,
  appData = process.env.APPDATA,
  entrypointExists: (path: string) => boolean = existsSync,
  // Souveraineté contexte : Autowin plie LUI-MÊME le fichier projet (AGENTS.md…) dans le system.
  // On coupe donc l'auto-load AGENTS.md du CLI Codex (`project_doc_max_bytes=0`) → source UNIQUE,
  // pas de double-chargement. Switch explicite (défaut ON) ; le repasser à false rendrait la main au CLI.
  suppressProjectDoc = true
): CodexExecSpec {
  const commonArgs = [
    'exec',
    '--json',
    '--ephemeral',
    '--sandbox',
    sandbox,
    '--cd',
    cwd,
    '--model',
    model,
    ...(suppressProjectDoc ? ['-c', 'project_doc_max_bytes=0'] : []),
    ...(reasoningEffort ? ['-c', `model_reasoning_effort="${reasoningEffort}"`] : []),
    '-'
  ]
  const explicitBinary = process.env.CODEX_BIN
  if (explicitBinary) {
    return { executable: explicitBinary, cwd, args: commonArgs }
  }
  // Le prefixe npm n'est PAS toujours celui de %APPDATA% (npm prefix configure, pnpm, volta, install
  // machine) : chercher aussi dans le PATH. Un chemin en dur unique faisait echouer le fan-out scout
  // avec « Codex CLI introuvable » (observe le 2026-07-29) alors que le CLI etait bien installe.
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (appData) env.APPDATA = appData
  else delete env.APPDATA
  const entrypoint = findNpmGlobalFile(CODEX_PACKAGE_ENTRY, { env, exists: entrypointExists })
  if (!entrypoint) {
    throw new Error(
      `Codex CLI introuvable : ni sous le dossier npm de %APPDATA%, ni dans le PATH (${CODEX_PACKAGE_ENTRY}). Definis CODEX_BIN pour le designer explicitement.`
    )
  }
  const nativeBinary = codexNativeBinaryFromEntrypoint(
    entrypoint,
    process.platform,
    process.arch,
    entrypointExists
  )
  if (nativeBinary) return { executable: nativeBinary, cwd, args: commonArgs }
  return { executable: 'node', cwd, args: [entrypoint, ...commonArgs] }
}

async function runCodexExec(
  messages: Message[],
  opts: SendOptions,
  model: string
): Promise<SendResult> {
  opts.signal?.throwIfAborted()
  const execution = opts.execution
  if (!execution) throw new Error('Contrat d’exécution Codex absent')
  const spec = codexExecSpec(execution.cwd, model, execution.sandbox, opts.reasoningEffort)
  const mutationBefore =
    execution.causallyIsolated && execution.sandbox !== 'read-only'
      ? await captureWorkspaceMutationSnapshot(spec.cwd, execution.causalWatchPaths)
      : undefined
  opts.signal?.throwIfAborted()
  const prompt = [
    opts.system,
    ...messages.filter((message) => message.role !== 'system').map((m) => m.content)
  ]
    .filter(Boolean)
    .join('\n\n')
  opts.observePrompt?.({
    provider: 'codex',
    model,
    transport: `Codex CLI exec JSONL · ${execution.sandbox}`,
    system: opts.system,
    messages: messages.filter((message) => message.role !== 'system'),
    options: {
      argv: spec.args[0] === 'exec' ? spec.args : spec.args.slice(1),
      cwd: spec.cwd,
      sandbox: execution.sandbox
    },
    limitation:
      'Arguments exacts remis au CLI Codex ; ses instructions internes ne sont pas exposées.'
  })
  assertArgvWithinLimit('codex exec', spec.args) // le prompt part sur stdin ; garde anti-régression
  return await new Promise((resolvePromise, reject) => {
    const spawnToken = randomUUID()
    execution.onSpawnIntent?.(spawnToken, true)
    // Lancement par la couche COMMUNE : sortie vers un journal fichier, processus detache. Avant,
    // codex lancait en pipes non detaches — son travail mourait avec l'app, contrairement a claude.
    const run = spawnSurvivable({
      bin: spec.executable,
      args: spec.args,
      cwd: spec.cwd,
      runId: spawnToken,
      stdin: prompt,
      onJournalPrepared:
        (execution.onJournal ?? opts.onJournal)
          ? (journalPath) => (execution.onJournal ?? opts.onJournal)?.(spawnToken, journalPath)
          : undefined
    })
    const child = run.child
    const childPid = child.pid
    if (childPid) {
      if (execution.onSpawned) execution.onSpawned(spawnToken, childPid)
      else {
        execution.onProcess?.(childPid, true)
        execution.onSpawnIntent?.(spawnToken, false)
      }
    }
    let stderr = ''
    let lastStructuredError = ''
    let finalText = ''
    const reasoningFragments: string[] = []
    let sessionId: string | undefined
    let usage: SendResult['usage']
    const executionEvidence: ExecutionEvidence[] = []
    // Anti-blocage : watchdog inactivité + cap total → kill en escalade + REJET (idempotent) même si
    // l'event `close` ne tire jamais (zombie). Remplace l'ancien kill-total-30min sans filet de rejet.
    const watchdog = createStreamWatchdog({
      inactivityMs: SUBAGENT_INACTIVITY_MS,
      totalMs: SUBAGENT_TOTAL_MS,
      onTrip: (reason) => {
        killEscalate(child)
        reject(
          new Error(
            `codex exec figé (${reason === 'inactivity' ? 'aucune sortie' : 'durée max'}) — tué par le watchdog`
          )
        )
      }
    })
    execution.registerTermination?.((reason) => {
      killEscalate(child)
      reject(new Error(reason))
    })
    opts.signal?.addEventListener('abort', () => {
      killEscalate(child)
      reject(new Error('codex exec annulé'))
    })
    // La couche commune livre des lignes COMPLÈTES (elle garde en tampon une ligne partielle) :
    // le découpage manuel disparaît, le traitement par ligne reste identique.
    const handleLine = (line: string): void => {
      watchdog.beat() // activité → réarme l'inactivité
      {
        try {
          const event = JSON.parse(line) as Record<string, unknown>
          const eventStatus = typeof event.status === 'string' ? event.status : undefined
          if (/error|fail/i.test(String(event.type ?? '')) || eventStatus === 'failed') {
            lastStructuredError = JSON.stringify(event).slice(-4_000)
          }
          if (event.type === 'thread.started' && typeof event.thread_id === 'string')
            sessionId = event.thread_id
          if (event.type === 'item.completed') {
            const item = event.item as
              | {
                  type?: string
                  text?: string
                  status?: string
                  command?: string
                  aggregated_output?: string
                  exit_code?: number
                  changes?: unknown
                }
              | undefined
            if (item?.type === 'agent_message' && item.text) finalText = item.text
            else if (item?.type === 'reasoning') {
              // Raisonnement CONSERVÉ (plus jeté) : accumulé pour l'observation post-mortem.
              if (item.text) reasoningFragments.push(item.text)
            } else if (item?.type) {
              const itemEvidence = codexExecutionEvidenceFromItem(item, spec.cwd)
              executionEvidence.push(...itemEvidence)
              const ok = itemEvidence.every((entry) => entry.ok)
              if (!ok) lastStructuredError = JSON.stringify(event).slice(-4_000)
            }
          }
          if (event.type === 'turn.completed') {
            const measured = event.usage as
              | { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number }
              | undefined
            if (measured) {
              usage = {
                inputTokens: measured.input_tokens ?? 0,
                outputTokens: measured.output_tokens ?? 0,
                cacheReadTokens: measured.cached_input_tokens
              }
            }
          }
        } catch {
          // Ligne non JSON : le journal melange stdout et stderr, donc c'est ICI qu'arrive le
          // diagnostic fatal du CLI. On la conserve, sinon un echec deviendrait muet.
          stderr += `${line}\n`
        }
      }
    }
    let closed = false
    const tailSettled = run
      .tail(handleLine, { isComplete: () => closed, signal: opts.signal })
      .then(
        () => undefined,
        (error: unknown) => error
      )
    child.on('error', (error) => {
      watchdog.dispose()
      if (!childPid) execution.onSpawnIntent?.(spawnToken, false)
      reject(error)
    })
    child.on('close', async (code, signal) => {
      closed = true // le tail draine ce qui reste puis s'arrête
      const tailError = await tailSettled
      run.release()
      watchdog.dispose()
      if (childPid) execution.onProcess?.(childPid, false)
      if (tailError) {
        reject(codexStructuralFailure(tailError))
        return
      }
      if (code !== 0) {
        const diagnostic = lastStructuredError || stderr.trim().slice(-800) || 'diagnostic-absent'
        const termination = [
          `exit-code=${code ?? 'null'}`,
          `signal=${signal ?? 'none'}`,
          `last-event=${lastStructuredError || 'none'}`,
          `stderr=${stderr.trim().slice(-800) || 'none'}`,
          `diagnostic=${diagnostic}`
        ].join('\n')
        reject(codexStructuralFailure(new Error(`codex exec échec\n${termination}`)))
        return
      }
      if (!finalText.trim()) {
        reject(new Error('codex exec terminé sans message final'))
        return
      }
      if (mutationBefore) {
        await appendWorkspaceMutationEvidence(mutationBefore, spec.cwd, executionEvidence)
      }
      attestIsolatedVerificationEvidence(
        executionEvidence,
        execution.causallyIsolated === true,
        execution.learningOracles
      )
      const artifacts = artifactsFromExecutionEvidence(executionEvidence, {
        provider: 'codex',
        model,
        workspaceRoot: spec.cwd
      })
      resolvePromise({
        text: finalText,
        provider: 'codex',
        sessionId,
        systemInjected: Boolean(opts.system),
        usage,
        executionEvidence,
        thinking: joinThinking(reasoningFragments),
        artifacts: artifacts.length ? artifacts : undefined
      })
    })
    // La couche commune remet le prompt par pipe, ou par fichier éphémère avec le relais Windows.
  })
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/**
 * Efforts RÉELLEMENT acceptés par l'endpoint /responses codex — VÉRIFIÉ EN LIVE (2026-07-24) :
 * low/medium/high/xhigh/max → 200 ; minimal & ultra → 400 ; none → omettre `reasoning`.
 */
export const CODEX_VALID_EFFORTS: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])

/**
 * Clampe l'effort d'Autowin vers le set accepté par la Responses API codex (cf. CODEX_VALID_EFFORTS).
 * `minimal`→`low` et `ultra`→`max` (les deux seuls rejetés en 400 ; on prend le voisin valide le plus
 * proche pour préserver l'intention). `none`/absent → undefined (on omet `reasoning`).
 */
export function codexApiEffort(effort: string | undefined): string | undefined {
  if (!effort || effort === 'none') return undefined
  if (effort === 'minimal') return 'low'
  if (effort === 'ultra') return 'max'
  return CODEX_VALID_EFFORTS.has(effort) ? effort : 'high'
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
  readonly supportsExecution = true
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
    if (opts.execution) {
      const result = await runCodexExec(messages, opts, opts.model ?? this.model)
      yield { delta: result.text }
      return result
    }
    const system = opts.system
    const systemInjected = typeof system === 'string' && system.length > 0
    const token = await this.accessToken()

    // Responses API : `instructions` = système natif ; `input` = historique (role=system ignoré).
    const input = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: codexContent(m) }))

    // fix-ok: contrat live (auxiliary_client.py:748) — chatgpt.com/backend-api/codex
    // exige store:false + les headers originator/User-Agent/ChatGPT-Account-ID (sinon 400/403
    // Cloudflare). L'account-id est extrait du claim JWT chatgpt_account_id.
    // L'effort DOIT être clampé au set Responses (low|medium|high) : un effort maison (ultra/xhigh/max)
    // envoyé brut fait échouer la requête en HTTP 400.
    const apiEffort = codexApiEffort(opts.reasoningEffort)
    const body = {
      model: opts.model ?? this.model,
      instructions: systemInjected ? system : undefined,
      input,
      store: false,
      stream: true,
      reasoning: apiEffort ? { effort: apiEffort } : undefined
    }
    const serializedBody = JSON.stringify(body)
    opts.observePrompt?.({
      provider: this.id,
      model: body.model,
      transport: 'Codex Responses API fetch body',
      system: body.instructions,
      messages: [{ role: 'user', content: serializedBody }],
      options: { body },
      limitation:
        'Corps JSON exact remis a fetch. Les instructions internes du service Codex ne sont pas exposees.'
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
    if (!res.ok || !res.body) {
      // Surface le CORPS du 4xx (l'API y nomme la raison exacte) — sinon le status seul est aveugle.
      const detail = await res.text().catch(() => '')
      throw codexStructuralFailure(
        new Error(`codex responses HTTP ${res.status}${detail ? ` — ${detail.slice(0, 600)}` : ''}`)
      )
    }

    // Parse le flux SSE : events `response.output_text.delta` (delta) + `response.completed`.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let usage: SendResult['usage']
    const artifactCandidates: ProviderArtifactCandidate[] = []

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
            usage?: {
              input_tokens?: number
              output_tokens?: number
              input_tokens_details?: { cached_tokens?: number }
            }
          }
          item?: {
            type?: string
            result?: string
            id?: string
            content?: Array<{
              type?: string
              image_url?: string
              file_data?: string
              filename?: string
              mime_type?: string
            }>
          }
        }
        if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string')
          return ev.delta
        if (ev.type === 'response.completed') {
          const measured = ev.response?.usage
          if (
            measured &&
            (measured.input_tokens !== undefined || measured.output_tokens !== undefined)
          ) {
            usage = {
              inputTokens: measured.input_tokens ?? 0,
              outputTokens: measured.output_tokens ?? 0,
              cacheReadTokens: measured.input_tokens_details?.cached_tokens
            }
          }
        }
        if (ev.type === 'response.output_item.done' && ev.item) {
          if (ev.item.type === 'image_generation_call' && typeof ev.item.result === 'string') {
            artifactCandidates.push({
              id: ev.item.id,
              name: `${ev.item.id ?? 'image'}-generated.png`,
              mimeType: 'image/png',
              encoding: 'base64',
              content: ev.item.result
            })
          }
          for (const part of ev.item.content ?? []) {
            if (part.type === 'output_image' && part.image_url?.startsWith('data:')) {
              const match = /^data:([^;,]+);base64,(.+)$/s.exec(part.image_url)
              if (match)
                artifactCandidates.push({
                  name: 'image-generated',
                  mimeType: match[1],
                  encoding: 'base64',
                  content: match[2]
                })
            } else if (part.type === 'output_file' && part.file_data?.startsWith('data:')) {
              const match = /^data:([^;,]+);base64,(.+)$/s.exec(part.file_data)
              if (match)
                artifactCandidates.push({
                  name: part.filename ?? 'fichier-généré',
                  mimeType: part.mime_type ?? match[1],
                  encoding: 'base64',
                  content: match[2]
                })
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

    const artifacts = normalizeProviderArtifacts(artifactCandidates, {
      provider: this.id,
      model: opts.model ?? this.model
    })
    return {
      text,
      provider: this.id,
      systemInjected,
      usage,
      artifacts: artifacts.length ? artifacts : undefined
    }
  }
}
import { randomUUID } from 'node:crypto'
