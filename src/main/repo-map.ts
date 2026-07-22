import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Repo-map graphify injecté dans le contexte du sous-agent (#1 — baisse du résiduel lecture).
 *
 * Le sous-agent d'orchestration dépense un résiduel important en LECTURE agentique du dépôt
 * (grep/Read fichier par fichier à chaque phase). Le graphe graphify du repo produit déjà un
 * résumé humain-lisible et BORNÉ (`graphify-out/GRAPH_REPORT.md` : hubs de communauté, stats,
 * arborescence condensée). On l'injecte UNE fois en tête de contexte → le sous-agent part de la
 * carte du code au lieu de la reconstruire par lecture brute.
 *
 * Contrat calqué sur `context-files.ts` (même plafond en BYTES, même dégradation gracieuse) :
 * - source unique, premier-trouvé-gagne (snapshot horodaté récent préféré à la racine) ;
 * - borné à `REPO_MAP_MAX_BYTES` (un résumé géant ré-augmenterait les tokens qu'on veut baisser) ;
 * - absent/illisible (graphe non généré, `graphify-out/` gitignoré non présent) → '' , le run
 *   continue exactement comme aujourd'hui (le sous-agent lit le dépôt, comportement inchangé).
 *
 * Provider-agnostique : c'est du texte injecté dans le message user, aucune dépendance modèle.
 */

/** Plafond de lecture (garde-fou : un résumé géant ne doit pas noyer le contexte ni gonfler les tokens). */
export const REPO_MAP_MAX_BYTES = 32_768

/** Fichiers candidats sous `graphify-out/`, premier-trouvé-gagne (résumé condensé d'abord). */
export const REPO_MAP_CHAIN: string[] = ['GRAPH_REPORT.md']

/** Fichier de provenance (commit + date) pour tracer la fraîcheur du graphe. */
const SOURCE_FILE = 'SOURCE.md'

export interface RepoMap {
  file: string
  content: string
  freshness?: string
}

/**
 * Lit une ligne de provenance courte (commit/date) depuis `graphify-out/SOURCE.md` si présent.
 * Best-effort : la fraîcheur est indicative, son absence n'empêche jamais l'injection.
 */
function readFreshness(graphDir: string): string | undefined {
  try {
    const path = join(graphDir, SOURCE_FILE)
    if (!existsSync(path) || !statSync(path).isFile()) return undefined
    const raw = readFileSync(path, 'utf8')
    // On extrait la première ligne signifiante (commit / date de génération) pour un marqueur court.
    const line = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#'))
    return line ? line.slice(0, 200) : undefined
  } catch {
    return undefined
  }
}

/**
 * Résout le repo-map du workspace : `graphify-out/GRAPH_REPORT.md`, borné. Rend `null` si absent
 * (cas courant si le graphe n'a pas été généré) — lecture défensive, une source illisible → null.
 */
export function loadRepoMap(
  workspace: string,
  chain: string[] = REPO_MAP_CHAIN,
  maxBytes: number = REPO_MAP_MAX_BYTES
): RepoMap | null {
  const graphDir = join(workspace, 'graphify-out')
  for (const file of chain) {
    const path = join(graphDir, file)
    try {
      if (!existsSync(path) || !statSync(path).isFile()) continue
      // Mesure en BYTES réels (cf. context-files.ts) : un doc FR accentué a 1 char ≈ 2 bytes.
      const buf = readFileSync(path)
      let content: string
      if (buf.byteLength > maxBytes) {
        const head = new TextDecoder('utf-8').decode(buf.subarray(0, maxBytes)).replace(/�+$/, '')
        content = `${head}\n…[tronqué]`
      } else {
        content = buf.toString('utf8')
      }
      if (content.trim().length === 0) continue
      return { file, content, freshness: readFreshness(graphDir) }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Bloc à injecter en tête de contexte (vide si aucun graphe). Étiqueté + fraîcheur pour la
 * traçabilité, et une consigne au sous-agent : se servir de la carte AVANT de lire le dépôt.
 */
export function repoMapBlock(
  workspace: string,
  chain: string[] = REPO_MAP_CHAIN,
  maxBytes: number = REPO_MAP_MAX_BYTES
): string {
  const map = loadRepoMap(workspace, chain, maxBytes)
  if (!map) return ''
  const fresh = map.freshness ? ` — ${map.freshness}` : ''
  return (
    `\n=== CARTE DU CODE (repo-map graphify : ${map.file}${fresh}) ===\n` +
    `${map.content}\n` +
    `Sers-toi de cette CARTE pour localiser le code ; ne lis un fichier du dépôt que si la carte ne suffit pas.\n`
  )
}
