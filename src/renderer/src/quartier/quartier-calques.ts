/**
 * LES CALQUES DE LA FALAISE (« pour l'écran d'accueil comment faire pour pouvoir modifier des
 * éléments sans tout régénérer à chaque fois ? »).
 *
 * Avant : les 39 bâtiments n'avaient aucun pixel à eux, ils étaient découpés dans la peinture. En changer un
 * obligeait à repeindre toute la Falaise, et le générateur d'images déplaçait alors le reste de la scène
 * (Brain : « piège même graine »), ce qui rendait fausses les positions de `donnees.json`.
 *
 * Maintenant la Falaise se compose au chargement, une fois :
 *  1. la peinture `falaise.avif`, inchangée ;
 *  2. `falaise-derriere.webp` : ce qu'il y a DERRIÈRE chaque bâtiment, opaque dans son empreinte,
 *     transparent ailleurs (hors bâtiments, c'est donc la peinture d'origine, sans réencodage) ;
 *  3. un fichier par bâtiment, `batiments/<n ou cle>.webp`, posé à sa place, dans l'ordre de `donnees.json`.
 * Le résultat redonne la peinture d'origine à moins d'un niveau de couleur près (mesuré). Changer
 * un bâtiment = remplacer son fichier (et son empreinte dans `donnees.json`) : rien d'autre ne bouge.
 */
import { contexte, toile } from './quartier-vie'

const DOSSIER = '../assets/quartier/batiments/'

const FICHIERS = import.meta.glob('../assets/quartier/batiments/*.webp', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** Le nom de fichier d'un bâtiment : son `n`, ou sa `cle` pour ceux qui ouvrent une vue. */
export function nomDuBatiment(o: { n?: string; cle?: string }): string {
  const nom = o.n ?? o.cle
  if (!nom) throw new Error('[quartier] bâtiment sans nom ni clé dans donnees.json')
  return nom
}

/** L'adresse servie de l'image d'un bâtiment. Absente, c'est une erreur nommée : le bâtiment disparaîtrait. */
export function adresseBatiment(nom: string): string {
  const adresse = FICHIERS[`${DOSSIER}${nom}.webp`]
  if (!adresse) throw new Error(`[quartier] image de bâtiment absente : batiments/${nom}.webp`)
  return adresse
}

/**
 * La Falaise composée : peinture, puis ce qu'il y a derrière les bâtiments, puis chaque bâtiment à sa place
 * (`x`, `y` en pixels de l'Accueil, `S` = pixels de peinture par pixel d'Accueil). Les images sont posées à
 * leur taille réelle, sans mise à l'échelle : un pixel du fichier est un pixel de la peinture.
 */
export function composerFalaise(
  peinture: HTMLImageElement,
  derriere: HTMLImageElement,
  objets: readonly { x: number; y: number }[],
  batiments: readonly HTMLImageElement[],
  S: number
): HTMLCanvasElement {
  const F = toile(peinture.naturalWidth, peinture.naturalHeight)
  const g = contexte(F)
  g.drawImage(peinture, 0, 0)
  g.drawImage(derriere, 0, 0)
  objets.forEach((o, i) => g.drawImage(batiments[i], o.x * S, o.y * S))
  return F
}
