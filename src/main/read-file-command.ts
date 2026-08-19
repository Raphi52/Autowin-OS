/**
 * COMMANDES `read_file` et `find_in_files` — la lecture qui manquait au catalogue.
 *
 * Mesuré le 2026-08-14 sur trois runs réels du scout de veille (conv-1154/1155/1156) : un agent de
 * conversation pouvait ÉDITER un fichier (`edit_file`) mais pas le LIRE — le catalogue n'offrait
 * aucune lecture, et l'agent honnête l'a dit : « je n'ai accès à aucun outil de lecture locale ».
 * Toute tâche d'ANALYSE en conversation était donc structurellement impossible hors pipeline.
 *
 * Mêmes bornes que l'écriture, dans le même esprit (décision PURE, testée, jamais déléguée aux
 * patterns d'un CLI) :
 *   1. confinement au workspace (traversée `..` et chemins absolus extérieurs refusés) ;
 *   2. zones interdites PARTAGÉES avec `edit_file` (`isForbidden` : .git, node_modules, secrets…) —
 *      lire un secret est aussi grave que l'écrire ;
 *   3. volume borné : une lecture rend au plus RANGE_MAX lignes, une recherche au plus
 *      CORRESPONDANCES_MAX correspondances — un agent pagine, il n'aspire pas le dépôt.
 */
import { isAbsolute, join, relative, resolve } from 'node:path'
import { readdirSync } from 'node:fs'
import { isForbidden } from './edit-file-command'

export const RANGE_MAX = 400
export const CORRESPONDANCES_MAX = 80
/** Un fichier plus lourd n'est jamais lu d'un bloc : traces jsonl de plusieurs Mo. */
export const OCTETS_MAX_FICHIER = 4_000_000

export type ReadDecision =
  | { allowed: true; absolutePath: string; relativePath: string; from: number; count: number }
  | { allowed: false; reason: string }

export function decideRead(
  input: { path?: unknown; from?: unknown; lines?: unknown },
  workspace: string | undefined
): ReadDecision {
  if (!workspace || !workspace.trim()) return { allowed: false, reason: 'aucun workspace résolu' }
  if (typeof input.path !== 'string' || !input.path.trim()) {
    return { allowed: false, reason: 'chemin de fichier manquant' }
  }
  const absolutePath = isAbsolute(input.path) ? resolve(input.path) : resolve(workspace, input.path)
  const relativePath = relative(resolve(workspace), absolutePath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return { allowed: false, reason: 'chemin hors du workspace' }
  }
  const forbidden = isForbidden(relativePath)
  if (forbidden) return { allowed: false, reason: forbidden }
  const from =
    Number.isSafeInteger(input.from) && (input.from as number) > 0 ? (input.from as number) : 1
  const wanted =
    Number.isSafeInteger(input.lines) && (input.lines as number) > 0
      ? (input.lines as number)
      : RANGE_MAX
  return { allowed: true, absolutePath, relativePath, from, count: Math.min(wanted, RANGE_MAX) }
}

export interface LectureFichier {
  relativePath: string
  /** Lignes numérotées `n→texte`, prêtes à être citées avec leur ancrage. */
  contenu: string
  totalLignes: number
  tronque: boolean
}

/** `lire` est injecté (rend null si absent/illisible) : la décision et le rendu restent purs. */
export function executeRead(
  decision: Extract<ReadDecision, { allowed: true }>,
  lire: (absolutePath: string) => string | null
): LectureFichier | { erreur: string } {
  const brut = lire(decision.absolutePath)
  if (brut === null)
    return { erreur: `fichier introuvable ou illisible : ${decision.relativePath}` }
  if (brut.length > OCTETS_MAX_FICHIER) {
    return {
      erreur: `fichier trop lourd pour une lecture directe (${brut.length} octets) : cible une plage avec from/lines ou passe par find_in_files`
    }
  }
  const lignes = brut.split(/\r?\n/)
  const debut = Math.min(decision.from, Math.max(1, lignes.length))
  const fin = Math.min(lignes.length, debut + decision.count - 1)
  const extrait = lignes
    .slice(debut - 1, fin)
    .map((texte, index) => `${debut + index}→${texte}`)
    .join('\n')
  return {
    relativePath: decision.relativePath,
    contenu: extrait,
    totalLignes: lignes.length,
    tronque: fin < lignes.length || debut > 1
  }
}

export interface Correspondance {
  chemin: string
  ligne: number
  texte: string
}

/**
 * Recherche PLEIN TEXTE bornée. `listerFichiers`/`lire` sont injectés ; les zones interdites sont
 * filtrées ici même quand l'énumérateur les rend — la frontière ne dépend pas de l'appelant.
 */
export function rechercherDansFichiers(
  motif: string,
  fichiers: readonly string[],
  lire: (relativePath: string) => string | null
): { correspondances: Correspondance[]; tronque: boolean; erreur?: string } {
  let regex: RegExp
  try {
    regex = new RegExp(motif, 'i')
  } catch {
    return { correspondances: [], tronque: false, erreur: `motif illisible : ${motif}` }
  }
  const correspondances: Correspondance[] = []
  for (const chemin of fichiers) {
    if (isForbidden(chemin)) continue
    const contenu = lire(chemin)
    if (contenu === null || contenu.length > OCTETS_MAX_FICHIER) continue
    const lignes = contenu.split(/\r?\n/)
    for (let i = 0; i < lignes.length; i += 1) {
      if (!regex.test(lignes[i])) continue
      correspondances.push({ chemin, ligne: i + 1, texte: lignes[i].slice(0, 300) })
      if (correspondances.length >= CORRESPONDANCES_MAX) {
        return { correspondances, tronque: true }
      }
    }
  }
  return { correspondances, tronque: false }
}

/**
 * Dossiers jamais PARCOURUS : les mêmes zones que l'édition, les artefacts de build, et — depuis le
 * 2026-08-19 — les DONNÉES et les PREUVES.
 *
 * Mesuré en pilotant l'app : un scout a rendu comme candidat à corriger un blob binaire du cache
 * Chrome, ancré dans
 * `Audit/workspaces/20260813-…/app-data/autowin-os/Cache/Cache_Data/f_000075:292`. La liste ne
 * couvrait que les artefacts de BUILD ; le magasin vivant (`.autowin-data` : conversations, runs,
 * worktrees, cache Electron) et les espaces de preuve (`Audit`, qui embarquent des profils
 * applicatifs complets) étaient balayés à chaque recherche, lus comme du texte, et remontaient
 * comme des ancrages de code.
 *
 * L'exclusion porte sur l'ÉNUMÉRATION seule. `read_file` décide par `decideRead`, donc une lecture
 * CIBLÉE dans ces dossiers reste possible, et un appelant qui NOMME le sous-dossier l'énumère encore.
 * On refuse de les balayer à l'aveugle, pas d'y regarder quand on sait ce qu'on cherche.
 */
const DOSSIERS_EXCLUS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'coverage',
  '.autowin-data',
  'Audit',
  'graphify-out'
])

/**
 * Énumère les fichiers lisibles sous la racine (chemins RELATIFS, séparateur `/`), borné pour qu'une
 * recherche ne parcoure jamais un dépôt pathologique en entier. IO assumée : c'est l'énumérateur que
 * `rechercherDansFichiers` (pur) reçoit en entrée.
 */
export function enumererFichiersLisibles(
  racine: string,
  sousDossier = '',
  plafond = 20_000
): string[] {
  const resultat: string[] = []
  const pile = [sousDossier.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')]
  while (pile.length > 0 && resultat.length < plafond) {
    const courant = pile.pop()!
    let entrees
    try {
      entrees = readdirSync(join(racine, courant), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entree of entrees) {
      const relatif = courant ? `${courant}/${entree.name}` : entree.name
      if (entree.isDirectory()) {
        if (!DOSSIERS_EXCLUS.has(entree.name)) pile.push(relatif)
      } else if (entree.isFile()) {
        resultat.push(relatif)
        if (resultat.length >= plafond) break
      }
    }
  }
  return resultat
}
