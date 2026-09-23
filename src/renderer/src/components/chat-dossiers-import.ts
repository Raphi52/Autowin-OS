import { canonicalProjectPath, estCheminDeDossier } from '../../../shared/project-path'

/**
 * FUSION des projets claude.exe dans la liste des dossiers du Chat (conv-5, 2026-09-23).
 *
 * La règle qui commande ce module : le RETRAIT VOLONTAIRE PRIME SUR L'IMPORT. La liste mémorisée
 * a déjà une règle de conception (ChatView) — un dossier retiré par la croix ne revient que sur un
 * geste explicite. Un import rejoué à chaque lancement la violerait en ressuscitant le dossier à
 * chaque démarrage : la croix deviendrait inopérante. D'où la mémoire des retraits (`retires`),
 * distincte de la liste, que seul un ré-ajout manuel efface.
 *
 * Toutes les comparaisons passent par la forme canonique partagée, en ignorant la casse :
 * `E:/x`, `e:\x\` et `E:\x` sont le MÊME dossier Windows — sans cela, l'import recréerait en
 * double une entrée déjà présente sous l'autre séparateur, ou raterait un retrait.
 */
export function fusionnerDossiersImportes(
  connus: readonly string[],
  importes: readonly unknown[],
  retires: readonly string[]
): string[] | null {
  const clesRetirees = new Set(clesCanoniques(retires))
  const clesConnues = new Set(clesCanoniques(connus))
  const ajouts: string[] = []
  for (const brut of importes) {
    // Défense en profondeur : le main filtre déjà, mais ce qui traverse un pont se revalide.
    if (typeof brut !== 'string' || !estCheminDeDossier(brut)) continue
    const canon = canonicalProjectPath(brut)
    if (!canon) continue
    const cle = canon.toLowerCase()
    if (clesRetirees.has(cle) || clesConnues.has(cle)) continue
    clesConnues.add(cle)
    ajouts.push(canon)
  }
  // `null` = rien à faire : l'appelant ne réécrit pas un état identique (pas de re-rendu inutile).
  return ajouts.length > 0 ? [...connus, ...ajouts] : null
}

/** Enregistre un retrait volontaire : ce chemin ne sera plus jamais ré-importé. */
export function avecDossierRetire(retires: readonly string[], chemin: string): string[] {
  const canon = canonicalProjectPath(chemin)
  if (!canon) return [...retires]
  const cle = canon.toLowerCase()
  return [...retires.filter((r) => canonicalProjectPath(r)?.toLowerCase() !== cle), canon]
}

/** Efface un retrait : ré-ajouter un dossier À LA MAIN rouvre la porte à son import. */
export function sansDossierRetire(retires: readonly string[], chemin: string): string[] {
  const cle = canonicalProjectPath(chemin)?.toLowerCase()
  if (!cle) return [...retires]
  return retires.filter((r) => canonicalProjectPath(r)?.toLowerCase() !== cle)
}

function clesCanoniques(chemins: readonly string[]): string[] {
  return chemins
    .map((chemin) => canonicalProjectPath(chemin)?.toLowerCase())
    .filter((cle): cle is string => !!cle)
}
