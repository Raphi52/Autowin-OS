import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { openStdoutJournal, tailJsonLines, type TailOptions, type TailResult } from './stdout-journal'

/**
 * Lancement d'un CLI qui SURVIT à la fermeture de l'app.
 *
 * Pourquoi ici et pas dans chaque adaptateur : la survie était écrite À L'INTÉRIEUR de `claude.ts`.
 * Résultat mesuré — `codex` et `kimi` lançaient leurs processus en pipes non détachés, donc leur
 * travail mourait avec l'app, et un provider branché plus tard héritait de CE comportement-là sans
 * qu'aucun signal ne le dise. Une capacité transverse ne peut pas vivre dans une spécialité.
 *
 * Le mécanisme : sortie redirigée vers un JOURNAL fichier (au lieu d'un pipe mémoire perdu avec le
 * parent), processus `detached` + `unref()`. L'app SUIT ce fichier ; si elle meurt, le CLI continue
 * d'écrire, et une instance ultérieure peut reprendre la lecture depuis l'offset atteint.
 *
 * Dégradation assumée : sans racine de journal (ou si son ouverture échoue), on retombe sur des
 * pipes classiques et `survivable` vaut false — mieux vaut un run non survivable qu'un run refusé.
 */

export interface SurvivableSpawnInput {
  bin: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Identifie le journal sur disque. Un jeton unique par spawn évite d'écraser un run voisin. */
  runId?: string
  /** Racine des journaux. Défaut : `AUTOWIN_RUN_JOURNAL_ROOT` posée par l'app au démarrage. */
  journalRoot?: string
  /** Échappatoire historique : `AUTOWIN_DETACHED_RUNS=0` force le mode pipe. */
  detachedEnabled?: boolean
}

export interface SurvivableRun {
  child: ChildProcess
  pid?: number
  /** Jeton de ce lancement — sert de nom de journal et de clé de lease worktree. */
  spawnToken: string
  /** Chemin du journal, ou undefined en mode dégradé (pipes). */
  journalPath?: string
  /** Vrai si ce run continue de produire même l'app fermée. */
  survivable: boolean
  /** Suit la sortie ligne par ligne. En mode dégradé, lit le pipe stdout. */
  tail(onLine: (line: string) => void, options?: TailOptions): Promise<TailResult>
  /** Referme le fd du journal côté parent (le processus garde le sien). */
  release(): void
}

function journalRootFrom(input: SurvivableSpawnInput): string | undefined {
  return input.journalRoot ?? process.env.AUTOWIN_RUN_JOURNAL_ROOT
}

function detachedAllowed(input: SurvivableSpawnInput): boolean {
  if (input.detachedEnabled !== undefined) return input.detachedEnabled
  return process.env.AUTOWIN_DETACHED_RUNS !== '0'
}

/** Lance un CLI de façon survivable. Ne jette jamais pour une raison de journal. */
export function spawnSurvivable(input: SurvivableSpawnInput): SurvivableRun {
  const spawnToken = input.runId ?? randomUUID()
  const root = journalRootFrom(input)
  let journal: { path: string; fd: number } | undefined
  if (detachedAllowed(input) && root) {
    try {
      journal = openStdoutJournal(root, spawnToken)
    } catch {
      journal = undefined // journal impossible → pipes, plutôt que d'échouer le lancement
    }
  }

  const child = spawn(input.bin, input.args, {
    shell: false,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env ? { env: input.env } : {}),
    windowsHide: true,
    ...(journal
      ? { detached: true, stdio: ['pipe', journal.fd, journal.fd] as const }
      : { stdio: ['pipe', 'pipe', 'pipe'] as const })
  })
  // `unref` : l'app peut mourir sans emporter le CLI. Absent sur les doubles de test.
  if (journal && typeof child.unref === 'function') child.unref()

  let released = false
  const release = (): void => {
    if (released || !journal) return
    released = true
    try {
      closeSync(journal.fd)
    } catch {
      /* fd déjà fermé : sans conséquence */
    }
  }

  return {
    child,
    pid: child.pid,
    spawnToken,
    journalPath: journal?.path,
    survivable: journal !== undefined,
    release,
    tail: async (onLine, options = {}) => {
      if (journal) return tailJsonLines(journal.path, onLine, options)
      // Mode dégradé : pas de fichier à suivre, on lit le pipe. Rien n'est récupérable après un
      // crash de l'app — c'est exactement ce que la survie évite.
      return await new Promise<TailResult>((resolve) => {
        let buffered = ''
        let offset = 0
        child.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          offset += Buffer.byteLength(text)
          buffered += text
          const parts = buffered.split('\n')
          buffered = parts.pop() ?? ''
          for (const line of parts) if (line.trim()) onLine(line)
        })
        child.on('close', () => {
          if (buffered.trim()) onLine(buffered.trim())
          resolve({ offset, stopped: false })
        })
      })
    }
  }
}
