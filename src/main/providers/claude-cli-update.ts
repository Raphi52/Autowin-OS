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
//
// UNE PUBLICATION NOUVELLE PASSE LA FENETRE. Un nouveau modele arrive avec une nouvelle version du
// CLI : attendre 12 h la retardait d'autant. Quand la version installee et la version publiee sur npm
// sont lisibles, une version publiee jamais tentee declenche la mise a jour tout de suite ; une
// version deja a jour ne lance rien. Une publication deja tentee (canal « stable », installation qui
// n'avance pas) retombe sous la fenetre, pour ne pas relancer `claude update` en boucle.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { execFileHorsFil, type ErreurHorsFil } from '../gel/execution-hors-fil'
import { resolveClaudeBin, signalerMiseAJourClaudeCli } from './claude'

/** Fenetre entre deux tentatives : assez courte pour suivre les publications, assez large pour ne pas payer un spawn a chaque demarrage. */
export const CLAUDE_CLI_UPDATE_WINDOW_MS = 12 * 60 * 60 * 1000
/** Plafond dur : une mise a jour qui traine ne doit pas retenir un process. */
const UPDATE_TIMEOUT_MS = 180_000

interface UpdateStamp {
  attemptedAt: number
  /** Version publiee visee par cette tentative, quand elle etait lisible. */
  publiee?: string
}

function readStamp(stampPath: string): UpdateStamp | undefined {
  try {
    const parsed = JSON.parse(readFileSync(stampPath, 'utf8')) as UpdateStamp
    if (!Number.isFinite(parsed.attemptedAt)) return undefined
    return {
      attemptedAt: parsed.attemptedAt,
      ...(typeof parsed.publiee === 'string' ? { publiee: parsed.publiee } : {})
    }
  } catch {
    return undefined
  }
}

function writeStamp(stampPath: string, attemptedAt: number, publiee?: string): void {
  try {
    mkdirSync(dirname(stampPath), { recursive: true })
    writeFileSync(
      stampPath,
      JSON.stringify({ attemptedAt, ...(publiee ? { publiee } : {}) }),
      'utf8'
    )
  } catch {
    // Marqueur = confort : son echec d'ecriture ne doit pas empecher la mise a jour elle-meme.
  }
}

/** Le paquet npm du CLI : `claude update` suit son etiquette `latest` par defaut. */
const PAQUET_CLI = '@anthropic-ai/claude-code'

/** Versions lues ; un champ absent = illisible, et la fenetre de 12 h decide seule. */
export interface VersionsCli {
  installee?: string
  publiee?: string
}

/**
 * Version du paquet npm qui porte le binaire (`…/@anthropic-ai/claude-code/bin/claude.exe`). Tout
 * autre emplacement (installateur natif, `CLAUDE_BIN`) rend `undefined` : on ne devine pas.
 */
export function versionInstallee(bin: string): string | undefined {
  try {
    const paquet = JSON.parse(
      readFileSync(join(dirname(dirname(bin)), 'package.json'), 'utf8')
    ) as {
      name?: unknown
      version?: unknown
    }
    return paquet.name === PAQUET_CLI && typeof paquet.version === 'string'
      ? paquet.version
      : undefined
  } catch {
    return undefined
  }
}

/** Derniere version publiee sur npm (~3,5 Ko lus) ; hors ligne ou refus = `undefined`. */
export async function versionPubliee(fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const reponse = await fetchFn(`https://registry.npmjs.org/${PAQUET_CLI}/latest`, {
      signal: AbortSignal.timeout(5_000)
    })
    if (!reponse.ok) return undefined
    const manifeste = (await reponse.json()) as { version?: unknown }
    return typeof manifeste.version === 'string' ? manifeste.version : undefined
  } catch {
    return undefined
  }
}

export async function versionsDuCliClaude(bin: string): Promise<VersionsCli> {
  return { installee: versionInstallee(bin), publiee: await versionPubliee() }
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
    /** Versions installee et publiee ; absent = seule la fenetre decide (comportement d'avant). */
    versions?: (bin: string) => Promise<VersionsCli>
  } = {}
): Promise<ClaudeCliUpdateResult> {
  const now = options.now ?? Date.now()
  const windowMs = options.windowMs ?? CLAUDE_CLI_UPDATE_WINDOW_MS
  const stamp = readStamp(stampPath)
  const dansLaFenetre = Boolean(stamp && now - stamp.attemptedAt < windowMs)
  if (dansLaFenetre && !options.versions) return { outcome: 'skipped' }
  const bin = options.bin ?? resolveClaudeBin()
  const versions = options.versions ? await options.versions(bin).catch(() => undefined) : undefined
  const installee = versions?.installee
  const publiee = versions?.publiee
  if (installee && publiee && installee === publiee) return { outcome: 'skipped' }
  const publicationJamaisTentee = Boolean(installee && publiee && stamp?.publiee !== publiee)
  if (dansLaFenetre && !publicationJamaisTentee) return { outcome: 'skipped' }
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
  writeStamp(stampPath, now, publiee)
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
  // Hors du fil principal : retenté toutes les 15 min tant que le CLI tourne, ce `tasklist` a tenu la
  // fenêtre 20,8 s d'un seul appel (`gels.jsonl`, 2026-10-31).
  return execFileHorsFil('tasklist', ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`], {
    windowsHide: true,
    timeout: 10_000
  }).then(
    ({ stdout }) => imageEnCours(stdout, image),
    () => false
  )
}

/**
 * Hors du fil principal, comme `tasklist` : le `cmd.exe` de `claude update` a tenu la fenêtre 16,2 s
 * (`gels.jsonl`, 2026-10-31). La sortie rend stdout puis stderr : l'erreur éventuelle
 * reste la dernière ligne, celle que `detail` retient.
 */
async function runClaudeUpdate(bin: string): Promise<{ code: number | null; output: string }> {
  try {
    const { stdout, stderr } = await execFileHorsFil(bin, ['update'], {
      windowsHide: true,
      shell: process.platform === 'win32',
      timeout: UPDATE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024
    })
    return { code: 0, output: stdout + stderr }
  } catch (erreur) {
    const e = erreur as ErreurHorsFil
    if (e.killed) throw new Error(`\`claude update\` depasse ${UPDATE_TIMEOUT_MS} ms`)
    if (typeof e.code === 'number')
      return { code: e.code, output: (e.stdout ?? '') + (e.stderr ?? '') }
    throw erreur
  }
}
