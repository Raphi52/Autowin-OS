/**
 * L'ANIMAL DE MES AGENTS (demande utilisateur du 2026-11-04, conv-1537).
 *
 * Demande : « je veux qu'on puisse choisir dans les settings de l'accueil quel animal on veut pour
 * représenter nos agents ; notre setting doit affecter ce que les autres voient ». Le choix vit dans
 * le réglage du Board du poste (`board-dossier.json`, à côté du nom et du partage de la présence) :
 * le processus principal l'écrit dans `presence.json`, que chaque collègue relit pour dessiner le même
 * animal. Ce module en garde la valeur pour la vue : la scène la lit à chaque image, les réglages de
 * l'Accueil la montrent et la changent.
 *
 * Tant que le réglage n'est pas relu (ou sans pont), l'animal est le tanuki : ce que l'Accueil
 * dessinait avant ce réglage. Un choix qui n'a pas pu être enregistré ne change pas l'affichage :
 * montrer un animal que les collègues ne verront pas serait mentir.
 */
import { useSyncExternalStore } from 'react'
import {
  ANIMAL_PAR_DEFAUT,
  animalLisible,
  tenueLisible,
  type AnimalAgent,
  type TenueAgent
} from '../../../shared/quartier-presence'

/** Ce que rend le pont : le réglage du poste, dont l'animal et la couleur de tenue (conv-1633). */
type EtatRelu = { animal?: unknown; tenue?: unknown } | null | undefined

interface ApiMonAnimal {
  boardDossier?: () => Promise<EtatRelu>
  quartierPresenceAnimal?: (animal: AnimalAgent | null) => Promise<EtatRelu>
  quartierPresenceTenue?: (tenue: TenueAgent | null) => Promise<EtatRelu>
}

let actuel: AnimalAgent = ANIMAL_PAR_DEFAUT
/**
 * La couleur de tenue de MES agents (conv-1633), relue du même réglage que l'animal ; `null` = la tenue
 * d'origine de l'animal. Mêmes règles : un choix non enregistré ne change pas l'affichage.
 */
let tenueActuelle: TenueAgent | null = null
let relu = false
const abonnes = new Set<() => void>()

const api = (): ApiMonAnimal | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { api?: ApiMonAnimal }).api

function changer(animal: AnimalAgent): void {
  if (animal === actuel) return
  actuel = animal
  for (const fn of abonnes) fn()
}

function changerTenue(tenue: TenueAgent | null): void {
  if (tenue === tenueActuelle) return
  tenueActuelle = tenue
  for (const fn of abonnes) fn()
}

/** L'animal que rend le pont : un état sans animal (ou illisible) vaut le défaut. */
const animalDeLEtat = (etat: EtatRelu): AnimalAgent =>
  animalLisible(etat?.animal) ?? ANIMAL_PAR_DEFAUT

/** Le réglage du poste, relu une fois, au premier abonné : il ne change que par `choisirMonAnimal`. */
function relireUneFois(): void {
  if (relu) return
  relu = true
  const lire = api()?.boardDossier
  if (!lire) return
  void lire()
    .then((etat) => {
      changer(animalDeLEtat(etat))
      changerTenue(tenueLisible(etat?.tenue))
    })
    .catch(() => undefined)
}

export function lireMonAnimal(): AnimalAgent {
  return actuel
}

export function abonnerMonAnimal(fn: () => void): () => void {
  abonnes.add(fn)
  relireUneFois()
  return () => {
    abonnes.delete(fn)
  }
}

/** Faux avec un pont d'avant redémarrage : le choix ne pourrait pas être enregistré. */
export function choixDeLAnimalDisponible(): boolean {
  return typeof api()?.quartierPresenceAnimal === 'function'
}

/**
 * Retient l'animal sur le poste ; les collègues le voient à la prochaine écriture de `presence.json`
 * (5 s au plus). Rend `false` si le choix n'a pas été enregistré : l'affichage garde alors l'ancien.
 */
export async function choisirMonAnimal(animal: AnimalAgent): Promise<boolean> {
  const choisir = api()?.quartierPresenceAnimal
  if (!choisir || !animalLisible(animal)) return false
  try {
    changer(animalDeLEtat(await choisir(animal)))
    return actuel === animal
  } catch {
    return false
  }
}

export function useMonAnimal(): AnimalAgent {
  return useSyncExternalStore(abonnerMonAnimal, lireMonAnimal, lireMonAnimal)
}

/** La couleur de tenue de mes agents, `null` = d'origine (conv-1633). La scène la lit à chaque image. */
export function lireMaTenue(): TenueAgent | null {
  return tenueActuelle
}

/** Faux avec un pont d'avant redémarrage : le choix ne pourrait pas être enregistré. */
export function choixDeLaTenueDisponible(): boolean {
  return typeof api()?.quartierPresenceTenue === 'function'
}

/**
 * Retient la couleur de tenue sur le poste (`null` = d'origine) ; les collègues la voient à la prochaine
 * écriture de `presence.json` (5 s au plus). Rend `false` si le choix n'a pas été enregistré.
 */
export async function choisirMaTenue(tenue: TenueAgent | null): Promise<boolean> {
  const choisir = api()?.quartierPresenceTenue
  if (!choisir || (tenue !== null && !tenueLisible(tenue))) return false
  try {
    changerTenue(tenueLisible((await choisir(tenue))?.tenue))
    return tenueActuelle === tenue
  } catch {
    return false
  }
}

export function useMaTenue(): TenueAgent | null {
  return useSyncExternalStore(abonnerMonAnimal, lireMaTenue, lireMaTenue)
}

/** Pour les tests : l'état du module redevient celui du démarrage. */
export function reinitialiserMonAnimal(): void {
  actuel = ANIMAL_PAR_DEFAUT
  tenueActuelle = null
  relu = false
  abonnes.clear()
}
