import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { TacheDeFondARelancer } from '../providers/types'
import { spawnSurvivable } from '../runs/survivable-spawn'
import { survivableExitCode, writeSurvivableExit } from '../runs/stdout-journal'

/**
 * UNE COMMANDE SHELL COUPÉE EN FIN DE TOUR EST RELANCÉE HORS DU TOUR, ET SON RÉSULTAT REVIENT.
 *
 * Le CLI `-p` arrête les tâches de fond à la fin du tour (conv-528 : `task_notification` `stopped`
 * 263 ms avant `done` ; conv-42 : 6 essais perdus). L'app ajoutait seulement « relance la demande »
 * et le mode auto se mettait en pause : le résultat était perdu, et c'était à l'utilisateur de
 * relancer.
 *
 * Ici : la commande est relancée par l'app, dans le MÊME dossier, avec un lancement qui survit au
 * tour et à l'app (`runs/survivable-spawn.ts`, journal sur disque). Quand toutes les commandes du
 * même tour sont finies, UN tour de reprise est ouvert dans la même conversation, avec leur code de
 * sortie et la fin de leur sortie. Il attend que la conversation soit libre : un message de
 * l'utilisateur passe toujours en premier, jamais remplacé.
 *
 * Le lot est écrit sur disque AVANT d'attendre : une app fermée entre-temps reprend la surveillance
 * au démarrage suivant (`reprendreAuDemarrage`). Une durée maximale borne l'attente : au-delà, la
 * commande est arrêtée et le tour de reprise le DIT.
 */

/** Au-delà, la commande relancée est arrêtée et le tour de reprise dit « durée dépassée ». */
export const LIMITE_TACHE_RELANCEE_MS = 2 * 60 * 60 * 1000
const INTERVALLE_SURVEILLANCE_MS = 2_000
/** Fin de sortie rendue au modèle : assez pour lire un résumé de tests, pas un journal entier. */
export const FIN_DE_SORTIE_CARACTERES = 4_000

/** Une commande relancée, telle qu'écrite sur disque pour survivre à l'app. */
export interface TacheRelancee {
  lot: string
  conversationId: string
  id: string
  commande: string
  cwd: string
  debut: number
  journalPath?: string
  pid?: number
  /** Le lancement lui-même a échoué : rien ne tourne. */
  erreurDemarrage?: string
}

export type IssueTacheRelancee =
  | { type: 'sortie'; code: number }
  | { type: 'duree-depassee'; limiteMs: number }
  | { type: 'non-demarree'; erreur: string }

export interface ResultatTacheRelancee {
  commande: string
  cwd: string
  issue: IssueTacheRelancee
  sortie: string
}

export interface MagasinLots {
  ecrire(lot: string, taches: TacheRelancee[]): void
  lister(): TacheRelancee[][]
  supprimer(lot: string): void
}

export interface DependancesRelance {
  /** Lance la commande hors du tour. Jette si rien n'a pu démarrer. */
  lancer(tache: { commande: string; cwd: string; jeton: string }): {
    journalPath: string
    pid?: number
  }
  /** Code de sortie certifié par le relais, ou `undefined` tant que la commande tourne. */
  codeDeSortie(journalPath: string): number | undefined
  /** Fin de la sortie (stdout + stderr fusionnés). */
  lireSortie(journalPath: string): string
  arreter(pid: number | undefined): void
  conversationOccupee(conversationId: string): boolean
  envoyerTour(conversationId: string, prompt: string): Promise<unknown>
  magasin: MagasinLots
  maintenant?: () => number
  attendre?: (ms: number) => Promise<void>
  limiteMs?: number
  intervalleMs?: number
  journaliser?: (message: string, erreur?: unknown) => void
}

export interface RelanceurTachesDeFond {
  /** Relance les commandes d'UN tour ; rend la main quand le tour de reprise est envoyé. */
  relancer(conversationId: string, taches: readonly TacheDeFondARelancer[]): Promise<void>
  /** Reprend les lots restés sur disque (app fermée pendant qu'ils tournaient). */
  reprendreAuDemarrage(): Promise<void>
}

export function creerRelanceurTachesDeFond(deps: DependancesRelance): RelanceurTachesDeFond {
  const maintenant = deps.maintenant ?? Date.now
  const attendre =
    deps.attendre ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const limiteMs = deps.limiteMs ?? LIMITE_TACHE_RELANCEE_MS
  const intervalleMs = deps.intervalleMs ?? INTERVALLE_SURVEILLANCE_MS
  const journaliser =
    deps.journaliser ?? ((message: string, erreur?: unknown) => console.warn(message, erreur ?? ''))
  /** `conversation:task_id` déjà relancés : une tâche signalée deux fois ne part qu'une fois. */
  const dejaRelancees = new Set<string>()

  const issueDe = (tache: TacheRelancee): IssueTacheRelancee | undefined => {
    if (tache.erreurDemarrage || !tache.journalPath)
      return { type: 'non-demarree', erreur: tache.erreurDemarrage ?? 'aucun journal de sortie' }
    const code = deps.codeDeSortie(tache.journalPath)
    if (code !== undefined) return { type: 'sortie', code }
    if (maintenant() - tache.debut >= limiteMs) {
      try {
        deps.arreter(tache.pid)
      } catch (erreur) {
        journaliser(`[taches de fond] arrêt impossible de « ${tache.commande} »`, erreur)
      }
      return { type: 'duree-depassee', limiteMs }
    }
    return undefined
  }

  const surveiller = async (lot: string, taches: TacheRelancee[]): Promise<void> => {
    const issues = new Map<number, IssueTacheRelancee>()
    for (;;) {
      taches.forEach((tache, index) => {
        if (issues.has(index)) return
        const issue = issueDe(tache)
        if (issue) issues.set(index, issue)
      })
      if (issues.size === taches.length) break
      await attendre(intervalleMs)
    }
    const conversationId = taches[0].conversationId
    // Le message de l'utilisateur passe en premier : la reprise attend que le fil soit libre.
    while (deps.conversationOccupee(conversationId)) await attendre(intervalleMs)
    const resultats = taches.map((tache, index) => ({
      commande: tache.commande,
      cwd: tache.cwd,
      issue: issues.get(index)!,
      sortie: tache.journalPath ? lireSortieSure(tache.journalPath) : ''
    }))
    try {
      await deps.envoyerTour(conversationId, composerPromptDeReprise(resultats))
    } catch (erreur) {
      journaliser(`[taches de fond] tour de reprise impossible dans ${conversationId}`, erreur)
    }
    deps.magasin.supprimer(lot)
  }

  const lireSortieSure = (journalPath: string): string => {
    try {
      return deps.lireSortie(journalPath)
    } catch (erreur) {
      return `(sortie illisible : ${erreur instanceof Error ? erreur.message : String(erreur)})`
    }
  }

  return {
    async relancer(conversationId, taches) {
      const aRelancer = taches.filter((tache) => {
        const cle = `${conversationId}:${tache.id}`
        if (!tache.commande.trim() || dejaRelancees.has(cle)) return false
        dejaRelancees.add(cle)
        return true
      })
      if (aRelancer.length === 0) return
      const lot = randomUUID()
      const relancees: TacheRelancee[] = aRelancer.map((tache) => {
        const base = {
          lot,
          conversationId,
          id: tache.id,
          commande: tache.commande,
          cwd: tache.cwd,
          debut: maintenant()
        }
        try {
          const lance = deps.lancer({
            commande: tache.commande,
            cwd: tache.cwd,
            jeton: `${lot}-${tache.id}`
          })
          return {
            ...base,
            journalPath: lance.journalPath,
            ...(lance.pid ? { pid: lance.pid } : {})
          }
        } catch (erreur) {
          return {
            ...base,
            erreurDemarrage: erreur instanceof Error ? erreur.message : String(erreur)
          }
        }
      })
      deps.magasin.ecrire(lot, relancees)
      await surveiller(lot, relancees)
    },
    async reprendreAuDemarrage() {
      const lots = deps.magasin.lister().filter((taches) => taches.length > 0)
      for (const taches of lots)
        for (const tache of taches) dejaRelancees.add(`${tache.conversationId}:${tache.id}`)
      await Promise.all(lots.map((taches) => surveiller(taches[0].lot, taches)))
    }
  }
}

/** Le message du tour de reprise : ce qui a tourné, comment ça a fini, et la fin de la sortie. */
export function composerPromptDeReprise(resultats: readonly ResultatTacheRelancee[]): string {
  const blocs = resultats.map((r) => {
    const issue =
      r.issue.type === 'sortie'
        ? r.issue.code === 0
          ? 'terminée — code de sortie 0 (succès)'
          : `ÉCHEC — code de sortie ${r.issue.code}`
        : r.issue.type === 'duree-depassee'
          ? `ARRÊTÉE — durée maximale dépassée (${Math.round(r.issue.limiteMs / 60_000)} min), résultat incomplet`
          : `NON DÉMARRÉE — ${r.issue.erreur}`
    const sortie =
      r.sortie.length > FIN_DE_SORTIE_CARACTERES
        ? `…${r.sortie.slice(-FIN_DE_SORTIE_CARACTERES)}`
        : r.sortie
    return [
      `Commande : \`${r.commande}\``,
      `Dossier : ${r.cwd}`,
      `Issue : ${issue}`,
      'Fin de la sortie :',
      '```',
      sortie.trim() || '(aucune sortie)',
      '```'
    ].join('\n')
  })
  return [
    '[Reprise automatique] Ton tour précédent s’est terminé pendant une tâche de fond : le CLI l’a coupée.',
    'Autowin l’a relancée hors du tour, dans le même dossier. Voici son résultat réel — reprends là où tu t’étais arrêté, sans la relancer.',
    '',
    blocs.join('\n\n')
  ].join('\n')
}

/** Lots écrits en JSON, un fichier par tour, écriture atomique. */
export function magasinLotsSurDisque(dossier: string): MagasinLots {
  const chemin = (lot: string): string =>
    join(dossier, `${lot.replace(/[^A-Za-z0-9-]/g, '_')}.json`)
  return {
    ecrire(lot, taches) {
      mkdirSync(dossier, { recursive: true })
      const temporaire = `${chemin(lot)}.${process.pid}.tmp`
      writeFileSync(temporaire, JSON.stringify(taches), 'utf8')
      renameSync(temporaire, chemin(lot))
    },
    lister() {
      if (!existsSync(dossier)) return []
      const lots: TacheRelancee[][] = []
      for (const nom of readdirSync(dossier)) {
        if (!nom.endsWith('.json')) continue
        try {
          const lu: unknown = JSON.parse(readFileSync(join(dossier, nom), 'utf8'))
          if (Array.isArray(lu)) lots.push(lu as TacheRelancee[])
        } catch {
          /* lot illisible : ignoré, jamais exécuté à l'aveugle */
        }
      }
      return lots
    },
    supprimer(lot) {
      rmSync(chemin(lot), { force: true })
    }
  }
}

/**
 * Le bash où relancer la commande : celui du CLI Claude (`CLAUDE_CODE_GIT_BASH_PATH`), sinon Git
 * Bash à son emplacement standard sous Windows, sinon `bash` du PATH.
 */
export function resoudreBash(
  env: NodeJS.ProcessEnv = process.env,
  plateforme: NodeJS.Platform = process.platform,
  existe: (chemin: string) => boolean = existsSync
): string {
  const explicite = env['CLAUDE_CODE_GIT_BASH_PATH']
  if (explicite && existe(explicite)) return explicite
  if (plateforme !== 'win32') return 'bash'
  const candidats = [
    env['ProgramFiles'] && join(env['ProgramFiles'], 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env['LOCALAPPDATA'] && join(env['LOCALAPPDATA'], 'Programs', 'Git', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe'
  ].filter((c): c is string => Boolean(c))
  return candidats.find((c) => existe(c)) ?? 'bash'
}

/** Arguments bash : stderr fusionné dans stdout, pour que la fin de sortie dise aussi les erreurs. */
export function argumentsBash(commande: string): string[] {
  return ['-c', `{\n${commande}\n} 2>&1`]
}

/** La fin d'un journal, sans charger un fichier de plusieurs Mo pour en garder 4 000 caractères. */
export function lireFinDeFichier(chemin: string, octets = 16 * 1024): string {
  const fd = openSync(chemin, 'r')
  try {
    const taille = fstatSync(fd).size
    const debut = Math.max(0, taille - octets)
    const tampon = Buffer.alloc(taille - debut)
    readSync(fd, tampon, 0, tampon.length, debut)
    return tampon.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Le relanceur câblé sur le vrai système : bash, lancement survivable (journal + preuve de sortie
 * `.exit.json` écrite par le relais, même app fermée), lots dans `dossier/lots`.
 */
export function creerRelanceurSurDisque(entree: {
  dossier: string
  conversationOccupee: (conversationId: string) => boolean
  envoyerTour: (conversationId: string, prompt: string) => Promise<unknown>
}): RelanceurTachesDeFond {
  const journaux = join(entree.dossier, 'journaux')
  return creerRelanceurTachesDeFond({
    lancer: ({ commande, cwd, jeton }) => {
      const run = spawnSurvivable({
        bin: resoudreBash(),
        args: argumentsBash(commande),
        cwd,
        runId: jeton,
        journalRoot: journaux,
        // Journal OBLIGATOIRE : sans lui, ni la sortie ni le code ne reviendraient.
        onJournalPrepared: () => {}
      })
      const journalPath = run.journalPath!
      // Un binaire introuvable émet `error` : on le CERTIFIE comme échec au lieu de laisser le
      // processus principal tomber sur un évènement non écouté.
      run.child.once('error', (erreur) => {
        try {
          appendFileSync(journalPath, `\n[Autowin] lancement impossible : ${erreur.message}\n`)
          writeSurvivableExit(journalPath, 127)
        } catch {
          /* la durée maximale finira par le dire */
        }
      })
      run.release()
      return { journalPath, ...(run.pid ? { pid: run.pid } : {}) }
    },
    codeDeSortie: (journalPath) => survivableExitCode(journalPath),
    lireSortie: (journalPath) => lireFinDeFichier(journalPath),
    arreter: (pid) => {
      if (pid) process.kill(pid)
    },
    conversationOccupee: entree.conversationOccupee,
    envoyerTour: entree.envoyerTour,
    magasin: magasinLotsSurDisque(join(entree.dossier, 'lots'))
  })
}
