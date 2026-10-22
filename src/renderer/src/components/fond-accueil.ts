/**
 * LE FOND DE L'ACCUEIL, CHOISI DANS SES RÉGLAGES.
 *
 * DEMANDE DE L'UTILISATEUR (2026-10-19, conv-346) : « je veux dans les settings de l'accueil un menu
 * pour choisir un fond noir ou l'image cyberpunk ou les planetes ». Jusque-là, la direction du fond
 * n'avait AUCUN réglage : elle ne changeait qu'en éditant le stockage à la main, et `DecorDeFond` ne
 * la lisait qu'une fois par session.
 *
 * CE MODULE EST LA SEULE SOURCE du choix, lue à la fois par le menu (`HomeView`) et par le fond
 * (`DecorDeFond`) : deux lectures recopiées finiraient par se contredire, comme la clé recopiée à la
 * main l'avait déjà fait (voir `CLE_FOND_ACCUEIL`). Il ne charge PAS three.js : le menu n'a pas besoin
 * du moteur 3D pour savoir quel fond est choisi.
 */
import { autowinStorageKey } from '../storage-keys'
import type { DecorVariant } from './home-decor-scene'

/**
 * Le fond affiché tant que personne n'en a choisi un autre : l'avenue cyberpunk, décidée le
 * 2026-10-17 (conv-301, « Passe au vrai fond de l'Accueil avec ce look » — l'historique est en
 * commentaire de `home-decor-scene.ts`, qui ré-exporte cette valeur).
 */
export const DECOR_DEFAUT: DecorVariant = 'avenue'

/** Un fond d'Accueil : une direction du décor 3D, ou le noir, qui n'en monte aucune. */
export type FondAccueil = DecorVariant | 'noir'

/** Le noir : aucune scène 3D, l'hôte du décor peint un aplat noir (theme.css). */
export const FOND_NOIR = 'noir' satisfies FondAccueil

/**
 * LA MÊME CLÉ QUE LE DÉCOR L'A TOUJOURS LUE.
 *
 * Une clé de stockage se dérive, elle ne se recopie pas : une première version de `DecorDeFond`
 * avait écrit `'autowin:decor-variant'` à la main pendant que l'Accueil lisait une autre clé, et la
 * direction choisie était ignorée en silence.
 *
 * `v2` le 2026-08-25, pour que le nouveau défaut `actuel` atteigne les machines qui gardaient
 * `poussiere` ; `v3` le 2026-10-17 (conv-301), pour que l'avenue atteigne celles qui gardaient
 * `actuel`. Le choix du menu s'écrit sous la même clé : c'est celle que le décor lit.
 */
export const CLE_FOND_ACCUEIL = autowinStorageKey('home.decor.v3')

/**
 * L'événement émis quand le fond CHANGE, dans la même fenêtre.
 *
 * Le navigateur n'émet `storage` que pour les AUTRES fenêtres : le décor, monté à côté de l'Accueil,
 * ne verrait jamais le choix du menu, et le fond ne changerait qu'au redémarrage.
 */
export const EVENEMENT_FOND_ACCUEIL = 'autowin:fond-accueil'

/**
 * Les choix du menu, dans l'ordre affiché, avec les mots de la demande.
 *
 * Le fond sans scène s'affiche « Aucun » et non plus « Noir » (conv-1076, 2026-10-22 : « desfois c
 * pas noir selon le theme ») : Holographique blanc le peint en blanc (#fdfdff, couche générée). Son
 * identifiant reste `noir` : c'est la valeur déjà enregistrée sur les postes qui l'ont choisi.
 */
export const FONDS_ACCUEIL: readonly { id: FondAccueil; nom: string }[] = [
  { id: FOND_NOIR, nom: 'Aucun' },
  { id: 'avenue', nom: 'Cyberpunk' },
  { id: 'actuel', nom: 'Planètes' }
]

/**
 * Le fond choisi, ou le défaut si rien n'a jamais été enregistré.
 *
 * La valeur est rendue telle qu'enregistrée : une direction du catalogue absente du menu (`limbe`,
 * `orbites`…) reste affichée, et une valeur inconnue est ramenée au défaut par `createDecorScene`.
 */
export function lireFondAccueil(): FondAccueil {
  if (typeof window === 'undefined') return DECOR_DEFAUT
  return (window.localStorage.getItem(CLE_FOND_ACCUEIL) ?? DECOR_DEFAUT) as FondAccueil
}

/** Enregistre le fond choisi et prévient la fenêtre : le décor change sans redémarrer. */
export function choisirFondAccueil(fond: FondAccueil): void {
  window.localStorage.setItem(CLE_FOND_ACCUEIL, fond)
  window.dispatchEvent(new Event(EVENEMENT_FOND_ACCUEIL))
}

/** Abonnement pour `useSyncExternalStore` : cette fenêtre (l'événement) et les autres (`storage`). */
export function abonnerFondAccueil(rappel: () => void): () => void {
  window.addEventListener(EVENEMENT_FOND_ACCUEIL, rappel)
  window.addEventListener('storage', rappel)
  return () => {
    window.removeEventListener(EVENEMENT_FOND_ACCUEIL, rappel)
    window.removeEventListener('storage', rappel)
  }
}
