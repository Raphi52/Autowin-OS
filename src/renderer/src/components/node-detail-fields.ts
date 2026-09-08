/**
 * CHAMPS DE CONNAISSANCE D'UN NŒUD — ce que le panneau de détail a le droit d'afficher.
 *
 * Cause reelle du gel TOTAL de la vue Knowledge (mesuree le 2026-09-08 en interrompant le fil
 * bloque : la pile tournait dans le rendu recursif de l'arbre JSON du panneau) : react-force-graph
 * COLLE sur chaque noeud son objet 3D (`__threeObj`), qui pointe vers la scene — donc vers les 951
 * autres noeuds — et dont chaque enfant renvoie a son parent. Le panneau passait les champs BRUTS
 * du noeud a un arbre recursif sans borne : le rendu ne terminait jamais, et le fil d'affichage
 * etait perdu definitivement (meme JSON.stringify echoue : « circular structure »).
 *
 * On ne filtre donc pas une liste de noms techniques (elle serait toujours en retard d'une version
 * de la bibliotheque) : on ne garde que ce qui est REELLEMENT affichable — primitives, et
 * tableaux / objets simples bornes en profondeur, cycles coupes.
 */

/** Profondeur au-dela de laquelle un champ n'apprend plus rien a un lecteur. */
export const PROFONDEUR_MAX = 6

type Simple = string | number | boolean | null
type Affichable = Simple | Affichable[] | { [cle: string]: Affichable }

function estObjetSimple(valeur: object): boolean {
  const proto = Object.getPrototypeOf(valeur)
  return proto === Object.prototype || proto === null
}

/**
 * Rend la valeur purifiee, ou `undefined` si elle n'a pas sa place dans le panneau (fonction,
 * instance de classe comme un objet 3D, cycle, profondeur depassee).
 */
function purifier(valeur: unknown, profondeur: number, vus: Set<object>): Affichable | undefined {
  if (valeur === null) return null
  const type = typeof valeur
  if (type === 'string' || type === 'number' || type === 'boolean') return valeur as Simple
  if (type !== 'object') return undefined
  if (profondeur >= PROFONDEUR_MAX) return undefined
  const objet = valeur as object
  if (vus.has(objet)) return undefined
  if (!Array.isArray(objet) && !estObjetSimple(objet)) return undefined
  vus.add(objet)
  try {
    if (Array.isArray(objet)) {
      const items: Affichable[] = []
      for (const item of objet) {
        const purifie = purifier(item, profondeur + 1, vus)
        if (purifie !== undefined) items.push(purifie)
      }
      return items
    }
    const garde: { [cle: string]: Affichable } = {}
    for (const [cle, item] of Object.entries(objet)) {
      const purifie = purifier(item, profondeur + 1, vus)
      if (purifie !== undefined) garde[cle] = purifie
    }
    return garde
  } finally {
    vus.delete(objet)
  }
}

/** Les coordonnees de rendu ne disent rien de la connaissance ; le libelle est deja en titre. */
const RENDU_SEUL = new Set(['x', 'y', 'z', 'fx', 'fy', 'fz', 'vx', 'vy', 'vz', 'index', 'label'])

export function champsDeConnaissance(noeud: object): Record<string, unknown> {
  const garde: Record<string, unknown> = {}
  for (const [cle, valeur] of Object.entries(noeud)) {
    if (RENDU_SEUL.has(cle) || valeur === undefined || valeur === null || valeur === '') continue
    const purifie = purifier(valeur, 0, new Set())
    if (purifie === undefined) continue
    garde[cle] = purifie
  }
  return garde
}
