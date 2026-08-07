import type { GraphNode } from './graph-view-model'

/**
 * CHEMINS du vault — comment retrouver, à partir d'un nœud du graphe, sa place réelle dans le brain.
 *
 * Ces deux fonctions viennent de `graph-radial-layout.ts`, supprimé avec le mode « anneaux par
 * famille » dont il portait la géométrie. Elles ont survécu parce qu'elles ne parlent pas de
 * géométrie du tout : elles disent OÙ VIT une fiche, ce dont l'arborescence et le rattachement par
 * sujet ont besoin. Les laisser dans un fichier nommé « radial-layout » aurait été une étiquette
 * mensongère de plus.
 */

/**
 * Familles connues du vault. Elles ne servent plus à dessiner quoi que ce soit : elles servent
 * d'ANCRE pour retrouver le début du chemin relatif dans un chemin UNC absolu.
 */
const ANCRES_VAULT = new Set([
  'knowledge',
  'projects',
  'governance',
  'integrations',
  'inbox',
  '.trash'
])

/** Segments du chemin, les DEUX séparateurs gérés : le brain vit sur un partage Windows. */
export function pathSegments(file: string | undefined): string[] {
  return (file ?? '')
    .split(/[/\\]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/**
 * Chemin RELATIF au brain — la seule forme exploitable pour situer une fiche.
 *
 * MESURÉ dans l'app en fonctionnement : `node.file` est un chemin UNC ABSOLU
 * (`\\ged2\rig\Projets IA\Amitel Brain\knowledge\_maps\x.md`), dont le 1ᵉʳ segment est le nom du
 * SERVEUR. `node.id` porte le chemin relatif propre et c'est la clé stable de l'app : on le préfère,
 * et on ne retombe sur `file` (via une ancre de famille) que si l'id n'est pas un chemin.
 */
export function relativePathOf(node: Pick<GraphNode, 'id' | 'file'>): string {
  const id = String(node.id ?? '')
  if (/[/\\]/.test(id) && !/^\\\\/.test(id) && !/^[A-Za-z]:/.test(id)) return id
  const segments = pathSegments(node.file)
  const anchor = segments.findIndex((segment) => ANCRES_VAULT.has(segment))
  if (anchor >= 0) return segments.slice(anchor).join('/')
  // Cause reproduite par test : une fiche à la RACINE du brain a un id sans séparateur ET un chemin
  // absolu sans dossier d'ancrage — son premier segment devenait le nom du SERVEUR (`ged2`). On ne
  // garde que le nom du fichier, ce qui la place bien à la racine.
  return segments.at(-1) ?? ''
}
