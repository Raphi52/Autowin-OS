/**
 * LES WIDGETS DANS LEURS TOURS (D-2 de la fiche du Quartier).
 *
 * Sur la Falaise, chaque tuile de l'Accueil vit dans une tour de la ville. Un clic sur la tour fait
 * sortir le widget, et la tour reste allumée tant qu'il est dehors ; un second clic l'y fait rentrer.
 *
 * Par défaut, toutes les tuiles sont rentrées : sorties d'office, elles recouvriraient entièrement le
 * Quartier. Une tuile rentrée ne lit plus rien (Outlook, micro), exactement comme une tuile éteinte.
 */
import { HOME_WIDGET_IDS, type HomeWidgetId } from '../components/home-layout'
import type { HomeWidgetsVisibility } from '../components/home-widgets-visibility'
import { autowinStorageKey } from '../storage-keys'

export const CLE_TUILES_SORTIES = autowinStorageKey('home.quartier.tuiles-sorties.v1')

/** Chaque tuile et sa tour, dans l'ordre de `grill/agent-hq-japon-town.md`. */
export const TOUR_DU_WIDGET: Readonly<Record<HomeWidgetId, string>> = {
  conversations: 't_bulle',
  mails: 't_enveloppe',
  enregistrements: 't_micro',
  agenda: 't_horloge',
  notifications: 't_phare',
  jarvis: 't_anneau',
  routines: 't_torii'
}

export function widgetDeLaTour(cle: string): HomeWidgetId | null {
  return HOME_WIDGET_IDS.find((id) => TOUR_DU_WIDGET[id] === cle) ?? null
}

const VIDE: ReadonlySet<HomeWidgetId> = new Set()
let sorties: ReadonlySet<HomeWidgetId> | null = null
const abonnes = new Set<() => void>()

function lireStockage(): ReadonlySet<HomeWidgetId> {
  try {
    const brut = JSON.parse(window.localStorage.getItem(CLE_TUILES_SORTIES) ?? '[]') as unknown
    if (!Array.isArray(brut)) return VIDE
    return new Set(HOME_WIDGET_IDS.filter((id) => brut.includes(id)))
  } catch {
    return VIDE
  }
}

/** La MÊME référence tant que rien ne bouge : c'est ce qu'attend `useSyncExternalStore`. */
export function lireTuilesSorties(): ReadonlySet<HomeWidgetId> {
  if (typeof window === 'undefined') return VIDE
  sorties ??= lireStockage()
  return sorties
}

export function basculerTuileSortie(id: HomeWidgetId): void {
  const suivantes = new Set(lireTuilesSorties())
  if (suivantes.has(id)) suivantes.delete(id)
  else suivantes.add(id)
  sorties = suivantes
  try {
    window.localStorage.setItem(CLE_TUILES_SORTIES, JSON.stringify([...suivantes]))
  } catch {
    // Sans enregistrement, le choix vit le temps de la session : rien ne casse.
  }
  for (const abonne of abonnes) abonne()
}

export function abonnerTuilesSorties(rappel: () => void): () => void {
  abonnes.add(rappel)
  return () => abonnes.delete(rappel)
}

/** Les tuiles sorties, sous la forme que l'Accueil lit (`home-widgets-visibility.ts`). */
export function visibiliteDesSorties(liste: ReadonlySet<HomeWidgetId>): HomeWidgetsVisibility {
  return Object.fromEntries(
    HOME_WIDGET_IDS.map((id) => [id, liste.has(id)])
  ) as HomeWidgetsVisibility
}

/** Pour les tests : oublie ce qui a été lu. */
export function oublierTuilesSorties(): void {
  sorties = null
}
