import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { auditerDepot, candidatsDepuisAudit, type FichierAudite } from './audit-interne'
import type { CandidatBrut } from './candidats'

/**
 * LECTURE DU DÉPÔT pour l'audit interne — le seul endroit de ce mécanisme qui touche au disque.
 *
 * `audit-interne` est volontairement PUR : il reçoit des fichiers déjà lus, donc il se teste sans
 * disque ni réseau. Ce module-ci porte l'impureté, et rien d'autre : il parcourt, il lit, il délègue.
 *
 * Il existe pour que le dernier maillon soit un APPEL, pas un chantier : la passe accepte déjà
 * `candidatsInternes`, et personne ne les lui fournit — « exposé mais jamais appelé », le défaut que
 * ce module détecte par ailleurs. Le câblage final appartient au runtime de la veille (en cours
 * d'écriture ailleurs) ; il n'aura qu'à passer le résultat de `candidatsInternesDuDepot()`.
 */

/** Dossiers dont le contenu n'est jamais du code du produit. */
const IGNORES = new Set(['node_modules', 'out', 'dist', 'coverage', 'artifacts'])

/**
 * Extensions retenues.
 *
 * `.mjs` en fait partie, et ce n'est pas anodin : les scripts de pilotage CDP sont écrits en `.mjs`
 * et comptent comme APPELANTS légitimes d'un canal IPC. Les omettre faisait passer `captureTestPage`,
 * `appState` et `fabricNodes` pour du code mort — trois faux positifs mesurés avant correction.
 */
const EXTENSIONS = /\.(ts|tsx|css|mjs)$/

/**
 * Lit les sources du dépôt, dans les racines qui portent le produit.
 *
 * `scripts/` est inclus au même titre que `src/` : c'est là que vivent les pilotes de test, et un
 * détecteur qui ne les voit pas conclut à tort qu'une surface est morte.
 */
/**
 * Bornes de la lecture — deux candidats sortis par le SCOUT DE L'APP le 2026-08-19 (scores 94 et 89),
 * confirmes par son juge (« suivi de liens et lecture integrale dans audit-depot.ts:51,63-65 ») puis
 * verifies dans le code avant correction.
 *
 * `plafondFichiers` et `plafondOctets` ne mordent jamais sur un depot sain : `src` + `scripts` pesent
 * ~1 100 fichiers. Les atteindre signale une racine anormale — un dossier de donnees oublie, une
 * copie de run — et c'est precisement le cas ou une lecture integrale devenait plusieurs gigaoctets.
 * Mesure du meme jour sur ce depot : `Audit/` pese 11 Go pour 21 488 fichiers.
 *
 * `onEcarte` rend la troncature VISIBLE : un plafond silencieux se lirait comme « rien de plus a
 * auditer ». L'appelant peut l'ignorer, il ne peut plus etre trompe sans l'avoir voulu.
 */
export interface BornesLecture {
  plafondFichiers?: number
  plafondOctets?: number
  onEcarte?: (chemin: string, raison: 'lien' | 'trop-gros' | 'plafond') => void
}

const PLAFOND_FICHIERS = 5_000
const PLAFOND_OCTETS = 1_000_000

export function lireSourcesDuDepot(
  racine: string,
  dossiers = ['src', 'scripts'],
  bornes: BornesLecture = {}
): FichierAudite[] {
  const plafondFichiers = bornes.plafondFichiers ?? PLAFOND_FICHIERS
  const plafondOctets = bornes.plafondOctets ?? PLAFOND_OCTETS
  const ecarte = (chemin: string, raison: 'lien' | 'trop-gros' | 'plafond'): void => {
    bornes.onEcarte?.(relative(racine, chemin).split(sep).join('/'), raison)
  }
  const fichiers: FichierAudite[] = []
  const parcourir = (dossier: string): void => {
    if (fichiers.length >= plafondFichiers) return
    let entrees: string[]
    try {
      entrees = readdirSync(dossier)
    } catch {
      // Un dossier absent n'est pas une panne : un dépôt sans `scripts/` reste auditable.
      return
    }
    for (const entree of entrees) {
      if (IGNORES.has(entree) || entree.startsWith('.')) continue
      if (fichiers.length >= plafondFichiers) {
        ecarte(join(dossier, entree), 'plafond')
        return
      }
      const chemin = join(dossier, entree)
      let infos
      try {
        // `lstatSync` et NON `statSync` : celui-ci SUIT les liens, donc une jonction NTFS ou un lien
        // symbolique pose sous `src/` faisait sortir l'audit du depot — il lisait, et remontait comme
        // « code du produit », des fichiers vivant ailleurs (autre depot, partage reseau, copie de
        // run). Ce depot en fabrique reellement : worktrees isoles, jonctions temporaires.
        infos = lstatSync(chemin)
      } catch {
        // Fichier disparu entre le listing et le stat (un autre agent écrit dans l'arbre) : on
        // l'ignore plutôt que de faire échouer toute la passe pour une entrée volatile.
        continue
      }
      if (infos.isSymbolicLink()) {
        ecarte(chemin, 'lien')
        continue
      }
      if (infos.isDirectory()) {
        parcourir(chemin)
        continue
      }
      if (!EXTENSIONS.test(entree)) continue
      if (infos.size > plafondOctets) {
        // ECARTE, jamais tronque : la moitie d'un fichier ferait conclure a l'absence d'un appelant
        // qui vit dans la moitie manquante. Un faux « code mort » coute une suppression a tort.
        ecarte(chemin, 'trop-gros')
        continue
      }
      try {
        fichiers.push({
          chemin: relative(racine, chemin).split(sep).join('/'),
          contenu: readFileSync(chemin, 'utf8')
        })
      } catch {
        continue
      }
    }
  }
  for (const dossier of dossiers) parcourir(join(racine, dossier))
  return fichiers
}

/**
 * Les défauts du dépôt, au format d'entrée de la veille — prêts pour `executerPasse`.
 *
 * `plafond` borne ce qui part dans une passe : la colonne doit rester lisible, et cinquante entrées
 * d'un coup reproduiraient le défaut qu'on corrige. Les constats sont déjà triés par score, donc le
 * plafond garde les plus rentables. Ce qui est écarté n'est pas perdu : la passe suivante le reverra,
 * et la déduplication empêchera les doublons.
 */
export function candidatsInternesDuDepot(
  racine: string,
  options: { maintenant?: string; plafond?: number } = {}
): CandidatBrut[] {
  const maintenant = options.maintenant ?? new Date().toISOString()
  const plafond = options.plafond ?? 12
  const constats = auditerDepot(lireSourcesDuDepot(racine))
  return candidatsDepuisAudit(constats.slice(0, plafond), maintenant)
}
