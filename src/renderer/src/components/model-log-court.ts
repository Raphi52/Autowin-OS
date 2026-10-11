/**
 * Raccourcis D'AFFICHAGE pour la ligne unique du panneau Logs (conv-247, 2026-10-11 : maquette
 * « tour 4 » choisie par l'utilisateur, pistes 2 + 3 + 4). Sur une ligne de ~200 px, le titre
 * complet (« Appel modèle — claude-opus-5-5 ») mangeait la place du détail. Rien n'est perdu : la
 * ligne dépliée garde le titre et le détail entiers, et le filtre cherche dans le texte complet.
 */

/** Préfixe de fournisseur retiré du nom de modèle : « claude-opus-5-5 » se lit « opus-5-5 ». */
const PREFIXE_FOURNISSEUR = /^(?:claude|anthropic)-/i

/**
 * Titre de la ligne. `null` quand il ne fait que répéter la nature du geste (« Demande ·
 * Demande ») : l'appelant affiche alors le détail à sa place.
 */
export function titreCourt(label: string, nature: string): string | null {
  const brut = label.trim()
  if (brut.toLowerCase() === nature.trim().toLowerCase()) return null
  const appel = /^Appel modèle\s*[—-]\s*(.+)$/.exec(brut)
  if (appel) return appel[1].trim().replace(PREFIXE_FOURNISSEUR, '')
  const morceaux = brut.split(' · ')
  return morceaux
    .filter((morceau, index) => index === 0 || morceau !== morceaux[index - 1])
    .join(' · ')
}

/** 61204 → « 61 k », 1250000 → « 1,3 M ». */
function enMilliers(nombre: number): string {
  if (nombre < 1_000_000) return `${Math.round(nombre / 1_000)} k`
  return `${(nombre / 1_000_000).toFixed(1).replace('.', ',')} M`
}

/**
 * Résumé gris, sur une seule ligne. Seuls les entiers ISOLÉS de 5 à 9 chiffres sont raccourcis :
 * un nombre collé à une lettre, un tiret, un point ou une barre fait partie d'un identifiant, d'un
 * chemin ou d'une décimale, et un horodatage (13 chiffres) reste lisible tel quel.
 */
export function detailCourt(texte: string): string {
  const morceaux = texte.replace(/\s+/g, ' ').trim().split(' · ')
  const utiles = morceaux.filter(
    (morceau) => !morceaux.some((autre) => autre !== morceau && autre.startsWith(`${morceau}-`))
  )
  return utiles
    .join(' · ')
    .replace(/(?<![\w.,/:#@-])(\d{5,9})(?![\w.,/:-])/g, (_tout, chiffres: string) =>
      enMilliers(Number(chiffres))
    )
}
