import { SEUIL_GEL_MS } from '../../../shared/gel-detector'

/**
 * QUELLE VUE tient le fil d'affichage — ce que `renderer:longtask` ne disait pas.
 *
 * Mesure du 2026-09-03 (`gels.jsonl`) : 272 s de fenetre morte en `renderer:longtask`, sur 70
 * episodes, sans AUCUN nom. Or les dix vues de l'application restent MONTEES en meme temps (les
 * `view-slot`, pour garder leur etat) : n'importe laquelle peut donc geler l'affichage sans etre
 * soupconnee, et un correctif pose sur la mauvaise ne se verrait jamais.
 *
 * Le `Profiler` de React rend la duree REELLE d'un rendu, avec l'identifiant de la zone. On
 * n'ecrit que lorsqu'un rendu atteint le meme seuil que le detecteur du main — l'instrument se
 * tait quand tout va bien, et il ecrit par le canal deja existant, jamais par un second.
 */
type CanalGel = { signalerGelRenderer?: (ms: number, etiquette?: string) => unknown }

export function signalerRenduLong(
  id: string,
  dureeMs: number,
  seuilMs: number = SEUIL_GEL_MS,
  canal?: CanalGel
): boolean {
  const ms = Math.round(dureeMs)
  if (!Number.isFinite(ms) || ms < seuilMs) return false
  try {
    const api = canal ?? (window as unknown as { api?: CanalGel }).api
    // Pas de canal = RIEN N'EST ECRIT : on rend `false`, jamais un succes qui n'a pas eu lieu.
    if (typeof api?.signalerGelRenderer !== 'function') return false
    // L'etiquette est bornee par le canal principal ([a-z0-9:-], 48 signes) : on la respecte ici.
    api.signalerGelRenderer(ms, `vue-${id}`.slice(0, 48))
    return true
  } catch {
    /* observabilite best-effort : un canal indisponible ne doit rien casser */
    return false
  }
}

/**
 * LE CUMUL RECENT PAR VUE — parce qu’un gel est rarement UN seul rendu.
 *
 * `signalerRenduLong` ne nomme qu’un rendu ISOLE depassant le seuil. Or un blocage de trois
 * secondes est le plus souvent fait de DIX rendus de trois cents millisecondes : aucun n’atteint le
 * seuil, et la tache longue repart anonyme — exactement le defaut qu’on voulait corriger. On garde
 * donc le temps de rendu de chaque vue sur une courte fenetre glissante, et la tache longue est
 * etiquetee par la vue qui a le plus rendu juste avant elle.
 *
 * Fenetre courte (2 s) a dessein : au-dela, on accuserait une vue qui avait fini de travailler.
 */
const FENETRE_RECENTE_MS = 2_000
const rendusRecents: Array<{ id: string; ms: number; a: number }> = []

export function noterRendu(id: string, dureeMs: number, maintenant: number = Date.now()): void {
  if (!Number.isFinite(dureeMs) || dureeMs <= 0) return
  rendusRecents.push({ id, ms: dureeMs, a: maintenant })
  while (rendusRecents.length > 0 && maintenant - rendusRecents[0].a > FENETRE_RECENTE_MS) {
    rendusRecents.shift()
  }
}

/**
 * La vue qui a le plus rendu dans la fenetre recente — undefined si rien n’a ete mesure.
 *
 * Rendre undefined plutot qu’un nom par defaut est essentiel : une etiquette inventee ferait
 * accuser une vue innocente, ce qui est pire qu’un gel anonyme.
 */
export function vueDominanteRecente(maintenant: number = Date.now()): string | undefined {
  const parVue = new Map<string, number>()
  for (const rendu of rendusRecents) {
    if (maintenant - rendu.a > FENETRE_RECENTE_MS) continue
    parVue.set(rendu.id, (parVue.get(rendu.id) ?? 0) + rendu.ms)
  }
  if (parVue.size === 0) return undefined
  return [...parVue].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}

/** Vide le registre — reserve aux tests, pour qu’une mesure ne fuite pas dans la suivante. */
export function oublierRendusRecents(): void {
  rendusRecents.length = 0
}
