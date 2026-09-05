import { SEUIL_GEL_MS } from '../../../shared/gel-detector'
import { noterRendu } from './rendu-long'

/**
 * CHRONOMETRE NOMME DU GRAPHE — ce qui manquait pour trancher « quel calcul gele Memory ? ».
 *
 * `gel-renderer.ts` mesure deja les taches longues du thread d'interface, mais sous une seule
 * operation `renderer:longtask` : a l'ouverture de Memory, 31,8 s cumulees (14 taches, mesure du
 * 2026-09-02) etaient donc imputables au rendu EN BLOC, sans jamais nommer le calcul fautif.
 *
 * Ici, chaque bloc coûteux du graphe est entoure d'une mesure PORTANT SON NOM. Seules les mesures
 * qui atteignent le meme seuil que le detecteur du main sont journalisees : l'instrument ne parle
 * que lorsqu'il y a un gel a expliquer, et il ecrit par le canal existant — pas de second puits.
 *
 * Best-effort de bout en bout : sans le canal (moteur non reconstruit), la mesure reste muette et
 * la valeur calculee est rendue telle quelle. Un instrument ne doit jamais casser l'interface.
 */
type CanalGel = { signalerGelRenderer?: (ms: number, etiquette?: string) => unknown }

export function mesurerBlocGraphe<T>(
  etiquette: string,
  calcul: () => T,
  // SONDE TEMPORAIRE D'ISOLEMENT (2026-09-05) : seuil abaisse pour NOMMER les blocs courts.
  seuilMs: number = 150,
  maintenant: () => number = () => performance.now()
): T {
  const debut = maintenant()
  const valeur = calcul()
  const dureeMs = Math.round(maintenant() - debut)
  /*
   * COMPTE D'ABORD, ECRIS ENSUITE. Un gel de Memory n'est presque jamais UN bloc de plus d'une
   * seconde : c'est une rafale de blocs de 200 a 700 ms. Chacun restait sous le seuil, donc AUCUN
   * n'etait ecrit, et la tache longue agregee repartait sous `renderer:longtask` — 0 ligne
   * `graph:*` sur 1029 gels journalises, pendant que `renderer:longtask` en portait 368 s dont un
   * pic de 31,2 s a l'ouverture de Memory. On verse donc chaque bloc dans le MEME registre
   * glissant que les vues React : la tache longue est alors etiquetee par le bloc qui a le plus
   * coute juste avant elle.
   */
  noterRendu(etiquette, dureeMs)
  if (dureeMs >= seuilMs) {
    try {
      const api = (window as unknown as { api?: CanalGel }).api
      api?.signalerGelRenderer?.(dureeMs, etiquette)
    } catch {
      /* observabilite best-effort : un canal indisponible ne doit rien casser */
    }
  }
  return valeur
}
