/**
 * La forme CANONIQUE d'un chemin de dossier de travail.
 *
 * `C:/Clients`, `C:\Clients\` et ` C:\Clients ` désignent le MÊME dossier : sans canonisation ils
 * font trois groupes distincts dans la liste et trois entrées dans le sélecteur. Règle : `trim`,
 * séparateurs vers `\`, séparateur final retiré, lettre de lecteur en MAJUSCULE.
 *
 * La casse du RESTE du chemin est laissée intacte à dessein : la minusculiser fusionnerait bien
 * `c:\clients` et `C:\Clients`, mais dégraderait le libellé rendu par `nomDeDossier` (« clients »).
 * Deux dossiers homonymes de chemins différents (`C:\Clients` / `D:\Clients`) ne fusionnent donc
 * toujours pas — cicatrice délibérée, cf. `conversation-groups.ts`.
 *
 * Rend `undefined` pour ce qui ne désigne aucun dossier (vide, espaces, séparateurs seuls).
 *
 * Vit dans `shared/` et non dans le store parce que le RENDERER en a besoin lui aussi : le chemin
 * canonisé EST la clé de groupe, et cette clé sert d'identité à l'état plié/déplié persisté dans
 * `localStorage`. Une seconde définition les ferait diverger, et une divergence ici déplierait
 * silencieusement tous les dossiers de la barre latérale.
 */
export function canonicalProjectPath(raw: string | null | undefined): string | undefined {
  const propre = raw?.trim().replace(/\//g, '\\').replace(/\\+$/, '')
  if (!propre) return undefined
  return /^[a-z]:/.test(propre) ? propre[0].toUpperCase() + propre.slice(1) : propre
}
