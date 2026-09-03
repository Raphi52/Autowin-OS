/**
 * Sonde de SESSION du CLI claude — le pendant de `hasCodexSession` pour Codex.
 *
 * Constaté en réel (2026-07-30) : le préflight n'avait qu'un check « CLI claude » adossé à `hasBin`,
 * donc VERT dès que le binaire répond `--version`. Sur un poste installé mais jamais loggué, tout le
 * diagnostic passait au vert et l'échec n'apparaissait qu'au premier prompt : « Not logged in ·
 * Please run /login ». Un préflight qui laisse découvrir la panne en plein run ne remplit pas son
 * contrat (cf. l'en-tête de preflight.ts), et `hasBin` dit lui-même que « l'authentification a son
 * propre contrôle » — ce contrôle n'existait pas.
 *
 * Autorité choisie : `claude auth status`, qui rend du JSON — mesuré sur ce poste, non loggué :
 *   {"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}  (exit 1)
 * On préfère cette sonde à la lecture de `~/.claude/.credentials.json` (cf. model-quotas.ts) : le
 * chemin du store n'est pas contractuel et varie selon l'installation (fichier, keychain, API key),
 * alors que `auth status` est la réponse du CLI qui exécutera réellement le run.
 *
 * ON SONDE LE BINAIRE DU RUN, PAS UN AUTRE. La résolution passe par `resolveClaudeBin` — la MÊME
 * autorité que l'adaptateur claude (providers/claude.ts) — et le spawn est en `shell: false`. Une
 * première version sondait le littéral `'claude'` avec `shell: true` ; deux défauts, tous deux
 * bloquants :
 *  - un poste peut porter DEUX installations aux stores d'auth distincts (mesuré : le CLI de
 *    `npm i -g` répondait `loggedIn:false` pendant que celui embarqué dans l'app Claude Desktop
 *    répondait `loggedIn:true`). Sonder le shim du PATH pendant que le run élit le `claude.exe` natif
 *    du préfixe npm ressuscite le faux vert que ce module existe pour tuer ;
 *  - `shell: true` fait chercher la commande par cmd.exe, qui consulte le RÉPERTOIRE COURANT avant le
 *    PATH : un `claude.cmd` déposé là serait exécuté dans le process principal d'Electron. C'est
 *    exactement la menace que `findClaudeExecutable` + `npm-global-resolve` refusent déjà (leurs tests
 *    « DÉTOURNEMENT »), et l'en-tête de `findClaudeExecutable` énonce que « `shell: true` est EXCLU ».
 *
 * `unknown` existe pour ne jamais mentir : un CLI qui plante, une sortie illisible, un timeout ou un
 * binaire introuvable ne sont PAS une session valide, mais ne sont pas non plus la preuve d'une
 * session absente.
 */
import { spawn } from 'node:child_process'
import { resolveClaudeBin } from './providers/claude'
import { withClaudeAccountEnv } from './claude-accounts'

export type ClaudeSessionState = 'authenticated' | 'absent' | 'unknown'

/**
 * Fenêtre laissée au CLI pour répondre. Alignée sur `hasBin` (preflight-probes.ts), qui a dû monter à
 * 8 s : au démarrage (Electron + Vite + antivirus, plusieurs spawns en parallèle) un CLI répond
 * tardivement. Au-delà : `unknown`, jamais un vert ni une absence par défaut.
 */
const CLAUDE_AUTH_PROBE_TIMEOUT_MS = 8000

/**
 * Extrait les objets JSON équilibrés du texte, en respectant les chaînes et les échappements.
 *
 * Pourquoi pas `indexOf('{')` + `lastIndexOf('}')` : un CLI intercale volontiers une ligne de service
 * (télémétrie, avis de mise à jour) AVANT sa réponse. Un découpage du premier `{` au dernier `}`
 * englobe alors DEUX objets, `JSON.parse` refuse, et une session parfaitement valide serait rapportée
 * « indéterminée » — un faux rouge sur un vert mérité.
 */
function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return objects
}

/**
 * Parseur PUR de la sortie de `claude auth status`.
 *
 * `authenticated` exige un `loggedIn: true` booléen EXPLICITE. Le code de sortie ne sert pas de
 * raccourci : un exit 0 sans `loggedIn: true` reste non-authentifié. On retient le premier objet qui
 * PORTE le champ `loggedIn`, pour ne pas se laisser détourner par un objet de service qui précède.
 */
export function parseClaudeAuthStatus(stdout: string, exitCode: number | null): ClaudeSessionState {
  for (const candidate of extractJsonObjects(stdout)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
    const loggedIn = (parsed as Record<string, unknown>)['loggedIn']
    if (loggedIn === true) return 'authenticated'
    if (loggedIn === false) return 'absent'
    // Objet valide mais sans le champ (ou d'un type inattendu) : on ne coerce pas et on ne laisse pas
    // `exitCode` trancher à sa place — on continue de chercher un objet qui, lui, répond.
  }
  void exitCode
  return 'unknown'
}

export interface ClaudeSessionProbeDeps {
  spawnFn?: typeof spawn
  timeoutMs?: number
  /** Injectable en test. Défaut : la MÊME résolution que l'adaptateur claude qui exécutera le run. */
  resolveBin?: () => string
}

/**
 * Exécute la sonde réelle. Ne throw JAMAIS : un échec de sonde est un `unknown` à afficher, pas une
 * exception qui casse le diagnostic de démarrage.
 *
 * `shell: false` — voir l'en-tête : c'est ce qui interdit à cmd.exe d'élire un `claude.cmd` du
 * répertoire courant. Conséquence assumée : sur un poste où le PATH n'expose QUE des shims et où
 * `findClaudeExecutable` ne trouve pas le binaire natif, le spawn échoue en ENOENT et la sonde rend
 * `unknown` — « je ne sais pas », ce qui est vrai, plutôt qu'un vert usurpé. C'est la même limite que
 * celle de l'adaptateur qui exécutera le run.
 */
export async function probeClaudeSession(
  deps: ClaudeSessionProbeDeps = {}
): Promise<ClaudeSessionState> {
  const spawnFn = deps.spawnFn ?? spawn
  const timeoutMs = deps.timeoutMs ?? CLAUDE_AUTH_PROBE_TIMEOUT_MS
  const resolveBin = deps.resolveBin ?? ((): string => resolveClaudeBin())
  return await new Promise<ClaudeSessionState>((resolve) => {
    let settled = false
    let stdout = ''
    // Porteur mutable : `finish` doit pouvoir annuler un timer qui n'est armé qu'APRÈS la création de
    // l'enfant (lui-même susceptible de jeter avant tout armement).
    const timer: { handle?: ReturnType<typeof setTimeout> } = {}
    const finish = (state: ClaudeSessionState): void => {
      if (settled) return
      settled = true
      if (timer.handle) clearTimeout(timer.handle)
      resolve(state)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawnFn(resolveBin(), ['auth', 'status'], {
        windowsHide: true,
        shell: false,
        // Sonder SANS l'env du compte actif interrogerait une AUTRE identite que celle que
        // le run utilisera : le badge d'auth mentirait des qu'un second compte existe.
        // EXPLICITE : un CLAUDE_CONFIG_DIR herite ferait sonder un AUTRE compte que l’actif.
        env: withClaudeAccountEnv(process.env)
      })
    } catch {
      finish('unknown')
      return
    }
    timer.handle = setTimeout(() => {
      // `shell: false` → l'enfant est le binaire lui-même, pas un shell hôte : le tuer suffit,
      // aucun petit-fils ne survit derrière.
      child.kill()
      finish('unknown')
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.once('error', () => finish('unknown'))
    child.once('close', (code) => finish(parseClaudeAuthStatus(stdout, code)))
  })
}
