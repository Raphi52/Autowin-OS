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

/**
 * La valeur DESIGNE-T-ELLE un dossier, ou n'est-ce qu'un libellé de classement ?
 *
 * C'est la frontière entre les deux rôles que `projectPath` portait seul (conv-81, 2026-09-16) :
 * un dossier de travail (`D:\GIT\RigApplication`, `\\serveur\partage\Projet`) et une catégorie de
 * la barre latérale (« Perso », « Clients/Amitel »). Écrire un libellé dans le dossier de travail
 * faisait partir le tour dans le dépôt d'Autowin, et polluait la liste des dossiers connus.
 *
 * Reconnaît ce qu'un poste Windows sait ouvrir : une lettre de lecteur suivie d'un séparateur, ou
 * un partage réseau. Rien d'autre — `Clients/Amitel` ressemble à un chemin sans en être un, et
 * c'est précisément le cas qui a créé le défaut. Ne touche PAS le disque : on juge la FORME, pas
 * l'existence — un dossier absent reste un dossier (il est signalé ailleurs,
 * `bascule-dossier-conversation.ts`), alors qu'un libellé n'en sera jamais un.
 *
 * Vit dans `shared/` parce que le renderer en a besoin pour filtrer sa liste de dossiers connus,
 * et le main pour router les écritures : une seconde définition les ferait diverger.
 * fix-ok: conv-81 — cause mesurée : UN SEUL champ (projectPath) portait à la fois le dossier de travail de l'agent et le libellé de catégorie de la barre latérale. Cette fonction est la frontière de forme qui les sépare, et elle vit dans shared/ pour que main et renderer ne divergent pas.
 */
export function estCheminDeDossier(brut: string | null | undefined): boolean {
  const propre = brut?.trim()
  if (!propre) return false
  return /^[A-Za-z]:[\\/]/.test(propre) || /^\\\\[^\\/]+[\\/]/.test(propre)
}
