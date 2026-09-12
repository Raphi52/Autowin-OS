/**
 * DEUX CONVERSATIONS NE DOIVENT PAS PORTER LE MEME NOM DANS LA BARRE LATERALE.
 *
 * Mesure du 2026-09-12 sur `conversations.json` : 62 des 442 conversations partagent leur titre
 * avec une autre — « Réparer la mise à jour » ×11, « /salvage — n travaux terminés n'ont jamai… »
 * ×14, « Jarvis » ×8. L'utilisateur l'a ecrit six fois : « il faut que les conversations s'appellent
 * autrement. »
 *
 * La cause n'est pas le choix du titre, c'est qu'il est FIGE sur les 42 premiers caracteres du
 * premier message et jamais revu : un lanceur repete (`/salvage`, « Réparer la mise à jour »)
 * produit donc mecaniquement des homonymes. On ajoute ici le seul element qui distingue VRAIMENT
 * deux lancements du meme geste — le moment ou ils ont eu lieu.
 *
 * Pourquoi une date et pas un « (2) » : « /salvage (2) » ne dit rien, « /salvage · 12/09 09:41 »
 * permet de retrouver le fil qu'on cherche. Et pourquoi pas un titre demande au modele : cela
 * couterait un appel a chaque nouveau fil pour un probleme que la date tranche exactement.
 */

/** Longueur max d'un titre, comme `conversation-demandee.ts` et la barre laterale. */
export const LONGUEUR_TITRE = 42

const compacter = (texte: string): string => texte.replace(/\s+/g, ' ').trim()

/** Meme comparaison que le store : insensible a la casse, aux accents et a la ponctuation finale. */
const empreinte = (titre: string): string =>
  compacter(titre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.!?…\s]+$/, '')

/** Le titre coupe a la longueur d'affichage — exactement comme avant. */
export function titreCourt(source: string): string {
  const compact = compacter(source)
  return compact.length > LONGUEUR_TITRE ? `${compact.slice(0, LONGUEUR_TITRE)}…` : compact
}

const deuxChiffres = (n: number): string => String(n).padStart(2, '0')

/** « 12/09 09:41 » — le repere qui permet de retrouver LE fil qu'on cherche. */
export function marqueurDeMoment(quand: Date): string {
  return `${deuxChiffres(quand.getDate())}/${deuxChiffres(quand.getMonth() + 1)} ${deuxChiffres(quand.getHours())}:${deuxChiffres(quand.getMinutes())}`
}

/**
 * Le titre a POSER : celui repris du message, distingue s'il existe deja ailleurs.
 *
 * `titresExistants` doit contenir les titres des AUTRES conversations. Un titre libre est rendu
 * inchange — aucune date n'est ajoutee a un nom qui n'en a pas besoin.
 */
export function titreSansHomonyme(
  source: string,
  titresExistants: readonly string[],
  quand: Date = new Date()
): string {
  const propose = titreCourt(source)
  if (!propose) return propose
  const pris = new Set(titresExistants.map(empreinte))
  if (!pris.has(empreinte(propose))) return propose
  const marqueur = ` · ${marqueurDeMoment(quand)}`
  // Le marqueur doit RESTER VISIBLE : c'est le titre qu'on raccourcit, jamais la date.
  const place = Math.max(0, LONGUEUR_TITRE - marqueur.length)
  const base = compacter(source)
  const tronque = base.length > place ? `${base.slice(0, Math.max(1, place - 1))}…` : base
  return `${tronque}${marqueur}`
}
