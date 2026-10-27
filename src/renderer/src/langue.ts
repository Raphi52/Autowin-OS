import { useSyncExternalStore } from 'react'
import {
  LANGUE_PAR_DEFAUT,
  estLangue,
  langueOuDefaut,
  localeDeLangue,
  type Langue
} from '../../shared/langue'

/**
 * LA LANGUE DE L'INTERFACE — Settings · Interface, liste « Langue » (conv-1146, 2026-10-26).
 *
 * Même forme que le thème (`theme-mode.ts`) : mémorisée sur le poste, posée AVANT le premier rendu
 * (`main.tsx`), changée sans redémarrage. Un SEUL point de vérité pendant la session : la langue
 * courante de ce module. Les composants traduits la lisent par `useLangue()` (`textes.ts`) et se
 * redessinent quand elle change ; l'attribut `lang` du document la suit.
 *
 * Le moteur reçoit la langue (`window.api.setLangue`) pour que l'agent réponde dans la même : au
 * démarrage, puis à chaque CHANGEMENT — jamais pour une simple réouverture de Settings, ni pour la
 * même langue choisie deux fois (l'effet de `InterfaceView` qui rejoue le thème à chaque ouverture
 * est précisément le piège à ne pas reproduire, conv-981).
 */
export const LANGUE_STORAGE_KEY = 'autowin-langue.v1'

let courante: Langue | undefined
const abonnes = new Set<() => void>()

/** La langue mémorisée. Absente, abîmée, inconnue, stockage indisponible : français. */
export function lireLangue(): Langue {
  try {
    return langueOuDefaut(globalThis.localStorage?.getItem(LANGUE_STORAGE_KEY))
  } catch {
    return LANGUE_PAR_DEFAUT
  }
}

/** La langue affichée en ce moment. Avant toute application, celle qui est mémorisée. */
export function langueCourante(): Langue {
  if (courante === undefined) courante = lireLangue()
  return courante
}

/** Pose la langue sur le document et prévient les composants abonnés, si elle change. */
export function appliquerLangue(langue: Langue): void {
  globalThis.document?.documentElement?.setAttribute('lang', langue)
  if (langue === courante) return
  courante = langue
  for (const abonne of [...abonnes]) abonne()
}

/**
 * LE DERNIER ENVOI AU MOTEUR QUI A ÉCHOUÉ, pour que l'écran le DISE (conv-1146, 2026-10-26). Avant,
 * l'échec était avalé : l'écran passait en anglais, l'agent continuait en français, et rien ne le
 * signalait. `undefined` : rien à signaler. Seul le DERNIER envoi compte (`dernierEnvoi`) : un refus
 * arrivé en retard ne recouvre pas un succès plus récent.
 */
export interface EchecEnvoiLangue {
  langue: Langue
  raison: string
}
let echecEnvoi: EchecEnvoiLangue | undefined
let dernierEnvoi = 0

export function echecEnvoiLangue(): EchecEnvoiLangue | undefined {
  return echecEnvoi
}

function poserEchecEnvoi(echec: EchecEnvoiLangue | undefined): void {
  if (echec === undefined && echecEnvoi === undefined) return
  echecEnvoi = echec
  for (const abonne of [...abonnes]) abonne()
}

const raisonDe = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Transmet la langue au moteur. Hors d'Electron (test, navigateur : pas de pont), il n'y a rien à
 * transmettre ni à signaler. Un refus du moteur, une panne du pont ou une langue gardée différente
 * de celle demandée sont RETENUS (`echecEnvoiLangue`) et affichés par Settings · Interface :
 * l'interface garde le choix, mais l'utilisateur sait que l'agent ne le suit pas encore.
 */
export function transmettreLangueAuMoteur(langue: Langue): Promise<void> {
  const pont = (globalThis as { api?: { setLangue?: (l: Langue) => unknown } }).api
  if (!pont?.setLangue) return Promise.resolve()
  const envoi = ++dernierEnvoi
  const conclure = (raison: string | undefined): void => {
    if (envoi !== dernierEnvoi) return
    poserEchecEnvoi(raison === undefined ? undefined : { langue, raison })
  }
  let reponse: unknown
  try {
    reponse = pont.setLangue(langue)
  } catch (e) {
    conclure(raisonDe(e))
    return Promise.resolve()
  }
  return Promise.resolve(reponse).then(
    (gardee) => conclure(gardee === langue ? undefined : `${String(gardee)} ≠ ${langue}`),
    (e: unknown) => conclure(raisonDe(e))
  )
}

/**
 * Ce qu'appelle la liste de Settings · Interface : mémorise, applique, transmet au moteur. La même
 * langue redite ne fait RIEN — ni écriture, ni envoi. Une valeur hors liste est ignorée. Écriture
 * refusée par le stockage : la langue vaut pour la session, le prochain démarrage revient au français.
 */
export function ecrireLangue(langue: unknown): void {
  if (!estLangue(langue) || langue === langueCourante()) return
  try {
    globalThis.localStorage?.setItem(LANGUE_STORAGE_KEY, langue)
  } catch {
    // Écriture impossible : la langue s'applique quand même pour la session en cours.
  }
  appliquerLangue(langue)
  void transmettreLangueAuMoteur(langue)
}

export function abonnerLangue(abonne: () => void): () => void {
  abonnes.add(abonne)
  return () => {
    abonnes.delete(abonne)
  }
}

/** La langue courante, pour un composant : il se redessine quand elle change. */
export function useLangue(): Langue {
  return useSyncExternalStore(abonnerLangue, langueCourante, langueCourante)
}

/**
 * LES DATES ET LES NOMBRES DANS LA LANGUE DE L'INTERFACE (traduction complète, conv-1170,
 * 2026-10-27). Les écrans écrivaient `toLocaleString('fr-FR', …)` en dur : ces deux fonctions
 * prennent la locale de la langue courante (`localeDeLangue`, `shared/langue.ts`).
 *
 * `formaterDate` suit EXACTEMENT `Date.prototype.toLocaleString` (Intl) : sans composant demandé
 * dans `options`, date ET heure — c'est la forme la plus courante dans l'app, et un appel
 * `x.toLocaleString('fr-FR', opts)` remplacé par `formaterDate(x, opts)` affiche le même français.
 * Pour la date seule : `{ dateStyle: 'short' }` ; l'heure seule : `{ timeStyle: 'medium' }`. Une date
 * invalide rend « Invalid Date », comme avant, sans lever d'erreur.
 *
 * Elles lisent la langue au moment de l'appel : dans un composant, appelées pendant le rendu d'un
 * composant qui lit `useLangue()` ou `useTextes()`, elles suivent un changement de langue.
 */
export function formaterDate(
  valeur: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = valeur instanceof Date ? valeur : new Date(valeur)
  return date.toLocaleString(localeDeLangue(langueCourante()), options)
}

/** Un nombre dans la langue courante (séparateurs de milliers et décimale) : `Intl.NumberFormat`. */
export function formaterNombre(
  valeur: number | bigint,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(localeDeLangue(langueCourante()), options).format(valeur)
}

/** Le dernier échec d'envoi au moteur, pour un composant : il se redessine quand il change. */
export function useEchecEnvoiLangue(): EchecEnvoiLangue | undefined {
  return useSyncExternalStore(abonnerLangue, echecEnvoiLangue, echecEnvoiLangue)
}
