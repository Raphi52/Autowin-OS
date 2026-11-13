/**
 * LE FOND DE L'ACCUEIL : LE QUARTIER, ET RIEN À CHOISIR.
 *
 * Le menu « Fond » des réglages de l'Accueil a été retiré le 2026-11-13 (« on doit avoir que le
 * fond Le Quartier, donc pas de menu select ») : « Aucun » et « Nier Automata (radar) » ne sont plus
 * des fonds, et un poste qui les avait choisis retombe sur le Quartier.
 *
 * CE MODULE EST LA SEULE SOURCE du fond affiché, lue à la fois par l'Accueil (`HomeView`) et par
 * le décor (`DecorDeFond`) : deux lectures recopiées finiraient par se contredire, comme la clé
 * recopiée à la main l'avait déjà fait (voir `CLE_FOND_ACCUEIL`). Il ne charge PAS three.js.
 *
 * Seule exception au Quartier : une direction 3D du catalogue (`limbe`, `poussiere`…) enregistrée
 * à la main sous `CLE_FOND_ACCUEIL`. Aucun écran ne la propose.
 */
import { autowinStorageKey } from '../storage-keys'
import type { DecorVariant } from './home-decor-scene'

/**
 * Le décor spatial de repli : il prend la place d'une direction enregistrée qu'aucune scène ne
 * reconnaît. `home-decor-scene.ts` le ré-exporte.
 */
export const DECOR_DEFAUT: DecorVariant = 'poussiere'

/** Un fond d'Accueil : le Quartier, scène peinte (`quartier-scene.ts`), ou une direction 3D. */
export type FondAccueil = DecorVariant | 'falaise'

/** Le Quartier : la Falaise peinte, où vivent les vrais agents, et dont les objets ouvrent les vues. */
export const FOND_FALAISE = 'falaise' satisfies FondAccueil

/** Le fond affiché tant que rien d'autre n'a été enregistré à la main. */
export const FOND_DEFAUT: FondAccueil = FOND_FALAISE

/**
 * LA MÊME CLÉ QUE LE DÉCOR L'A TOUJOURS LUE.
 *
 * Une clé de stockage se dérive, elle ne se recopie pas : une première version de `DecorDeFond`
 * avait écrit `'autowin:decor-variant'` à la main pendant que l'Accueil lisait une autre clé, et la
 * direction choisie était ignorée en silence. `v4` depuis le 2026-11-01, pour que le Quartier
 * atteigne les postes qui gardaient l'avenue.
 */
export const CLE_FOND_ACCUEIL = autowinStorageKey('home.decor.v4')

/**
 * L'événement émis quand le fond CHANGE, dans la même fenêtre.
 *
 * Le navigateur n'émet `storage` que pour les AUTRES fenêtres : le décor, monté à côté de l'Accueil,
 * ne verrait jamais le changement, et le fond ne changerait qu'au redémarrage.
 */
export const EVENEMENT_FOND_ACCUEIL = 'autowin:fond-accueil'

/**
 * Les fonds retirés : un poste qui les avait choisis retombe sur le Quartier, et leur scène ne
 * monte jamais. `noir` (« Aucun ») et `nier` (le radar) étaient les derniers choix du menu.
 */
const FONDS_RETIRES: readonly string[] = ['avenue', 'actuel', 'noir', 'nier']

/**
 * Le fond affiché : le Quartier, sauf direction 3D enregistrée à la main. Une valeur inconnue est
 * ramenée à `DECOR_DEFAUT` par `createDecorScene`.
 */
export function lireFondAccueil(): FondAccueil {
  if (typeof window === 'undefined') return FOND_DEFAUT
  const enregistre = window.localStorage.getItem(CLE_FOND_ACCUEIL)
  if (!enregistre || FONDS_RETIRES.includes(enregistre)) return FOND_DEFAUT
  return enregistre as FondAccueil
}

/** Enregistre une direction et prévient la fenêtre : le décor change sans redémarrer. */
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
