import { isAbsolute, relative, resolve } from 'node:path'
import { isForbidden, refusRacineSysteme } from './edit-file-command'

/**
 * COMMANDES DE FICHIER — creer, deplacer, supprimer.
 *
 * POURQUOI (2026-09-09, scout interne) : le catalogue n'exposait QUE `edit_file`, qui remplace un
 * extrait UNIQUE et EXISTANT (`edit-file-command.ts` : « fichier inexistant (cette commande ne cree
 * pas de fichier) »). Un agent ne pouvait donc ni creer un fichier neuf, ni en deplacer un, ni en
 * supprimer un — sauf par le contournement `run node -e "..."`, qui echappe justement a toutes les
 * bornes ci-dessous. Fermer le trou en OUVRANT la porte gardee vaut mieux que de laisser la porte
 * derobee.
 *
 * Les bornes sont EXACTEMENT celles d'`edit_file`, reutilisees telles quelles (pas de seconde
 * definition qui pourrait deriver) :
 *   1. un chemin RELATIF reste dans le workspace (traversee `..` refusee) ;
 *   2. un chemin ABSOLU est accepte hors workspace, sauf racines SYSTEME (`refusRacineSysteme`) ;
 *   3. jamais `.git/`, `node_modules/`, `dist/`, `out/`, ni un fichier de secrets (`isForbidden`).
 * S'y ajoutent les bornes propres a chaque geste : creer refuse d'ECRASER, deplacer et supprimer
 * refusent une cible ABSENTE (donc jamais d'effet muet).
 */

export type CibleLocalisee = { absolutePath: string; relativePath: string; externe: boolean }

/** Localisation + zones interdites, communes aux trois gestes. Rend un motif de refus, ou la cible. */
export function localiserCible(
  path: unknown,
  workspace: string | undefined,
  etiquette = 'chemin'
): { refus: string } | CibleLocalisee {
  if (!workspace || !workspace.trim()) return { refus: 'aucun workspace résolu' }
  if (typeof path !== 'string' || !path.trim()) return { refus: `${etiquette} de fichier manquant` }
  const relatifDemande = !isAbsolute(path)
  const absolutePath = relatifDemande ? resolve(workspace, path) : resolve(path)
  const relativePath = relative(resolve(workspace), absolutePath)
  const externe = !relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)
  if (externe && relatifDemande) return { refus: `${etiquette} hors du workspace` }
  if (externe) {
    // Le chemin RESOLU et le chemin DEMANDE sont juges tous les deux : sous Windows,
    // `resolve('/etc/x')` ancre sur le disque courant et la racine POSIX ne survit qu'au brut.
    const refusSysteme = refusRacineSysteme(absolutePath) ?? refusRacineSysteme(path)
    if (refusSysteme) return { refus: refusSysteme }
  }
  const forbidden = isForbidden(externe ? absolutePath : relativePath)
  if (forbidden) return { refus: forbidden }
  return {
    absolutePath,
    relativePath: (externe ? absolutePath : relativePath).replace(/\\/g, '/'),
    externe
  }
}

export type CreateDecision =
  | { allowed: true; absolutePath: string; relativePath: string; content: string; externe: boolean }
  | { allowed: false; reason: string }

/** `exists` est injecte pour rester pur et testable. */
export function decideCreateFile(
  input: { path?: unknown; content?: unknown },
  workspace: string | undefined,
  exists: (absolutePath: string) => boolean
): CreateDecision {
  const cible = localiserCible(input.path, workspace)
  if ('refus' in cible) return { allowed: false, reason: cible.refus }
  if (typeof input.content !== 'string') {
    return { allowed: false, reason: 'contenu manquant (une chaîne est attendue, même vide)' }
  }
  if (exists(cible.absolutePath)) {
    // CREER n'ECRASE JAMAIS : sans cette borne, `create_file` deviendrait un « write_file » capable
    // d'effacer un fichier entier d'un seul appel — exactement ce qu'`edit_file` interdit depuis
    // l'origine en n'acceptant qu'un remplacement d'extrait.
    return {
      allowed: false,
      reason: 'le fichier existe déjà (cette commande n’écrase pas : utilise edit_file)'
    }
  }
  return { allowed: true, ...cible, content: input.content }
}

export type MoveDecision =
  | {
      allowed: true
      sourceAbsolue: string
      sourceRelative: string
      cibleAbsolue: string
      cibleRelative: string
      externe: boolean
    }
  | { allowed: false; reason: string }

export function decideMoveFile(
  input: { from?: unknown; to?: unknown },
  workspace: string | undefined,
  exists: (absolutePath: string) => boolean
): MoveDecision {
  const source = localiserCible(input.from, workspace, 'origine')
  if ('refus' in source) return { allowed: false, reason: source.refus }
  const cible = localiserCible(input.to, workspace, 'destination')
  if ('refus' in cible) return { allowed: false, reason: cible.refus }
  if (source.absolutePath === cible.absolutePath) {
    return {
      allowed: false,
      reason: 'origine et destination identiques — aucun déplacement demandé'
    }
  }
  if (!exists(source.absolutePath)) {
    return { allowed: false, reason: 'fichier d’origine inexistant' }
  }
  if (exists(cible.absolutePath)) {
    return { allowed: false, reason: 'la destination existe déjà (ce déplacement n’écrase pas)' }
  }
  return {
    allowed: true,
    sourceAbsolue: source.absolutePath,
    sourceRelative: source.relativePath,
    cibleAbsolue: cible.absolutePath,
    cibleRelative: cible.relativePath,
    externe: source.externe || cible.externe
  }
}

export type DeleteDecision =
  | { allowed: true; absolutePath: string; relativePath: string; externe: boolean }
  | { allowed: false; reason: string }

export function decideDeleteFile(
  input: { path?: unknown },
  workspace: string | undefined,
  exists: (absolutePath: string) => boolean
): DeleteDecision {
  const cible = localiserCible(input.path, workspace)
  if ('refus' in cible) return { allowed: false, reason: cible.refus }
  if (!exists(cible.absolutePath)) {
    return { allowed: false, reason: 'fichier inexistant — rien à supprimer' }
  }
  return { allowed: true, ...cible }
}

/**
 * IDENTIFIANT DE COPIE DE TRAVAIL — la MEME garde que les canaux d'interface
 * (`src/main/ipc/worktree.ts`), reprise ici parce qu'une commande du bus ne passe PAS par
 * `assertTrustedRendererSender` : c'est cette expression qui empeche un identifiant fabrique
 * d'atteindre le disque.
 */
export function identifiantDeBureauValide(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && /^[A-Za-z0-9_-]+$/.test(valeur)
}
