import { joinThinking } from './thinking'
import {
  assertArgvWithinLimit,
  createStreamWatchdog,
  killEscalate,
  resolveProviderTimeoutMs,
  SUBAGENT_INACTIVITY_MS,
  SUBAGENT_TOTAL_MS
} from './watchdog'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import {
  openStdoutJournal,
  survivableExitCode,
  tailJsonLines,
  type StdoutJournalHandle
} from '../runs/stdout-journal'
import { backgroundSurvivalInvocation } from '../runs/survivable-spawn'
import { AUTOWIN_WORKSPACE_ENV } from '../../shared/app-identity'
import { findNpmGlobalFile } from './npm-global-resolve'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executionEvidencePath } from './execution-evidence-path'
import { attacherEvidenceALErreur } from './evidence-portee-par-erreur'
import { isShellMutation, isVerificationCommand } from './evidence-vocabulary'
import {
  appendWorkspaceMutationEvidence,
  captureWorkspaceMutationSnapshot
} from './workspace-mutation-evidence'
import { attestIsolatedVerificationEvidence } from './causal-verification-evidence'
import {
  ProviderCallError,
  type Attachment,
  type ExecutionEvidence,
  type Message,
  type PromptEnvelope,
  type ProviderAdapter,
  type SendOptions,
  type SendResult,
  type StreamChunk,
  type Usage
} from './types'
import type { ProviderArtifactCandidate } from '../../shared/artifacts'
import { addedLineFingerprints, exactLineFingerprint } from '../exact-line-fingerprint'
import { artifactsFromExecutionEvidence, normalizeProviderArtifacts } from './artifacts'
import { withClaudeAccountEnv } from '../claude-accounts'
import { abortFailure } from './abort-diagnostic'

/**
 * Ramène l'usage Claude à l'invariant de `Usage` : `inputTokens` = input TOTAL, cache INCLUS.
 *
 * Anthropic rend `input_tokens` = tokens NON cachés seuls, et `cache_read_input_tokens` à part — deux
 * quantités DISJOINTES (mesuré le 2026-08-04 : 486 tours réels avec `cacheRead > input`, dont input=6
 * pour cache=13 486). OpenAI fait l'inverse, son `input_tokens` inclut déjà le cache. Sans
 * normalisation ici, le même champ voulait dire deux choses selon le provider, et
 * `execution-supervisor` — qui borne le cache à l'input puis totalise `input + output` — comptait ce
 * tour de 13 492 tokens comme un tour de 6.
 *
 * Normaliser à la SOURCE plutôt que chez le consommateur : l'adaptateur est le seul endroit qui
 * connaisse la convention de son propre provider.
 */
export function normalizeClaudeUsage(
  raw: unknown,
  costUsd?: unknown,
  hasReportedCost = costUsd !== undefined
): Usage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const usage = raw as Record<string, unknown>
  const tokenCount = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
  const nonCache = tokenCount(usage.input_tokens)
  const output = tokenCount(usage.output_tokens)
  const cache = tokenCount(usage.cache_read_input_tokens)
  const hasCacheCreation = Object.prototype.hasOwnProperty.call(
    usage,
    'cache_creation_input_tokens'
  )
  const cacheCreation = hasCacheCreation ? tokenCount(usage.cache_creation_input_tokens) : 0
  if (
    nonCache === undefined ||
    output === undefined ||
    cache === undefined ||
    cacheCreation === undefined
  ) {
    return undefined
  }
  const inputTokens = nonCache + cache + cacheCreation
  if (!Number.isSafeInteger(inputTokens)) return undefined
  // `cacheCreation` etait calcule puis PERDU dans le total : le consommateur ne pouvait donc pas le
  // tarifer a 1,25x. On le transporte a cote, comme la lecture de cache.
  const cacheCreationTokens = cacheCreation
  const normalizedCost =
    typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : undefined
  if (hasReportedCost && normalizedCost === undefined) return undefined
  return {
    inputTokens,
    outputTokens: output,
    cacheReadTokens: cache,
    cacheCreationTokens,
    ...(normalizedCost === undefined ? {} : { costUsd: normalizedCost })
  }
}

/**
 * Mappe un outil Claude (tool_use) vers le type de preuve d'exécution commun (mutation / vérification
 * / inspection), miroir de codex. Contrat provider-agnostique : tout exécuteur émet ce même shape.
 */
/**
 * HISTORIQUE — le shell LECTURE SEULE d'un tour de chat (RETIRÉ le 2026-08-26).
 *
 * Il a existé une constante `CHAT_READ_ONLY_SHELL` : cinq périmètres `Bash(git …:*)` qui étaient le
 * SEUL shell d'un tour de chat, sans Write ni Edit. Elle est supprimée, pas oubliée, sur décision
 * explicite de l'utilisateur (2026-08-26, conv-1410) : « Tout ouvrir : Bash + Write + Edit ».
 * Motivation mesurée : une édition d'une ligne exigeait une orchestration, qui répond depuis un
 * worktree ISOLÉ — donc à côté du dépôt que l'utilisateur regarde.
 *
 * Ce que ce paragraphe conserve, parce que c'est une CONNAISSANCE et non une politique :
 *  - un périmètre par préfixe ne borne QUE le verbe, jamais ses options : `git diff --output=x` et
 *    `git show --output=x` ÉCRIVENT (vérifié : un fichier de 9 octets ramené à 0) ;
 *  - la façon dont le CLI traite une commande CHAÎNÉE face à un périmètre par préfixe n'a jamais été
 *    établie ; la sonde rejouable est `scripts/probe-chat-shell-permissions.mjs` ;
 *  - `NON_INTERACTIVE_ENV` (ci-dessous) reste en vigueur et agit sur le PROCESSUS FILS, donc
 *    indépendamment de l'interprétation du CLI.
 *
 * La frontière de sécurité qui demeure fermée est celle du fond autonome (`watchdog-read-only`) :
 * son contexte d'événement n'est pas fiable et aucun humain ne le déclenche.
 */

/**
 * RETIRÉS après audit de sécurité, chacun pour une raison PROUVÉE — ne pas les remettre sans
 * réfuter la preuve correspondante.
 *
 * `git diff` / `git show` / `git log` : ces sous-commandes acceptent `--output=<chemin>`, qui ÉCRIT
 * un fichier arbitraire tout en respectant le préfixe autorisé. Vérifié sur ce dépôt :
 * `git diff --output=victim.txt HEAD HEAD` a ramené un fichier de 9 octets à **0 octet**, et
 * `git show --output=…` a créé un fichier de 9 663 octets. Le périmètre PORTAIT donc une primitive
 * de destruction : ma revendication « aucune de ces formes ne peut muter » était fausse, faute
 * d'avoir testé une seule option.
 *
 * `git ls-remote` : contacte une URL ARBITRAIRE, donc canal de sortie réseau depuis un tour qui lit
 * par ailleurs le dépôt — et déclenche l'helper d'identifiants. L'ouverture réseau est une classe de
 * risque distincte de la mutation, que la justification d'origine n'avait jamais évaluée.
 *
 * LEÇON DE MÉTHODE : un périmètre par préfixe ne borne QUE le verbe, jamais ses options. Toute
 * entrée ajoutée ici doit être justifiée option par option, pas par le verbe.
 */
/**
 * Environnement imposé au processus fils pour qu'aucune commande git n'ouvre quoi que ce soit.
 *
 * `git status --help` respecte le périmètre autorisé (il commence bien par `git status`) et
 * pourtant il n'AFFICHE pas : il LANCE un visualiseur — navigateur ou man — depuis un tour censé
 * être sans effet de bord. De même, une commande git peut ouvrir une invite d'identifiants
 * graphique et rester bloquée sans que personne ne la voie.
 *
 * Ces variables agissent sur le PROCESSUS FILS, donc elles tiennent quelle que soit la façon dont
 * le CLI interprète ses règles de permission — c'est ce qui les rend fiables ici, là où un
 * périmètre par préfixe ne borne que le verbe.
 */
export const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  // Jamais d'invite d'identifiants ni de fenêtre d'authentification.
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
  // MESURE 2026-09-01 (conv-35) : ces trois variables ne suffisent PAS sous Windows. L'helper
  // `credential.helper=manager` (Git Credential Manager) est un PROCESSUS SEPARE qui ouvre sa
  // propre fenetre GUI : il ignore GIT_TERMINAL_PROMPT et GIT_ASKPASS. Un `git push` d'un run a
  // donc affiche TROIS fenetres de connexion GitHub et est reste bloque, invisible dans le fil.
  // `GCM_INTERACTIVE=never` + `credential.interactive=false` forcent un ECHEC LISIBLE au lieu de
  // l'attente muette.
  GCM_INTERACTIVE: 'never',
  // `--help` retombe sur le format `man`, absent sous Windows : la commande échoue proprement
  // au lieu d'ouvrir un navigateur.
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'help.format',
  GIT_CONFIG_VALUE_0: 'man',
  GIT_CONFIG_KEY_1: 'credential.interactive',
  GIT_CONFIG_VALUE_1: 'false'
}

export function claudeToolEvidenceKind(name: string, command: string): ExecutionEvidence['kind'] {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/i.test(name)) return 'mutation'
  if (/^Bash$/i.test(name)) {
    // Ordre voulu : un test reste une vérification même s'il touche le disque au passage ; une
    // commande qui change l'état du dépôt est une MUTATION (avant, elle retombait en `inspection`,
    // et le gate devenait insatisfiable pour toute tâche mutant par commande) ; le reste est une
    // lecture. Vocabulaire partagé avec Codex — voir evidence-vocabulary.ts.
    if (isVerificationCommand(command)) return 'verification'
    if (isShellMutation(command)) return 'mutation'
    return 'inspection'
  }
  return 'inspection'
}

export function claudeEvidencePath(filePath: string, cwd: string): string {
  return executionEvidencePath(filePath, cwd)
}

/**
 * Extrait le TEXTE d'un `tool_result` Claude, dont le `content` est soit une string, soit un
 * tableau de blocs `{ type: 'text', text }`. Pur → testable. Vide si rien d'exploitable.
 */
export function claudeToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : ''
      )
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** Lignes dont l'outil d'édition revendique directement l'écriture ; jamais le stdout d'un shell. */
export function claudeWrittenLineFingerprints(
  input: Record<string, unknown> | undefined
): string[] {
  if (!input) return []
  const fingerprints: string[] = []
  const wholeContent = (value: unknown): void => {
    if (typeof value !== 'string') return
    fingerprints.push(...value.split(/\r?\n/).filter(Boolean).map(exactLineFingerprint))
  }
  wholeContent(input.content)
  if (typeof input.new_string === 'string') {
    fingerprints.push(
      ...addedLineFingerprints(
        typeof input.old_string === 'string' ? input.old_string : '',
        input.new_string
      )
    )
  }
  if (typeof input.new_source === 'string') {
    fingerprints.push(
      ...addedLineFingerprints(
        typeof input.old_source === 'string' ? input.old_source : '',
        input.new_source
      )
    )
  }
  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (
        edit &&
        typeof edit === 'object' &&
        typeof (edit as { new_string?: unknown }).new_string === 'string'
      ) {
        const change = edit as { old_string?: unknown; new_string: string }
        fingerprints.push(
          ...addedLineFingerprints(
            typeof change.old_string === 'string' ? change.old_string : '',
            change.new_string
          )
        )
      }
    }
  }
  return fingerprints
}

/**
 * Un bloc image/document sans nom n'est PAS forcément « généré » : quand il arrive
 * d'un résultat d'outil (capture d'écran, lecture de fichier, analyse), le nommer
 * « généré » est un mensonge d'affichage. On dérive donc le libellé de l'outil réel,
 * et « généré » ne reste que pour une sortie directe du modèle (aucun outil).
 */
export function untitledArtifactName(blockType?: string, tool?: string): string {
  const isImage = blockType === 'image'
  const base = isImage ? 'image' : 'document'
  if (!tool) return isImage ? 'image-générée' : 'document-généré'
  if (/observe|capture|screenshot/i.test(tool)) return 'capture-écran'
  return base + '-' + tool
}

/** Images/documents structurés éventuellement remontés par Claude ou un résultat d'outil. */
export function claudeContentArtifacts(
  content: unknown,
  tool?: string
): ProviderArtifactCandidate[] {
  if (!Array.isArray(content)) return []
  const artifacts: ProviderArtifactCandidate[] = []
  for (const entry of content) {
    if (!entry || typeof entry !== 'object') continue
    const block = entry as {
      type?: string
      name?: string
      filename?: string
      source?: { type?: string; media_type?: string; data?: string }
      file?: { name?: string; media_type?: string; data?: string }
    }
    if (
      (block.type === 'image' || block.type === 'document' || block.type === 'file') &&
      block.source?.type === 'base64' &&
      typeof block.source.data === 'string'
    ) {
      artifacts.push({
        name: block.name ?? block.filename ?? untitledArtifactName(block.type, tool),
        mimeType:
          block.source.media_type ??
          (block.type === 'image' ? 'image/png' : 'application/octet-stream'),
        encoding: 'base64',
        content: block.source.data,
        tool
      })
    } else if (block.file && typeof block.file.data === 'string') {
      artifacts.push({
        name: block.file.name ?? untitledArtifactName('file', tool),
        mimeType: block.file.media_type ?? 'application/octet-stream',
        encoding: 'base64',
        content: block.file.data,
        tool
      })
    }
  }
  return artifacts
}

export interface MaterializedAttachments {
  dir: string
  paths: string[]
  promptSuffix: string
  cleanup: () => void
}

/**
 * Extension a garantir sur le fichier ecrit, deduite du TYPE reel.
 *
 * Un fichier dont le nom ne finit pas par une extension reconnue est lu en OCTETS par l'outil Read,
 * pas en image. Mesure du 2026-08-27 : une piece jointe nommee « capture.png (miniature) » — le
 * libelle ajoute APRES l'extension — revenait au modele en JPEG brut, et il repondait, a juste
 * titre, qu'aucune image ne lui etait parvenue. Le libelle appartient au PROMPT, jamais au nom de
 * fichier ; le nom de fichier appartient au type.
 */
export function extensionPourType(mimeType: string, nom: string): string {
  const parType: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'application/pdf': '.pdf'
  }
  const attendue = parType[(mimeType ?? '').toLowerCase()]
  if (attendue) return attendue
  const dernier = /[.]([A-Za-z0-9]{1,6})$/.exec(nom)
  return dernier ? '.' + dernier[1].toLowerCase() : ''
}

/** Nom de fichier PROPRE : sans libelle entre parentheses, avec l'extension du type reel. */
export function nomDeFichierPourPieceJointe(nom: string, mimeType: string): string {
  const ext = extensionPourType(mimeType, nom)
  const sansLibelles = nom.replace(/[ ]*[(][^)]*[)]/g, '').trim()
  // On retire l'extension EXISTANTE, quelle qu'elle soit : une miniature jpeg portant un nom en
  // .png donnerait sinon « x.png.jpg » — lisible, mais qui affiche encore le type faux au modele.
  const base = ext ? sansLibelles.replace(/[.][A-Za-z0-9]{1,6}$/, '') : sansLibelles
  const propre = base.replace(/[ .]+$/, '')
  return (propre || 'fichier') + ext
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
    const path = join(
      dir,
      `${index + 1}-${nomDeFichierPourPieceJointe(safeName, attachment.mimeType ?? '')}`
    )
    const data =
      attachment.kind === 'text' ? attachment.content : Buffer.from(attachment.content, 'base64')
    writeFileSync(path, data)
    return path
  })
  return {
    dir,
    paths,
    promptSuffix:
      '\n\nPIÈCES JOINTES FOURNIES PAR L’UTILISATEUR (celles marquées « message precedent » viennent d’un tour ANTÉRIEUR de cette conversation, pas du message ci-dessus) :\n' +
      paths.map((path, index) => `- ${path} — ${attachments[index]?.name ?? ''}`).join('\n') +
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
  const found = findClaudeExecutable()
  return found ?? 'claude'
}

/** Sous-chemin du binaire natif dans le paquet npm `@anthropic-ai/claude-code`. */
const CLAUDE_PACKAGE_BIN = join('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')

export interface ClaudeBinLookupDeps {
  platform?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

/**
 * Cherche le binaire NATIF `claude.exe` : préfixe npm par défaut d'abord, puis chaque dossier du PATH
 * — soit un `claude.exe` posé là, soit le paquet npm installé sous ce préfixe (`findNpmGlobalFile`).
 *
 * Pourquoi : REPRODUIT le 2026-07-29, le PATH n'expose QUE des shims (`claude.cmd`, `claude.ps1`,
 * `claude` sans extension). Le repli `spawn('claude', …, { shell: false })` échoue en
 * `spawn claude ENOENT` — CreateProcess n'ajoute que `.exe`, il n'exécute pas un `.cmd`. Un poste dont
 * le préfixe npm n'est pas exactement le dossier npm de `%APPDATA%` tombait dans ce repli mort.
 * `shell: true`
 * est EXCLU : `shell: false` est ce qui garantit l'absence d'injection d'arguments et un
 * `--system-prompt` à espaces/accents intact.
 *
 * Rend `undefined` si rien n'est trouvé — l'appelant garde son repli `'claude'`, correct sur un poste
 * où un vrai `claude.exe` est dans le PATH (Unix, ou install non-npm).
 *
 * SÉCURITÉ : ce chemin est spawné avec le prompt système ET le contenu de la conversation. Le PATH
 * étant hérité (un CLI enfant ou un script peut l'avoir modifié), `npm-global-resolve` refuse les
 * entrées non absolues, les racines de volume, le cwd et `%TEMP%`, et n'élit un `claude.exe` posé à
 * plat que dans un dossier portant un `node_modules/` (signature d'un vrai préfixe `npm -g`). Sans
 * cela, un tiers écrivant dans un dossier du PATH — ou un dépôt cloné, via une entrée `.` — se
 * ferait livrer tous les prompts.
 */
export function findClaudeExecutable(deps: ClaudeBinLookupDeps = {}): string | undefined {
  const platform = deps.platform ?? process.platform
  if (platform !== 'win32') return undefined
  return findNpmGlobalFile(CLAUDE_PACKAGE_BIN, {
    ...(deps.env ? { env: deps.env } : {}),
    ...(deps.exists ? { exists: deps.exists } : {}),
    directNames: ['claude.exe']
  })
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

/** Les seules valeurs de `--effort` que le CLI Claude accepte (mesure du 2026-09-01 sur 2.1.251). */
const EFFORTS_CLI_CLAUDE = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Ajoute au spawn les choix Agents réellement supportés par le CLI installé. */
export function appendClaudeSelectionArgs(args: string[], opts: SendOptions): void {
  if (opts.model) args.push('--model', opts.model)
  if (Number.isFinite(opts.maxBudgetUsd) && (opts.maxBudgetUsd as number) > 0) {
    args.push('--max-budget-usd', String(opts.maxBudgetUsd))
  }
  // Le CLI n'accepte QUE ces cinq valeurs ; toute autre (`auto`, `none`) est rejetee avec un
  // « Warning: Unknown --effort value » sur la sortie, puis silencieusement remplacee par le defaut.
  // On ne l'envoie donc que si elle est reellement supportee — sinon on laisse le CLI decider.
  if (opts.reasoningEffort && EFFORTS_CLI_CLAUDE.has(opts.reasoningEffort)) {
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

/**
 * Les arguments MCP d'un appel — la SEULE decision de ce fichier sur les outils d'un noeud skill.
 *
 * Extraite en fonction PURE parce que la garantie qu'elle porte est une ABSENCE : « une phase du
 * pipeline ne recoit aucun serveur MCP ». Une absence ne se prouve pas en lisant la sortie d'un run,
 * et `describePrompt` ne rend pas l'argv. Sans ce point d'extraction, le test aurait du RECOPIER la
 * construction des arguments — il aurait alors verifie son propre miroir, pas le code qui tourne.
 *
 * `send` l'appelle et ne decide rien d'autre : c'est ce qui fait du test une preuve sur le chemin de
 * production plutot que sur une reconstitution.
 */
export function argumentsMcpNoeudSkill(opts: SendOptions): {
  /** `--strict-mcp-config`, ou rien s'il est retire pour cet appel. */
  strict: string[]
  /** `--mcp-config <config>`, ou rien. */
  mcp: string[]
  /** Les noms a FUSIONNER dans l'unique `--allowedTools` de la branche. */
  autorises: string[]
} {
  const noeud = opts.skillNodeTools
  // `--strict-mcp-config` est pose PARTOUT sauf pour un noeud skill dont l'heritage est demande.
  // C'est lui qui prive les huit phases du pipeline de tout serveur externe (verifie hors-modele :
  // sans `--mcp-config`, le CLI rend « outil absent »).
  const strict = noeud?.inheritMachineMcp === true ? [] : ['--strict-mcp-config']
  if (!noeud) return { strict, mcp: [], autorises: [] }
  return { strict, mcp: ['--mcp-config', noeud.mcpConfig], autorises: [...noeud.allowedTools] }
}

/**
 * Ecrit la configuration MCP dans un FICHIER temporaire et rend son chemin.
 *
 * POURQUOI PAS DIRECTEMENT DANS L'ARGV. La configuration porte le jeton du serveur d'outils. Sous
 * Windows, la ligne de commande d'un process est lisible par tout process de la MEME session sans
 * elevation (`Get-CimInstance Win32_Process | Select CommandLine`) : le jeton etait donc offert a
 * n'importe quel logiciel deja present sur le poste pendant toute la duree de l'appel. Et l'argv est
 * lui-meme trace, donc le secret atterrissait aussi dans un fichier durable.
 *
 * `--mcp-config` accepte « JSON files or strings » (aide du CLI) : le fichier est donc la MEME
 * capacite, sans le canal de fuite. C'est aussi le motif que ce fichier applique deja pour les
 * settings et le prompt systeme — un secret transite par le disque borne, jamais par argv.
 *
 * Rend `undefined` si l'ecriture echoue : l'appelant retombe alors sur la chaine inline (capacite
 * preservee, fuite signalee) plutot que de perdre l'outillage du noeud.
 */
export function ecrireConfigMcp(
  config: string
): { chemin: string; nettoyer: () => void } | undefined {
  try {
    const dossier = mkdtempSync(join(tmpdir(), 'autowin-os-mcp-'))
    const chemin = join(dossier, 'mcp.json')
    writeFileSync(chemin, config, 'utf8')
    return { chemin, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) }
  } catch {
    return undefined
  }
}

/** Duree d'un battement d'outil, rendue lisible : « 45 s », « 2 min 30 s », « 3 min ». */
function dureeLisible(secondes: number): string {
  const total = Math.round(secondes)
  if (total < 60) return `${total} s`
  const minutes = Math.floor(total / 60)
  const reste = total % 60
  return reste ? `${minutes} min ${reste} s` : `${minutes} min`
}

export class ClaudeCliAdapter implements ProviderAdapter {
  readonly id = 'claude'
  // B — Claude EST un exécuteur outillé (Claude Code). Quand `opts.execution` est fourni, on lance
  // le CLI avec les outils activés + un mode permission autonome, et on remonte l'executionEvidence.
  readonly supportsExecution = true
  /** Vrai : `send` pousse `--resume <id>` au CLI (voir plus bas). Le seul adaptateur dans ce cas. */
  readonly honoursSessionResume = true
  private readonly bin: string
  private readonly timeoutMs: number

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.bin = resolveClaudeBin(opts.bin)
    this.timeoutMs = opts.timeoutMs ?? SUBAGENT_TOTAL_MS
  }

  /** L'auth vit dans le CLI (abonnement déjà loggé) — on vérifie qu'il répond. */
  async auth(): Promise<boolean> {
    return await new Promise((resolve) => {
      const p = spawn(this.bin, ['--version'], { shell: false, windowsHide: true })
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
      systemBlocks: opts.systemBlocks,
      contextBlocks: opts.contextBlocks,
      messages: lastUser ? [lastUser] : [],
      options: {
        toolsDisabled: true,
        /**
         * LU depuis les options, plus annonce en dur.
         *
         * Ce champ valait `true` inconditionnellement — vrai tant que le drapeau etait pose sur tous
         * les appels. Il ne l'est plus : un noeud skill en heritage part SANS `--strict-mcp-config`.
         * Laisse en dur, ce champ aurait affirme le contraire de ce qui est envoye, et c'est la
         * regle que ce fichier s'impose ailleurs : une observabilite qui MENT sur ce qui a ete
         * envoye est pire qu'une absente.
         */
        strictMcpConfig: opts.skillNodeTools?.inheritMachineMcp !== true,
        /** Les outils du noeud skill, s'il y en a — sinon le champ est absent, pas `false`. */
        ...(opts.skillNodeTools
          ? {
              skillNodeTools: opts.skillNodeTools.allowedTools,
              /**
               * Le JETON NE SORT PAS D'ICI. La version precedente copiait `mcpConfig` entier dans
               * l'enveloppe — or `index.ts` persiste ces options dans la trace causale sur disque,
               * donc le jeton du serveur se retrouvait EN CLAIR dans un artefact durable (verifie
               * dans `conv-1346`). On annonce que le canal MCP est actif, jamais son secret : le
               * champ utile a l'observabilite est « y a-t-il des outils, lesquels », pas la creance.
               */
              mcpActif: true,
              inheritMachineMcp: opts.skillNodeTools.inheritMachineMcp === true
            }
          : {}),
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
    opts.signal?.throwIfAborted()
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const materialized = lastUserMessage?.attachments?.length
      ? materializeClaudeAttachments(lastUserMessage.attachments)
      : undefined
    const lastUser = `${lastUserMessage?.content ?? ''}${materialized?.promptSuffix ?? ''}`
    const system = opts.system
    const systemInjected = typeof system === 'string' && system.length > 0

    const execution = opts.execution
    let mutationBefore: Awaited<ReturnType<typeof captureWorkspaceMutationSnapshot>> | undefined
    try {
      mutationBefore =
        execution?.causallyIsolated && execution.sandbox !== 'read-only'
          ? await captureWorkspaceMutationSnapshot(execution.cwd, execution.causalWatchPaths)
          : undefined
      opts.signal?.throwIfAborted()
    } catch (error) {
      // Une annulation peut arriver pendant la capture asynchrone du workspace, avant que le
      // process CLI (et donc son handler `close`) n'existe. Nettoyer ici les pièces jointes déjà
      // matérialisées évite de laisser un dossier temporaire à chaque tentative interrompue.
      materialized?.cleanup()
      throw error
    }
    // Autowin = SOURCE UNIQUE : on lance le CLI « nu ». `--setting-sources ""` → aucun CLAUDE.md
    // utilisateur/projet, ni skills, ni hooks CC, ni MCP hérités → zéro doublon avec les consignes
    // qu'Autowin injecte (--system-prompt). L'enforcement vit alors dans le HookBus interne d'Autowin.
    // Le PROMPT n'est PLUS passé en argv (`-p <prompt>`) : une longue conversation dépassait la limite
    // de ligne de commande Windows (~32 ko) → `spawn ENAMETOOLONG`, tout le run cassait. Claude Code lit
    // le prompt sur STDIN quand `-p` n'a pas de valeur positionnelle → on l'y écrit (cf. child.stdin plus bas).
    /**
     * OUTILS D'UN NŒUD SKILL — posés sur le canal NATIF du CLI, et sur AUCUN autre appel.
     *
     * L'intention est LUE, jamais déduite (`opts.skillNodeTools`) : les huit phases du pipeline
     * passent par ce même `send()` avec un bloc `execution`, et doivent rester privées de tout outil
     * externe. Déduire l'intention depuis `execution` les outillerait toutes par accident.
     *
     * `--strict-mcp-config` reste posé PARTOUT AILLEURS — c'est lui qui garantit qu'une phase de
     * pipeline ne voit aucun serveur MCP (vérifié hors-modèle : sans `--mcp-config`, le CLI rend
     * « outil absent »). Il n'est retiré que pour un nœud skill dont l'héritage est demandé, et
     * seulement pour cet appel.
     */
    const argsMcp = argumentsMcpNoeudSkill(opts)
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      // Sans ce drapeau, le CLI n'emet le raisonnement qu'en BLOCS COMPLETS, dans l'evenement
      // `assistant` : le bloc « Reflexion » restait donc vide pendant toute la reflexion puis se
      // remplissait d'un coup, apres coup. Avec `--include-partial-messages`, les `thinking_delta`
      // arrivent au fil de l'eau et le bloc s'ecrit EN TEMPS REEL (comme kimi).
      '--include-partial-messages',
      // Retiré UNIQUEMENT pour un nœud skill en héritage : voir `argumentsMcpNoeudSkill`.
      ...argsMcp.strict,
      '--setting-sources',
      '',
      // Les slash-commands et skills du CLI ne servent JAMAIS ici : Autowin pilote par prompt et
      // injecte lui-meme ses consignes de phase (blocs `skill:*` du system prompt). Mesure du
      // 2026-07-28 : le CLI en declarait 45 et 18 malgre `--setting-sources ''`, qui ne les couvre
      // pas. Elles etaient donc payees a chaque appel sans jamais etre utilisees.
      '--disable-slash-commands'
    ]
    let mcpConfigDir: { chemin: string; nettoyer: () => void } | undefined
    if (argsMcp.mcp.length > 0) {
      /**
       * `--mcp-config` déclare le serveur, `--allowedTools` autorise l'USAGE : les deux, sinon
       * l'outil est annoncé et refusé à l'appel (ou l'inverse) sans que rien ne le signale.
       *
       * Les noms MCP ne vont PAS dans `--tools` : ce drapeau restreint les outils du jeu INTÉGRÉ,
       * et y mêler un nom `mcp__…` n'a pas de sens. Mesuré : `--mcp-config` + `--allowedTools`
       * suffisent, l'outil est appelé pour de vrai (témoin non devinable rendu par le CLI).
       */
      /**
       * Le jeton passe par un FICHIER, pas par argv (cf. `ecrireConfigMcp`). Si l'ecriture echoue on
       * garde la chaine inline : l'outillage du noeud vaut mieux que sa perte, et le repli est ICI,
       * visible, plutot que silencieux.
       */
      mcpConfigDir = ecrireConfigMcp(argsMcp.mcp[1]!)
      args.push('--mcp-config', mcpConfigDir?.chemin ?? argsMcp.mcp[1]!)
    }
    /**
     * Les noms MCP sont FUSIONNES dans l'unique `--allowedTools` de la branche, jamais pousses dans
     * un SECOND drapeau : deux occurrences du meme drapeau laissent le CLI arbitrer lequel gagne, et
     * si c'est la derniere, les outils MCP seraient DECLARES par `--mcp-config` puis refuses a
     * l'usage — precisement le defaut « annonce et inutilisable » que ce chantier corrige.
     */
    const outilsMcpAutorises = argsMcp.autorises
    /**
     * LE WEB EST UNE CAPACITÉ DE BASE, sur TOUS les chemins d'agent.
     *
     * Décision explicite de l'utilisateur (2026-08-13) : « je veux que les agents soient florissants,
     * expansifs, grandissants, libres ». Avant, aucune branche ne chargeait d'outil web — donc aucun
     * agent d'Autowin ne pouvait lire une page, même en le demandant. Un agent qui ne peut pas aller
     * voir un changelog, une documentation ou une note de version doit deviner : il inventait au lieu
     * de lire, ce qui est exactement le défaut que l'on cherche à supprimer.
     *
     * Ce n'est PAS un oubli à refermer. Si un futur lecteur veut retirer ces deux outils, la question à
     * poser est « qu'est-ce que l'utilisateur a demandé », et la réponse est : de les ouvrir.
     *
     * Ce que cela n'ouvre pas : ni écriture, ni shell. Le web ajoute la LECTURE du monde extérieur, il
     * ne change aucun autre périmètre.
     */
    const OUTILS_WEB = 'WebFetch,WebSearch'
    /**
     * `--allowedTools` veut des arguments SÉPARÉS, pas une chaîne à virgules.
     *
     * MESURÉ en A/B sur le CLI réel : avec `--allowedTools WebFetch,WebSearch`, une demande de
     * récupération de page PEND jusqu'au délai maximum (code 124) ; avec `--allowedTools WebFetch
     * WebSearch`, elle rend la bonne réponse en quelques secondes. `--tools`, lui, attend bien la
     * forme à virgules — c'est sa forme documentée.
     *
     * Sans cette distinction, le web serait DÉCLARÉ et inutilisable sur les chemins qui passaient la
     * même chaîne aux deux drapeaux : annoncé dans les arguments, jamais autorisé à l'usage.
     */
    const autorises = (liste: string): string[] => liste.split(',')
    // Cwd du spawn : celui de l'execution, ou le workspace en lecture seule pour un tour de chat.
    let readOnlyCwd: string | undefined
    if (execution) {
      // B — mode exécuteur : outils activés + permission autonome, dans le cwd borné. A (générique) :
      // read-only ⇒ pas d'écriture/Bash-mutation ; workspace-write/danger ⇒ édition + Bash.
      const write = execution.sandbox !== 'read-only'
      const tools =
        (write ? 'Read,Grep,Glob,Bash,Edit,Write,MultiEdit' : 'Read,Grep,Glob') + ',' + OUTILS_WEB
      // `--tools` EN PLUS de `--allowedTools` : mesure du 2026-07-28 sur les journaux reels — 34
      // outils etaient DECLARES alors que 3 seulement etaient autorises en read-only. La doc du CLI
      // les distingue : `--tools` = « the list of available tools from the built-in set » (restreint
      // ce qui est CHARGE, donc paye dans le contexte), `--allowedTools` = « tool names to allow »
      // (autorise l'usage). On passe la MEME liste aux deux : rien de fonctionnel ne change, seules
      // les definitions inutiles disparaissent du prompt.
      args.push(
        '--permission-mode',
        'bypassPermissions',
        '--add-dir',
        execution.cwd,
        '--tools',
        tools,
        '--allowedTools',
        ...autorises(tools),
        ...outilsMcpAutorises
      )
    } else if (materialized) {
      args.push(
        '--tools',
        'Read,' + OUTILS_WEB,
        '--allowedTools',
        ...autorises('Read,' + OUTILS_WEB),
        ...outilsMcpAutorises
      )
    } else {
      /**
       * TOUR DE CHAT : PLEINEMENT OUTILLE (lecture + shell + ecriture).
       *
       * DECISION UTILISATEUR du 2026-08-26 (conv-1410) : « Tout ouvrir : Bash + Write + Edit ».
       * L'historique ci-dessous explique d'ou l'on vient ; il ne decrit plus la politique en vigueur.
       * Mesure qui a motive l'ouverture : une correction d'une ligne dans `home-decor-scene.ts` a
       * exige une orchestration complete, qui repond depuis un worktree ISOLE — donc a cote du depot
       * que l'utilisateur regarde — et plusieurs tours ont ete depenses a expliquer un refus.
       *
       * La frontiere de securite qui RESTE fermee est celle du fond autonome
       * (`watchdog-read-only`, juste en dessous) : son contexte d'evenement n'est pas fiable, aucun
       * humain ne le declenche. Le tour de chat, lui, est une demande DIRECTE de l'utilisateur.
       *
       * HISTORIQUE — lecture seule du workspace, au lieu d'etre AVEUGLE.
       *
       * Avant, le chat partait avec `--disallowedTools '*'` : l'agent ne pouvait rien lire, donc
       * toute question factuelle (« que fait ce fichier ? ») exigeait une ORCHESTRATION complete.
       * Mesure du 2026-07-28 sur conv-75 : 38,68 $ pour un travail qu'une lecture de deux fichiers
       * aurait couvert. Le gate conversationnel livre le meme jour autorise la reponse directe —
       * encore faut-il que l'agent ait de quoi la fonder.
       *
       * STRICTEMENT lecture : ni Write/Edit, ni Bash (qui rouvrirait les effets de bord par `cat`,
       * `rm`, `git`…). `--tools` restreint ce qui est CHARGE, `--allowedTools` ce qui est AUTORISE :
       * les deux, sinon on paie 34 definitions pour 3 outils utiles.
       */
      const readOnlyWorkspace = process.env[AUTOWIN_WORKSPACE_ENV]
      if (readOnlyWorkspace && existsSync(readOnlyWorkspace)) {
        readOnlyCwd = readOnlyWorkspace
        if (opts.toolProfile === 'watchdog-read-only') {
          // Frontiere de securite du fond autonome : le contexte de l'evenement est non fiable.
          // Aucun Bash, meme prefixe, car le traitement des commandes chainees par Claude CLI n'est
          // pas etabli. Le prompt systeme n'est qu'une consigne ; cette liste est la capacite reelle.
          args.push(
            '--add-dir',
            readOnlyWorkspace,
            '--tools',
            'Read,Grep,Glob,' + OUTILS_WEB,
            '--allowedTools',
            'Read',
            'Grep',
            'Glob',
            'WebFetch',
            'WebSearch',
            ...outilsMcpAutorises
          )
        } else {
          args.push(
            // GREFFE du 2026-08-27 (copie isolée run-f2f7fec8c587-1, 0734729) : `bypassPermissions`
            // sur le TOUR DE CHAT, assumé explicitement par l'utilisateur. Sans lui, Bash/Write/Edit
            // étaient DÉCLARÉS mais retombaient sur une demande d'autorisation — donc échouaient en
            // mode non interactif. La frontière qui reste fermée est `watchdog-read-only` ci-dessus.
            '--permission-mode',
            'bypassPermissions',
            '--add-dir',
            readOnlyWorkspace,
            '--tools',
            'Read,Grep,Glob,Bash,Write,Edit,MultiEdit,' + OUTILS_WEB,
            '--allowedTools',
            'Read',
            'Grep',
            'Glob',
            'WebFetch',
            'WebSearch',
            // Bash, Write et Edit sont autorisés NUS depuis le 2026-08-26 : le périmètre par préfixe
            // ne bornait que le verbe, jamais ses options, et il forçait une orchestration pour la
            // moindre édition — orchestration qui répond depuis un worktree isolé, donc à côté.
            'Bash',
            'Write',
            'Edit',
            'MultiEdit',
            ...outilsMcpAutorises
          )
        }
      } else {
        // Aucun workspace resolu : plus rien a LIRE sur le disque, mais ce n'est pas une raison de
        // rendre l'agent totalement aveugle. Il garde le web, donc il peut encore fonder une reponse
        // au lieu de la deviner. Avant, `--disallowedTools '*'` le laissait sans aucun moyen.
        // La MEME valeur aux deux drapeaux, comme dans les autres branches : `--tools` charge,
        // `--allowedTools` autorise, et une asymetrie entre les deux laisse un outil declare mais
        // refuse (ou l'inverse) sans que rien ne le signale.
        args.push(
          '--tools',
          OUTILS_WEB,
          '--allowedTools',
          ...autorises(OUTILS_WEB),
          ...outilsMcpAutorises
        )
      }
    }
    /**
     * MEMOIRE AUTO du CLI — on la ramene au PROJET COURANT.
     *
     * Mesure du 2026-07-28 : `~/.claude/settings.json` de l'utilisateur porte
     * `autoMemoryDirectory: "~/.claude/projects/C--Code-RIG/memory"` (552 Ko de fiches), chargee a
     * CHAQUE appel — la memoire d'un AUTRE projet que celui sur lequel Autowin travaille. Cout
     * mesure sur un appel minimal : 10 272 tokens contre 1 072 sans, soit ~9 200 tokens par appel.
     *
     * `--setting-sources ''` ne la couvre pas (ce n'est pas une source de reglages au sens du flag).
     * On passe donc un settings PROPRE a Autowin ou `autoMemoryDirectory` est vide, ce qui ramene le
     * CLI au dossier de memoire du projet COURANT (verifie empiriquement : la valeur vide reinitialise
     * au defaut, elle ne desactive pas). Deux consequences voulues : plus aucune fiche hors-sujet, et
     * si l'utilisateur cree une memoire POUR ce projet, elle sera bien prise en compte.
     *
     * Le fichier vit dans un dossier temporaire nettoye a la fermeture du process : on ne modifie
     * JAMAIS le settings.json de l'utilisateur, qui reste son kit.
     */
    let settingsDir: string | undefined
    try {
      settingsDir = mkdtempSync(join(tmpdir(), 'autowin-os-settings-'))
      const settingsFile = join(settingsDir, 'settings.json')
      writeFileSync(settingsFile, JSON.stringify({ autoMemoryDirectory: '' }), 'utf8')
      args.push('--settings', settingsFile)
    } catch {
      settingsDir = undefined // impossible d'ecrire : on garde le comportement d'origine
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

    assertArgvWithinLimit('claude CLI', args) // anti-ENAMETOOLONG : le prompt passe par stdin
    const spawnToken = randomUUID()
    execution?.onSpawnIntent?.(spawnToken, true)
    /**
     * Survie niveau 2 (opt-in `AUTOWIN_DETACHED_RUNS=1` + racine de journaux fournie) : le CLI est
     * spawné DÉTACHÉ et sa sortie va dans un FICHIER au lieu d'un pipe → il continue de produire même
     * si l'app se ferme, et tout est relisible au redémarrage. Sans le flag : pipe, comportement
     * historique strictement inchangé (rétrocompat).
     */
    const journalRoot = process.env.AUTOWIN_RUN_JOURNAL_ROOT
    let journal: StdoutJournalHandle | undefined
    // ACTIVÉ PAR DÉFAUT dès que l'app fournit une racine de journaux (les tests, qui n'en fournissent
    // pas, restent sur le pipe). Survie prouvée en réel : parent tué → l'enfant détaché continue
    // d'écrire dans le journal. Porte de sortie : AUTOWIN_DETACHED_RUNS=0 → pipe historique.
    if (process.env.AUTOWIN_DETACHED_RUNS !== '0' && journalRoot) {
      try {
        journal = openStdoutJournal(journalRoot, spawnToken)
      } catch {
        journal = undefined // journal impossible → on retombe sur le pipe plutôt que d'échouer
      }
    }
    const onJournal = execution?.onJournal ?? opts.onJournal
    if (onJournal) {
      if (!journal) {
        throw new Error(
          'Journal survivable Claude indisponible — provider non lancé pour éviter un doublon'
        )
      }
      try {
        onJournal(spawnToken, journal.path)
      } catch (error) {
        try {
          closeSync(journal.fd)
        } catch {
          /* déjà fermé */
        }
        rmSync(journal.path, { force: true })
        throw error
      }
    }
    const invocation = journal
      ? backgroundSurvivalInvocation(this.bin, args, journalRoot!, journal.path, lastUser)
      : {
          bin: this.bin,
          args,
          relay: false,
          env: undefined,
          inputPath: undefined,
          completionPath: ''
        }
    const child = spawn(invocation.bin, invocation.args, {
      shell: false,
      windowsHide: true,
      cwd: execution?.cwd ?? readOnlyCwd,
      // Toujours un env EXPLICITE : sans lui le fils hérite du nôtre et peut ouvrir un pager, un
      // navigateur d'aide ou une invite d'identifiants. Voir NON_INTERACTIVE_ENV.
      // `withClaudeAccountEnv` POSE le CLAUDE_CONFIG_DIR du compte actif, ou le RETIRE pour le
      // compte par defaut : sans ce retrait, un dir herite du processus ferait tourner le run
      // sous une AUTRE identite. Place AVANT `invocation.env` : une invocation qui fixerait
      // explicitement une variable garde le dernier mot.
      env: {
        ...withClaudeAccountEnv(process.env),
        ...(invocation.env ?? {}),
        ...NON_INTERACTIVE_ENV
      },
      ...(journal
        ? {
            detached: true,
            stdio: invocation.relay
              ? ('ignore' as const)
              : (['pipe', journal.fd, journal.fd] as const)
          }
        : {})
    })
    // `unref` n'existe que sur un vrai ChildProcess (doubles de test / stubs peuvent l'omettre).
    if (journal && typeof child.unref === 'function') child.unref() // l'app peut mourir sans emporter le CLI
    const childPid = child.pid
    if (childPid) {
      if (execution?.onSpawned) execution.onSpawned(spawnToken, childPid)
      else {
        execution?.onProcess?.(childPid, true)
        execution?.onSpawnIntent?.(spawnToken, false)
      }
    }
    let buffer = ''
    let text = ''
    // Surcharge API : derniere tentative annoncee par le CLI + presence d'un event `result`. Les deux
    // servent a distinguer un tour REELLEMENT vide d'un tour mort sur retries epuises.
    let lastRetry: { attempt: number; maxRetries: number; status: string } | null = null
    let resultSeen = false
    const reasoningFragments: string[] = []
    // Vrai des qu'un `thinking_delta` partiel a ete recu : le bloc complet qui suit est alors un
    // DOUBLON du flux deja affiche, et ne doit etre ni re-pousse ni re-persiste.
    let partialThinkingSeen = false
    let resolvedModel: string | undefined
    let sessionId: string | undefined
    let usage: SendResult['usage']
    const executionEvidence: ExecutionEvidence[] = []
    const artifactCandidates: ProviderArtifactCandidate[] = []
    const inputImageFingerprints = new Set(
      (lastUserMessage?.attachments ?? [])
        .filter((attachment) => attachment.kind === 'image')
        .map((attachment) => base64Fingerprint(attachment.content))
    )
    const collectArtifacts = (content: unknown, tool?: string): void => {
      artifactCandidates.push(
        ...claudeContentArtifacts(content, tool).filter(
          (artifact) =>
            !artifact.mimeType?.startsWith('image/') ||
            artifact.encoding !== 'base64' ||
            artifact.content === undefined ||
            !inputImageFingerprints.has(base64Fingerprint(artifact.content))
        )
      )
    }
    const pendingTools = new Map<
      string,
      { name: string; command: string; filePath: string; writtenLineFingerprints: string[] }
    >()
    const queue: StreamChunk[] = []
    let done = false
    let childClosed = false
    let relayCompletionPoll: ReturnType<typeof setInterval> | undefined
    let errored: Error | null = null
    let resolveWait: (() => void) | null = null

    const wake = (): void => {
      resolveWait?.()
      resolveWait = null
    }

    // Anti-blocage : le pump ne dépend plus du seul event `close` (qui peut ne JAMAIS tirer sur un
    // zombie). Un watchdog inactivité + cap total FORCE le réglage du generator (done+errored+wake)
    // et tue le process en escalade SIGTERM→SIGKILL. L'abort utilisateur passe par le même chemin.
    const forceSettle = (err: Error): void => {
      if (!errored) errored = err
      if (relayCompletionPoll) clearInterval(relayCompletionPoll)
      done = true
      wake()
    }
    execution?.registerTermination?.((reason) => {
      killEscalate(child)
      forceSettle(new Error(reason))
    })
    const watchdog = createStreamWatchdog({
      inactivityMs: SUBAGENT_INACTIVITY_MS,
      totalMs: resolveProviderTimeoutMs(opts.execution?.providerTimeoutMs, this.timeoutMs),
      onTrip: (reason) => {
        killEscalate(child)
        forceSettle(
          new Error(
            `claude CLI figé (${reason === 'inactivity' ? 'aucune sortie' : 'durée max'}) — tué par le watchdog`
          )
        )
      }
    })
    opts.signal?.addEventListener('abort', () => {
      killEscalate(child)
      forceSettle(abortFailure('claude CLI', opts.signal))
    })

    /*
     * Le resume d'une commande de fond. Toutes commencent par `cd "$(pwd)" && `, qui n'apprend rien
     * et mange la place : ce prefixe-la saute. La commande, elle, est rendue ENTIERE — demande
     * explicite de l'utilisateur du 2026-09-01 : « met pas de nb max de caracteres par ligne, jveux
     * tout voir ». Une troncature cachait justement le verbe utile des commandes longues.
     */
    const resumerCommandeDeFond = (brut: string): string => {
      const sansCd = brut.replace(/^cd\s+"?\$\(pwd\)"?\s*&&\s*/i, '').trim()
      // Meme raison : une commande sur plusieurs lignes est rendue ENTIERE, pas reduite a sa
      // premiere ligne. L'affichage la replie (`white-space: pre-wrap`), il ne la coupe pas.
      return sansCd
    }

    const handleEvent = (o: Record<string, unknown>): void => {
      const t = o['type']
      if (t === 'system' && o['subtype'] === 'api_retry') {
        // Surcharge API (529) : le CLI retente en backoff exponentiel jusqu'a 10 fois, soit 2-3 min
        // pendant lesquelles il n'emet RIEN d'autre. Sans ce relais, l'UI reste sur un spinner muet
        // et l'utilisateur conclut a un agent fige (constate le 2026-08-05 dans run-stdout/).
        const attempt = Number(o['attempt'] ?? 0)
        const maxRetries = Number(o['max_retries'] ?? 0)
        const delayMs = Number(o['retry_delay_ms'] ?? 0)
        const status = o['error_status'] ? ` ${String(o['error_status'])}` : ''
        lastRetry = { attempt, maxRetries, status: String(o['error_status'] ?? o['error'] ?? '') }
        const note =
          `API${status} ${String(o['error'] ?? 'indisponible')} — nouvelle tentative ` +
          `${attempt}/${maxRetries}${delayMs ? ` dans ${(delayMs / 1000).toFixed(1)}s` : ''}`
        // Relayee en DIRECT seulement : une surcharge API n'est pas du raisonnement, et la persister
        // dans `thinking` faisait afficher « Raisonnement : API 529 overloaded » apres coup (mesure le
        // 2026-08-21 : sur 155 etapes reelles, l'UNIQUE champ non vide ne contenait que ce bruit).
        queue.push({ delta: '', status: note })
        return
      }
      if (t === 'tool_progress') {
        // Un outil long (suite de tests, build) n'emet RIEN pendant des minutes : le CLI comble ce
        // silence par un battement toutes les 30 s. Sans ce relais, la carte du fil restait sur
        // « 1 action en cours » et l'utilisateur concluait a un blocage (vecu le 2026-08-22 sur
        // run-f173a3f73600-1 : `npx vitest run`, 15 min, flux VIVANT mais invisible).
        // Relaye en DIRECT seulement, jamais persiste : un battement n'est pas du raisonnement.
        const elapsed = Number(o['elapsed_time_seconds'])
        if (!Number.isFinite(elapsed) || elapsed <= 0) return
        const outil = typeof o['tool_name'] === 'string' && o['tool_name'] ? o['tool_name'] : 'outil'
        queue.push({ delta: '', status: `${outil} en cours - ${dureeLisible(elapsed)}` })
        return
      }
      if (t === 'system' && (o['subtype'] === 'task_started' || o['subtype'] === 'task_notification')) {
        /*
         * UNE TACHE DE FOND EST MUETTE — meme defaut que le battement d'outil juste au-dessus, un cran
         * plus loin. Quand le sous-agent lance sa commande EN ARRIERE-PLAN, le CLI n'emet AUCUN
         * `tool_progress` : seulement `task_started`, puis `task_notification` a la toute fin.
         *
         * Mesure du 2026-08-22, run signale par l'utilisateur (« ca reste bloque visuellement sur cette
         * etape pendant tres longtemps ») : la queue du journal ne contenait que `thinking_tokens`,
         * `task_started` et `task_notification`, zero `tool_progress`. Le flux etait VIVANT — +17 Ko en
         * 40 s, mesure directe — et la carte figee. La commande etait `vitest run` sur toute la suite,
         * ~9 min ce jour-la. Aucun des deux evenements n'etait lu nulle part dans le depot.
         *
         * Relaye en DIRECT seulement, jamais persiste : un battement n'est pas du raisonnement.
         */
        const demarre = o['subtype'] === 'task_started'
        const brut = String((demarre ? o['description'] : o['summary']) ?? '').trim()
        const commande = resumerCommandeDeFond(brut)
        if (demarre) {
          queue.push({
            delta: '',
            status: commande ? `tache de fond en cours - ${commande}` : 'tache de fond en cours'
          })
          return
        }
        const statut = String(o['status'] ?? '').toLowerCase()
        // On NOMME l'echec au lieu de rendre le meme libelle qu'une reussite : une tache de fond qui
        // rate en silence est exactement ce que ce relais existe pour supprimer.
        const issue = statut === 'completed' ? 'terminee' : statut === 'failed' ? 'en echec' : statut || 'terminee'
        queue.push({
          delta: '',
          status: commande ? `tache de fond ${issue} - ${commande}` : `tache de fond ${issue}`
        })
        return
      }
      if (t === 'stream_event') {
        // Raisonnement INCREMENTAL : la seule source temps reel. `text_delta` est volontairement
        // ignore ici — le texte de reponse reste pris sur l'evenement `assistant`, sans quoi il
        // serait compte deux fois.
        const ev = o['event'] as { type?: string; delta?: { type?: string; thinking?: string } } | undefined
        const delta = ev?.delta
        if (ev?.type === 'content_block_delta' && delta?.type === 'thinking_delta' && delta.thinking) {
          partialThinkingSeen = true
          reasoningFragments.push(delta.thinking)
          queue.push({ delta: '', reasoning: delta.thinking })
        }
        return
      }
      if (t === 'result') resultSeen = true
      if (t === 'assistant') {
        const msg = o['message'] as
          | {
              model?: string
              content?: Array<{
                type: string
                text?: string
                thinking?: string
                id?: string
                name?: string
                input?: Record<string, unknown>
                source?: { type?: string; media_type?: string; data?: string }
                file?: { name?: string; media_type?: string; data?: string }
              }>
            }
          | undefined
        if (msg?.model) resolvedModel = msg.model // modèle RÉEL rapporté par Claude
        collectArtifacts(msg?.content)
        for (const part of msg?.content ?? []) {
          if (part.type === 'text' && part.text) {
            text += part.text
            queue.push({ delta: part.text })
          } else if (part.type === 'thinking' && part.thinking) {
            // Deja diffuse morceau par morceau via `stream_event` : le bloc complet est un doublon.
            if (partialThinkingSeen) continue
            // Raisonnement CONSERVÉ pour l'observation post-mortem ET streamé en direct : c'est la
            // seule chose qui se passe pendant les secondes d'attente avant le premier mot.
            reasoningFragments.push(part.thinking)
            queue.push({ delta: '', reasoning: part.thinking })
          } else if (part.type === 'tool_use' && part.id && part.name) {
            // B — mémorise l'appel outil ; la preuve (ok/échec) arrive dans le tool_result associé.
            const filePath = String(part.input?.file_path ?? '')
            const command = String(part.input?.command ?? filePath)
            pendingTools.set(part.id, {
              name: part.name,
              command,
              filePath,
              writtenLineFingerprints: claudeWrittenLineFingerprints(part.input)
            })
            /*
             * SIGNE DE VIE PAR APPEL D'OUTIL — relaye en DIRECT, jamais persiste (meme regle que le
             * battement `tool_progress` ci-dessus, qui ne couvre QUE les outils LONGS : le CLI ne
             * l'emet qu'apres 30 s de silence, donc jamais pour une rafale de lectures rapides).
             *
             * Mesure du 2026-08-31, run conv-9 : 52 appels d'outils TOUS reussis (26 Read, 23 Grep,
             * 3 Glob) en 223 659 ms, et ZERO texte produit — donc 224 s d'ecran muet. L'utilisateur
             * a stoppe a 3 min 43 et les 52 resultats ont ete jetes (run rouge, livrable vide).
             * `causal-trace/conv-9.jsonl` porte un seul trou de 224 s sans evenement, puis les 52
             * enregistrements d'un coup en 12 ms a la fin.
             *
             * L'asymetrie corrigee ici : la boucle SAVAIT que le sous-agent vivait — `consumeText`
             * nourrit `watchdog.beat()` a chaque ligne de stdout, celles-ci comprises — et s'en
             * servait pour le laisser tourner sans jamais le dire a l'utilisateur.
             */
            const cible = (filePath || command).slice(0, 120)
            // UNE SEULE LIGNE : ce libelle s'affiche dans l'en-tete du bloc « Reflexion » et dans son
            // corps deplie, ou chaque signe de vie occupe UNE ligne. Des retours a la ligne dans le
            // texte y inseraient des lignes vides et casseraient l'en-tete (constat du 2026-09-01).
            queue.push({ delta: '', status: `${part.name}${cible ? ` · ${cible}` : ''}` })
          }
        }
      } else if (t === 'user') {
        // tool_result : apparie l'appel outil → executionEvidence (shape commun à tous les exécuteurs).
        const msg = o['message'] as
          | {
              content?: Array<{
                type: string
                tool_use_id?: string
                is_error?: boolean
                content?: unknown
              }>
            }
          | undefined
        for (const part of msg?.content ?? []) {
          if (part.type !== 'tool_result' || !part.tool_use_id) continue
          const call = pendingTools.get(part.tool_use_id)
          if (!call) continue
          pendingTools.delete(part.tool_use_id)
          // Contenu réel du résultat d'outil (stdout / retour d'édition), pour un rendu inline lisible.
          const output = claudeToolResultText(part.content).slice(-20_000)
          collectArtifacts(part.content, call.name)
          const isFile = Boolean(call.filePath)
          executionEvidence.push({
            type: call.name,
            kind: claudeToolEvidenceKind(call.name, call.command),
            status: part.is_error ? 'failed' : 'completed',
            ok: part.is_error !== true,
            summary: `${call.name} ${call.command}`.trim(),
            // Champs STRUCTURÉS (parité avec Codex) : chemin pour une édition, commande + stdout sinon.
            ...(isFile
              ? {
                  path: call.filePath,
                  paths: [claudeEvidencePath(call.filePath, execution?.cwd ?? process.cwd())],
                  ...(call.writtenLineFingerprints.length > 0
                    ? { writtenLineFingerprints: call.writtenLineFingerprints }
                    : {})
                }
              : call.command
                ? { command: call.command }
                : {}),
            ...(output ? { stdout: output } : {})
          })
        }
      } else if (t === 'result') {
        if (typeof o['result'] === 'string' && !text) text = o['result'] as string
        if (typeof o['session_id'] === 'string') sessionId = o['session_id'] as string
        // Tokens/coût RÉELS du tour (le result event du CLI les porte).
        const hasReportedCost = Object.prototype.hasOwnProperty.call(o, 'total_cost_usd')
        const normalizedUsage = normalizeClaudeUsage(
          o['usage'],
          o['total_cost_usd'],
          hasReportedCost
        )
        if (normalizedUsage) usage = normalizedUsage
        const resultFailed = o['is_error'] === true
        if (resultFailed) {
          const code = typeof o['subtype'] === 'string' ? o['subtype'] : 'provider-result-error'
          const reported = String(o['result'] ?? '').trim()
          const cost = normalizedUsage?.costUsd
          const detail =
            reported || (cost === undefined ? code : `${code} · ${cost.toFixed(4)} USD`)
          // Un event `result` est deja la decision terminale du CLI (qui gere ses propres retries).
          // Le rejouer au niveau AgentPilot repaie le meme prompt et contourne la borne provider.
          errored = new ProviderCallError(`Claude a interrompu l'appel : ${detail}`, {
            code,
            retryable: false,
            usage: normalizedUsage,
            resolvedModel
          })
        } else if (!normalizedUsage) {
          errored = new Error('claude result usage invalide ou incomplet')
        }
      }
    }

    /** Consomme du texte brut du CLI : découpe en lignes complètes puis parse chaque event. */
    const consumeText = (text: string): void => {
      buffer += text
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
      watchdog.beat() // activité observée → réarme le timer d'inactivité
      wake()
    }

    let tailSettled: Promise<unknown> | undefined
    if (journal) {
      // Mode DÉTACHÉ : la sortie est dans un FICHIER (elle survit à la mort de l'app) et on la SUIT.
      // Le fd parent est fermé (l'enfant garde le sien) ; le tail lit par chemin.
      try {
        closeSync(journal.fd)
      } catch {
        /* déjà fermé */
      }
      tailSettled = tailJsonLines(journal.path, (line) => consumeText(`${line}\n`), {
        // 40ms : le streaming passe par un poll de fichier (et non un pipe instantané) — granularité
        // assez fine pour que le chat reste fluide, sans brûler du CPU.
        pollMs: 40,
        isComplete: () => childClosed
      }).then(
        () => undefined,
        (error: unknown) => error
      )
    } else {
      child.stdout?.on('data', (chunk: Buffer) => consumeText(chunk.toString('utf8')))
    }
    child.on('error', (e) => {
      if (relayCompletionPoll) clearInterval(relayCompletionPoll)
      watchdog.dispose()
      if (!childPid) execution?.onSpawnIntent?.(spawnToken, false)
      errored = e
      done = true
      wake()
    })
    child.once('close', async (code) => {
      childClosed = true
      if (relayCompletionPoll) clearInterval(relayCompletionPoll)
      const tailError = await tailSettled
      watchdog.dispose()
      if (childPid) execution?.onProcess?.(childPid, false)
      if (systemPromptDir) rmSync(systemPromptDir, { recursive: true, force: true })
      // Meme hygiene que le system prompt : un dossier temporaire par appel ne doit pas s'accumuler
      // (c'est exactement la fuite disque constatee ce jour sur run-stdout/).
      if (settingsDir) rmSync(settingsDir, { recursive: true, force: true })
      // Le fichier de config MCP porte le jeton : il ne survit pas a l'appel qui l'a justifie.
      mcpConfigDir?.nettoyer()
      if (invocation.inputPath) rmSync(invocation.inputPath, { force: true })
      // Journal de sortie resté VIDE = le CLI n'a rien écrit (échec de lancement, appel avorté). Il
      // n'apporte rien à une reprise et fait croire à un run existant : mesuré 3 journaux vides sur 7
      // spawns lors d'un test réel, et 20 spawns en erreur sur 114 en usage réel. On le supprime.
      if (journal) {
        try {
          if (statSync(journal.path).size === 0) rmSync(journal.path, { force: true })
        } catch {
          /* déjà absent ou inaccessible : rien à nettoyer */
        }
      }
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
      if (tailError && !errored) {
        errored = tailError instanceof Error ? tailError : new Error(String(tailError))
      }
      if (code !== 0 && !errored) errored = new Error(`claude CLI exit ${code}`)
      // Retries epuises sans reponse : le CLI sort en 0 sans event `result`, donc le tour passait
      // pour un succes VIDE et l'UI ne quittait jamais l'etat « reflexion ». C'est un ECHEC, nomme.
      if (!errored && !resultSeen && !text && lastRetry) {
        errored = new Error(
          `API Claude surchargée (${lastRetry.status || '529'}) — abandon après ` +
            `${lastRetry.attempt}/${lastRetry.maxRetries} tentatives, aucune réponse. Réessayez.`
        )
      }
      done = true
      wake()
    })

    if (journal && invocation.relay) {
      // Sous Windows, le relais DETACHE peut avoir certifie la sortie dans `.exit.json` sans que
      // Node livre l'event `close` au parent (observe en reel sur un Judge : resultat VALIDE ecrit,
      // relais termine, run reste `active` jusqu'au watchdog). La preuve atomique du relais est plus
      // forte que cet event volatil : on la convertit en la meme cloture locale, apres installation
      // du listener et avec `once` pour ignorer un event tardif du processus.
      relayCompletionPoll = setInterval(() => {
        if (childClosed) return
        const exitCode = survivableExitCode(journal.path)
        if (exitCode !== undefined) child.emit('close', exitCode)
      }, 80)
      relayCompletionPoll.unref?.()
    }

    // Prompt remis sur STDIN (et non en argv) → aucune limite de longueur de ligne de commande.
    // Best-effort : un stdin fermé (process déjà mort) ne doit pas jeter hors du flux normal.
    try {
      if (!journal) child.stdin?.end(lastUser)
    } catch {
      /* stdin indisponible (process mort avant écriture) → close/error prendront le relais */
    }

    // pompe : yield les chunks au fil de l'eau
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!
        continue
      }
      if (done) break
      await new Promise<void>((r) => (resolveWait = r))
    }

    if (errored) {
      // Les actions deja observees sont la SEULE trace de ce que l'agent a fait avant de casser, et
      // c'est le moment ou on en a le plus besoin. Sans cet accrochage elles partent avec le `throw`.
      attacherEvidenceALErreur(errored, executionEvidence)
      throw errored
    }
    if (mutationBefore && execution) {
      await appendWorkspaceMutationEvidence(mutationBefore, execution.cwd, executionEvidence)
    }
    attestIsolatedVerificationEvidence(
      executionEvidence,
      execution?.causallyIsolated === true,
      execution?.learningOracles
    )
    const inlineArtifacts = normalizeProviderArtifacts(artifactCandidates, {
      provider: this.id,
      model: resolvedModel,
      workspaceRoot: execution?.cwd
    })
    const fileArtifacts = artifactsFromExecutionEvidence(executionEvidence, {
      provider: this.id,
      model: resolvedModel,
      workspaceRoot: execution?.cwd
    })
    const artifacts = [...inlineArtifacts, ...fileArtifacts].filter(
      (artifact, index, all) => all.findIndex((candidate) => candidate.id === artifact.id) === index
    )
    return {
      text,
      provider: this.id,
      sessionId,
      systemInjected,
      usage,
      executionEvidence: executionEvidence.length ? executionEvidence : undefined,
      thinking: joinThinking(reasoningFragments),
      model: resolvedModel,
      artifacts: artifacts.length ? artifacts : undefined
    }
  }
}
function base64Fingerprint(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex')
}