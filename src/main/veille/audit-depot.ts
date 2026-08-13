import { readdirSync, readFileSync, statSync } from 'node:fs'
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
export function lireSourcesDuDepot(racine: string, dossiers = ['src', 'scripts']): FichierAudite[] {
  const fichiers: FichierAudite[] = []
  const parcourir = (dossier: string): void => {
    let entrees: string[]
    try {
      entrees = readdirSync(dossier)
    } catch {
      // Un dossier absent n'est pas une panne : un dépôt sans `scripts/` reste auditable.
      return
    }
    for (const entree of entrees) {
      if (IGNORES.has(entree) || entree.startsWith('.')) continue
      const chemin = join(dossier, entree)
      let estDossier = false
      try {
        estDossier = statSync(chemin).isDirectory()
      } catch {
        // Fichier disparu entre le listing et le stat (un autre agent écrit dans l'arbre) : on
        // l'ignore plutôt que de faire échouer toute la passe pour une entrée volatile.
        continue
      }
      if (estDossier) {
        parcourir(chemin)
        continue
      }
      if (!EXTENSIONS.test(entree)) continue
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
