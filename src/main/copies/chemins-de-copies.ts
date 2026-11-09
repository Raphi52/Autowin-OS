/**
 * Racine unique des copies de tâche : `copies-de-taches\<tâche>`, où la tâche est l'identifiant du fil
 * ou du run. C'est là que naissent toutes les copies, de fil comme d'agent.
 *
 * Les copies d'agent rangées sous l'ancienne racine (`worktrees\<dépôt>\agent__<run>`) restent lisibles
 * et reprenables jusqu'à leur retrait : ce module sait encore les nommer, il ne les crée plus.
 *
 * Ce module calcule seulement où une copie doit vivre. Il ne déplace ni ne crée rien.
 */
import { basename, dirname, join } from 'node:path'

export const NOM_RACINE_COPIES_DE_TACHES = 'copies-de-taches'

/* Ni point ni séparateur : un identifiant ne peut ni contenir `..` ni sortir de la racine. */
const IDENTIFIANT_DE_TACHE = /^[A-Za-z0-9_-]{1,128}$/

export function racineDesCopiesDeTaches(dossierDeDonnees: string): string {
  return join(dossierDeDonnees, NOM_RACINE_COPIES_DE_TACHES)
}

/** Le dossier de la copie d'une tâche, ou `null` si son identifiant ne peut pas nommer un dossier. */
export function dossierDeCopieDeTache(racine: string, tache: string): string | null {
  if (!IDENTIFIANT_DE_TACHE.test(tache)) return null
  return join(racine, tache)
}

/** Le nom du dossier d'une copie d'agent rangée sous l'ancienne racine, tel que l'état de version 1 le nomme. */
export function nomCopieAgentHeritee(runId: string): string {
  return `agent__${runId}`
}

/** Un identifiant de fil commence toujours par ce préfixe : il ne peut pas désigner une copie d'agent. */
export const PREFIXE_IDENTIFIANT_DE_FIL = 'conv-'

/** Dossiers transitoires de la primitive de copie : jamais une copie, ni de fil ni d'agent. */
const MARQUEURS_DE_LA_RACINE = ['a-supprimer__', 'en-creation__', 'entree-en-attente__']

/** Un dossier de la racine unique est la copie d'un fil s'il porte un identifiant de fil. */
export function estUneCopieDeFil(nom: string): boolean {
  return nom.startsWith(PREFIXE_IDENTIFIANT_DE_FIL)
}

/**
 * Un dossier de la racine unique est la copie d'un agent (run ou commande) : un identifiant valide,
 * qui n'est ni un fil ni un marqueur. Le ménage des fils l'ignore, il ne l'a jamais rangée.
 */
export function estUneCopieDAgent(nom: string): boolean {
  return (
    IDENTIFIANT_DE_TACHE.test(nom) &&
    !estUneCopieDeFil(nom) &&
    !MARQUEURS_DE_LA_RACINE.some((marqueur) => nom.startsWith(marqueur))
  )
}

/** L'identifiant d'un dossier rangé sous l'ancienne racine (`agent__<id>`), ou `undefined`. */
export function agentIdDeCopieHeritee(nom: string): string | undefined {
  return nom.startsWith('agent__') ? nom.slice('agent__'.length) : undefined
}

/** L'identifiant d'un dossier rangé sous la racine unique : son nom même, s'il est une copie d'agent. */
export function agentIdDeCopieNeuve(nom: string): string | undefined {
  return estUneCopieDAgent(nom) ? nom : undefined
}

/**
 * Le run d'une copie de run, d'après son dossier : `agent__run-<id>` sous l'ancienne racine, `run-<id>`
 * sous la racine unique. Une copie de commande ou de fil n'a pas de run : `undefined`.
 */
export function runDUneCopieDeRun(dossier: string): string | undefined {
  const nom = basename(dossier)
  const heritee = agentIdDeCopieHeritee(nom)
  if (heritee !== undefined) return heritee.startsWith('run-') ? heritee : undefined
  const neuve = agentIdDeCopieNeuve(nom)
  const sousLaRacineUnique = basename(dirname(dossier)) === NOM_RACINE_COPIES_DE_TACHES
  return sousLaRacineUnique && neuve?.startsWith('run-') ? neuve : undefined
}

/**
 * Où naît la copie d'un agent : sous la racine unique, par le même calcul que les copies de fil.
 * `null` si la racine est absente ou si l'identifiant ne peut pas nommer un dossier.
 */
export function cheminNeufDeCopieAgent(racine: string | undefined, agentId: string): string | null {
  // fix-ok: une copie d'agent n'a de chemin neuf que sous la racine unique : sans elle, il n'y a pas de chemin à rendre.
  if (racine === undefined) return null
  return dossierDeCopieDeTache(racine, agentId)
}

/** L'emplacement d'avant la racine unique d'une copie d'agent : une copie existante y reste. */
export function cheminAncienDeCopieAgent(racineAncienne: string, agentId: string): string {
  return join(racineAncienne, nomCopieAgentHeritee(agentId))
}
