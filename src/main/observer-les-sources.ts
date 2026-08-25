import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { etatDuMoteur, type EtatDuMoteur, type SourceObservee } from '../shared/moteur-perime'

/**
 * Observe les sources du PROCESSUS PRINCIPAL pour dire si le moteur qui tourne les contient encore.
 *
 * La decision elle-meme vit dans `../shared/moteur-perime` (pure, testee). Ce module ne fait que
 * l'alimenter en dates reelles -- separation deliberee : la regle se teste sans disque, la lecture
 * du disque n'a pas de regle a elle.
 *
 * DEUX DOSSIERS SEULEMENT, `src/main` et `src/preload`. Le RENDERER est exclu a dessein : lui est
 * bien recharge a chaud, donc le signaler perime serait faux -- et un avertissement faux cesse
 * d'etre lu.
 */

const DOSSIERS_DU_MOTEUR = [join('src', 'main'), join('src', 'preload')]

/** Bornes : ce balayage sert un pied de page, il ne doit jamais couter un gel de l'interface. */
const PROFONDEUR_MAX = 6
const FICHIERS_MAX = 4_000

function balayer(
  racine: string,
  relatif: string,
  profondeur: number,
  acc: SourceObservee[]
): void {
  if (profondeur > PROFONDEUR_MAX || acc.length >= FICHIERS_MAX) return
  // Le type est ANNOTE plutot que deduit : `ReturnType<typeof readdirSync>` prend la surcharge
  // « buffer » de la signature, et les noms d'entrees deviennent alors des tampons, pas des chaines.
  let entrees: Dirent[]
  try {
    entrees = readdirSync(join(racine, relatif), { withFileTypes: true })
  } catch {
    // Un dossier illisible n'est pas une anomalie a signaler : en PACKAGE il n'y a simplement pas
    // d'arborescence source. On s'abstient, on ne crie pas.
    return
  }
  for (const entree of entrees) {
    if (acc.length >= FICHIERS_MAX) return
    const chemin = join(relatif, entree.name)
    if (entree.isDirectory()) {
      if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue
      balayer(racine, chemin, profondeur + 1, acc)
      continue
    }
    if (!entree.isFile()) continue
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entree.name)) continue
    // Les tests ne partent pas dans le binaire : les compter ferait crier « moteur perime » a chaque
    // fois qu'on ecrit un test, ce qui est exactement le faux positif a eviter.
    if (/\.test\.[cm]?[jt]sx?$/.test(entree.name)) continue
    try {
      acc.push({ chemin: chemin.split('\\').join('/'), modifieeMs: statSync(join(racine, chemin)).mtimeMs })
    } catch {
      // Fichier disparu entre le listage et la lecture : il ne prouve rien, on l'ignore.
    }
  }
}

/**
 * L'etat du moteur, lu sur le disque.
 *
 * `racineProjet` absente ou illisible (cas PACKAGE) rend « non perime » : l'absence de sources n'est
 * pas une preuve de peremption.
 */
export function observerLeMoteur(
  racineProjet: string,
  demarrageMs: number,
  empaquete: boolean
): EtatDuMoteur {
  // En PACKAGE, le code embarque ne peut pas etre plus vieux que des sources qui n'existent pas.
  if (empaquete) return { perime: false }
  const sources: SourceObservee[] = []
  for (const dossier of DOSSIERS_DU_MOTEUR) balayer(racineProjet, dossier, 0, sources)
  return etatDuMoteur(demarrageMs, sources)
}
