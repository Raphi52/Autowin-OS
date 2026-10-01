// MISE A JOUR AUTOMATIQUE DU CLI CLAUDE — la source du catalogue de modeles.
//
// POURQUOI (mesure du 2026-09-09) : la liste de choix de modeles n'affichait pas Fable 5.1. La cause
// n'etait NI le catalogue NI le scan : le binaire du CLI installe (2.1.251, 31/08) ne contenait
// simplement pas `claude-fable-5-1`. Apres `claude update` (2.1.266), le scan du meme binaire rend
// bien `claude-fable-5-1`. La liste ne pouvait donc pas etre a jour tant que le CLI ne l'etait pas.
//
// Ce module lance `claude update` AU PLUS UNE FOIS par fenetre (12 h par defaut), en tache de fond,
// et n'echoue jamais bruyamment : une mise a jour impossible (hors ligne, installation geree par un
// paquet systeme) laisse l'app fonctionner avec le CLI en place. Aucun rescan a forcer : le scan du
// binaire est memoise sur sa TAILLE et sa DATE (`claude-cli-catalog.ts`), qui changent toutes deux a
// la mise a jour — le rafraichisseur de catalogue (60 s) reprend donc les nouveaux ids tout seul.

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { resolveClaudeBin, signalerMiseAJourClaudeCli } from './providers/claude'

/** Fenetre entre deux tentatives : assez courte pour suivre les publications, assez large pour ne pas payer un spawn a chaque demarrage. */
export const CLAUDE_CLI_UPDATE_WINDOW_MS = 12 * 60 * 60 * 1000
/** Plafond dur : une mise a jour qui traine ne doit pas retenir un process. */
const UPDATE_TIMEOUT_MS = 180_000

interface UpdateStamp {
  attemptedAt: number
}

function readStamp(stampPath: string): UpdateStamp | undefined {
  try {
    const parsed = JSON.parse(readFileSync(stampPath, 'utf8')) as UpdateStamp
    return Number.isFinite(parsed.attemptedAt) ? parsed : undefined
  } catch {
    return undefined
  }
}

function writeStamp(stampPath: string, attemptedAt: number): void {
  try {
    mkdirSync(dirname(stampPath), { recursive: true })
    writeFileSync(stampPath, JSON.stringify({ attemptedAt }), 'utf8')
  } catch {
    // Marqueur = confort : son echec d'ecriture ne doit pas empecher la mise a jour elle-meme.
  }
}

export interface ClaudeCliUpdateResult {
  /**
   * 'updated' : le CLI a repondu OK · 'skipped' : fenetre non ecoulee · 'failed' : tentative KO ·
   * 'postponed' : binaire en cours d'utilisation, rien lance ni marque (a retenter plus tard).
   */
  outcome: 'updated' | 'skipped' | 'failed' | 'postponed'
  /** Sortie utile du CLI (derniere ligne significative), pour la tracer sans dumper. */
  detail?: string
}

/**
 * Tente `claude update` si la fenetre est ecoulee. `now` et `run` sont injectables pour les tests :
 * aucun test ne doit spawner le vrai CLI.
 */
export async function maybeUpdateClaudeCli(
  stampPath: string,
  options: {
    now?: number
    windowMs?: number
    run?: (bin: string) => Promise<{ code: number | null; output: string }>
    bin?: string
    /**
     * Le binaire tourne-t-il deja (agent survivant, autre session Claude Code) ? Vecu le 2026-10-01 :
     * « Update failed because claude.exe is in use », et le marqueur bloquait ensuite 12 h. Absent =
     * jamais en usage (comportement d'avant) ; le demarrage branche `claudeExeEnCours`.
     */
    binaireEnUsage?: (bin: string) => Promise<boolean>
  } = {}
): Promise<ClaudeCliUpdateResult> {
  const now = options.now ?? Date.now()
  const windowMs = options.windowMs ?? CLAUDE_CLI_UPDATE_WINDOW_MS
  const stamp = readStamp(stampPath)
  if (stamp && now - stamp.attemptedAt < windowMs) return { outcome: 'skipped' }
  const bin = options.bin ?? resolveClaudeBin()
  // Binaire occupe : la mise a jour echouerait a coup sur. On ne lance rien et on ne MARQUE rien,
  // pour que la tentative suivante n'attende pas la fenetre entiere.
  if (await (options.binaireEnUsage?.(bin) ?? Promise.resolve(false)).catch(() => false)) {
    return {
      outcome: 'postponed',
      detail: 'binaire du CLI en cours d’utilisation (agents ou sessions ouvertes)'
    }
  }
  // Marqueur ECRIT AVANT la tentative : un echec repete (hors ligne) ne doit pas relancer un spawn
  // a chaque demarrage.
  writeStamp(stampPath, now)
  const run = options.run ?? runClaudeUpdate
  try {
    const enCours = run(bin)
    // Les tours Claude lances pendant la mise a jour l'attendent (le paquet npm est recree).
    signalerMiseAJourClaudeCli(enCours)
    const { code, output } = await enCours
    const detail =
      output
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop() ?? undefined
    return { outcome: code === 0 ? 'updated' : 'failed', detail }
  } catch (erreur) {
    return { outcome: 'failed', detail: erreur instanceof Error ? erreur.message : String(erreur) }
  }
}

/** Une ligne CSV de `tasklist` commence par le nom de l'image entre guillemets. */
export function imageEnCours(sortieTasklist: string, image: string): boolean {
  const attendu = `"${image.toLowerCase()}"`
  return sortieTasklist
    .split(/\r?\n/)
    .some((ligne) => ligne.trim().toLowerCase().startsWith(attendu))
}

/**
 * Sous Windows, un exe en cours d'execution ne peut pas etre remplace : `claude update` echoue.
 * Lecture seule (`tasklist`), bornee a 10 s ; ailleurs ou en cas de doute : pas en usage.
 */
export function claudeExeEnCours(bin: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const image = /\.exe$/i.test(basename(bin)) ? basename(bin) : 'claude.exe'
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`],
      { windowsHide: true, timeout: 10_000 },
      (erreur, sortie) => resolve(!erreur && imageEnCours(String(sortie), image))
    )
  })
}

function runClaudeUpdate(bin: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['update'], { windowsHide: true, shell: process.platform === 'win32' })
    let output = ''
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`\`claude update\` depasse ${UPDATE_TIMEOUT_MS} ms`))
    }, UPDATE_TIMEOUT_MS)
    child.on('error', (erreur) => {
      clearTimeout(timer)
      reject(erreur)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}
