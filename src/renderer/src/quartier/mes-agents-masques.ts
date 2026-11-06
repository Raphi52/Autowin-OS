/**
 * « AFFICHER MES AGENTS À » (demande utilisateur du 2026-11-05).
 *
 * Demande : dans les réglages de l'Accueil, une liste de personnes à cocher pour leur montrer ou non
 * mes agents. Le choix vit dans le réglage du Board du poste (`board-dossier.json`, à côté de l'animal
 * et du partage de la présence) : le processus principal écrit la liste des postes décochés dans
 * `presence.json`, et l'Autowin de chacun d'eux n'affiche alors pas mes agents. Ce module en garde la
 * valeur pour la vue, comme `mon-animal.ts` pour l'animal.
 *
 * Limite à dire : c'est un réglage d'AFFICHAGE. `presence.json` reste lisible par toute l'équipe sur
 * le partage ; pour ne plus rien publier du tout, il y a l'interrupteur du partage (D6).
 *
 * Un choix qui n'a pas pu être enregistré ne change pas l'affichage : montrer une case décochée alors
 * que le collègue voit toujours mes agents serait mentir.
 */
import { useSyncExternalStore } from 'react'
import { postesLisibles } from '../../../shared/quartier-presence'

interface ApiMesAgentsMasques {
  boardDossier?: () => Promise<{ masquerPresencePour?: unknown } | null | undefined>
  quartierPresenceMasques?: (
    postes: string[]
  ) => Promise<{ masquerPresencePour?: unknown } | null | undefined>
}

const AUCUN: readonly string[] = []
let actuels: readonly string[] = AUCUN
let relu = false
const abonnes = new Set<() => void>()

const api = (): ApiMesAgentsMasques | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { api?: ApiMesAgentsMasques }).api

function changer(postes: readonly string[]): void {
  if (postes.length === actuels.length && postes.every((p, i) => p === actuels[i])) return
  actuels = postes.length ? postes : AUCUN
  for (const fn of abonnes) fn()
}

/** Les postes que rend le pont : un état sans liste (ou illisible) = visibles pour tous. */
const masquesDeLEtat = (etat: { masquerPresencePour?: unknown } | null | undefined): string[] =>
  postesLisibles(etat?.masquerPresencePour)

/** Le réglage du poste, relu une fois, au premier abonné : il ne change que par `choisirMesAgentsMasques`. */
function relireUneFois(): void {
  if (relu) return
  relu = true
  const lire = api()?.boardDossier
  if (!lire) return
  void lire()
    .then((etat) => changer(masquesDeLEtat(etat)))
    .catch(() => undefined)
}

export function lireMesAgentsMasques(): readonly string[] {
  return actuels
}

export function abonnerMesAgentsMasques(fn: () => void): () => void {
  abonnes.add(fn)
  relireUneFois()
  return () => {
    abonnes.delete(fn)
  }
}

/** Faux avec un pont d'avant redémarrage : le choix ne pourrait pas être enregistré. */
export function choixDesMasquesDisponible(): boolean {
  return typeof api()?.quartierPresenceMasques === 'function'
}

/**
 * Montre (`true`) ou masque mes agents à un poste ; il le voit à la prochaine écriture de
 * `presence.json` (5 s au plus). Rend `false` si le choix n'a pas été enregistré : la case garde alors
 * l'ancien état.
 */
export async function montrerMesAgentsA(poste: string, montrer: boolean): Promise<boolean> {
  const choisir = api()?.quartierPresenceMasques
  const cle = poste.trim().toLowerCase()
  if (!choisir || !cle) return false
  const voulus = montrer ? actuels.filter((p) => p !== cle) : postesLisibles([...actuels, cle])
  try {
    changer(masquesDeLEtat(await choisir([...voulus])))
    return actuels.includes(cle) === !montrer
  } catch {
    return false
  }
}

export function useMesAgentsMasques(): readonly string[] {
  return useSyncExternalStore(abonnerMesAgentsMasques, lireMesAgentsMasques, lireMesAgentsMasques)
}

/** Pour les tests : l'état du module redevient celui du démarrage. */
export function reinitialiserMesAgentsMasques(): void {
  actuels = AUCUN
  relu = false
  abonnes.clear()
}
