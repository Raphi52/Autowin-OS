import { isAbsolute, relative, resolve } from 'node:path'
import { isForbidden } from './edit-file-command'

/**
 * LE BUREAU DOIT PORTER LE FICHIER QUE L'AGENT A LU — pas celui du dernier commit.
 *
 * DEFAUT MESURE le 2026-08-30 : `edit_file` lit et ecrit dans un bureau isole cree par
 * `git worktree add` sur `baseSha` (voire sur `origin/main`, cf. `describeForLaunch`), et
 * `excludedDirtyFiles` NOMME lui-meme ce que la copie ecarte : tous les changements NON COMMITTES
 * de l'espace de travail. Or l'agent construit son `oldText` a partir de `read_file`, qui lit
 * l'espace de travail VIVANT. Les deux lectures ne portent donc pas sur le meme texte des qu'un
 * fichier est sale — l'etat NORMAL d'un depot en cours de travail.
 *
 * Consequences observees : « texte a remplacer introuvable » sur un extrait pourtant present a
 * l'ecran (edition perdue, agent renvoye a la devinette), et — pire — quand l'extrait existe dans
 * les DEUX versions, une edition appliquee a la version PERIMEE puis publiee, ce qui ECRASE le
 * travail non committe de l'utilisateur.
 *
 * LA CORRECTION EST A LA SOURCE, pas dans un message : avant l'edition, la CIBLE NOMMEE (elle
 * seule) est resynchronisee depuis l'espace de travail vivant vers le bureau. L'edition porte alors
 * sur le texte que l'agent a lu. Rien d'autre n'est copie : le bureau reste isole pour tout le
 * reste, et le geste est borne a un fichier deja borne par `decideEdit`.
 */

export type DecisionSynchronisation =
  | { action: 'copier'; cheminBureau: string; cheminWorkspace: string }
  | { action: 'aucune'; raison: string }

/**
 * Decide PUREMENT s'il faut recopier la cible du workspace vers le bureau.
 *
 * `lireOctets` rend `undefined` quand le fichier n'existe pas. On ne copie que si les deux existent
 * et different : creer un fichier absent du bureau serait sortir du perimetre de `edit_file` (qui
 * ne cree pas de fichier), et copier a l'identique serait un ecrit inutile.
 */
export function decisionDeSynchronisation(
  cible: string,
  workspace: string | undefined,
  bureau: string | undefined,
  lireOctets: (chemin: string) => Uint8Array | undefined
): DecisionSynchronisation {
  if (!workspace?.trim() || !bureau?.trim()) return { action: 'aucune', raison: 'racine manquante' }
  const racineWorkspace = resolve(workspace)
  const racineBureau = resolve(bureau)
  // Un bureau confondu avec le workspace n'a rien a synchroniser — et se copier sur soi-meme
  // detruirait le fichier.
  if (racineWorkspace === racineBureau) return { action: 'aucune', raison: 'bureau = workspace' }
  const absoluWorkspace = isAbsolute(cible) ? resolve(cible) : resolve(racineWorkspace, cible)
  const relatif = relative(racineWorkspace, absoluWorkspace)
  if (!relatif || relatif.startsWith('..') || isAbsolute(relatif)) {
    return { action: 'aucune', raison: 'cible hors du workspace' }
  }
  const interdit = isForbidden(relatif)
  if (interdit) return { action: 'aucune', raison: interdit }
  const absoluBureau = resolve(racineBureau, relatif)
  const octetsWorkspace = lireOctets(absoluWorkspace)
  const octetsBureau = lireOctets(absoluBureau)
  if (!octetsWorkspace || !octetsBureau) return { action: 'aucune', raison: 'fichier absent' }
  if (memeContenu(octetsWorkspace, octetsBureau)) {
    return { action: 'aucune', raison: 'déjà synchronisé' }
  }
  return { action: 'copier', cheminBureau: absoluBureau, cheminWorkspace: absoluWorkspace }
}

/** Egalite d'OCTETS : la comparaison texte re-encoderait, donc mentirait sur un fichier non-UTF-8. */
function memeContenu(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}
