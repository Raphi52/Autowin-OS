import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * JOURNAL DU WATCHDOG TEAMS — le seul temoin lisible apres coup de ce qu'il a fait.
 *
 * Pourquoi (conv-770, 2026-09-26) : le watchdog n'ecrivait que dans la console du processus
 * principal, et une app relancee par `restart_app` jette cette console (`app-restart.ts`, stdio
 * 'ignore'). Impossible alors de prouver la voie choisie (local ou Graph), une detection ou une
 * reponse. Une ligne par EVENEMENT (jamais par passage de surveillance), dans
 * `<donnees>/watchdog-teams.log`.
 *
 * Donnees personnelles : ni nom, ni adresse, ni texte de message. Une conversation est designee
 * par son EMPREINTE (8 caracteres) : l'identifiant brut d'une conversation 1:1 contient les
 * identifiants des deux personnes.
 * Aucune exception ne remonte : un journal qui casserait le watchdog serait pire que pas de journal.
 */

export function cheminJournalWatchdogTeams(racineDonnees: string): string {
  return join(racineDonnees, 'watchdog-teams.log')
}

export type ValeurJournal = string | number | boolean | undefined | null
export type JournalWatchdog = (evenement: string, details?: Record<string, ValeurJournal>) => void

/** Empreinte stable d'une conversation Teams, a partir d'un identifiant d'element `teams:<chat>:<msg>`. */
export function empreinteConversation(itemId: string): string {
  const sansPrefixe = itemId.replace(/^teams:/, '')
  const chat = sansPrefixe.includes(':')
    ? sansPrefixe.slice(0, sansPrefixe.lastIndexOf(':'))
    : sansPrefixe
  return createHash('sha256').update(chat).digest('hex').slice(0, 8)
}

function horodatage(d: Date): string {
  const deux = (v: number): string => String(v).padStart(2, '0')
  return (
    `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}` +
    `T${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`
  )
}

function valeur(v: ValeurJournal): string {
  const brut = String(v)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
  return /[\s"=]/.test(brut) || brut === '' ? `"${brut.replace(/"/g, "'")}"` : brut
}

export function creerJournalWatchdog(
  chemin: string,
  maintenant: () => Date = () => new Date(),
  tailleMax = 1_000_000
): JournalWatchdog {
  return (evenement, details = {}) => {
    try {
      const champs = Object.entries(details)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${valeur(v)}`)
      const ligne = [horodatage(maintenant()), evenement, ...champs].join(' ') + '\n'
      mkdirSync(dirname(chemin), { recursive: true })
      try {
        if (statSync(chemin).size + ligne.length > tailleMax) renameSync(chemin, `${chemin}.1`)
      } catch {
        // fichier absent : premiere ligne
      }
      appendFileSync(chemin, ligne, 'utf8')
    } catch {
      // disque plein, droits, chemin impossible : le watchdog continue sans journal
    }
  }
}
