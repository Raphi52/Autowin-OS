import { MESSAGES_DE_GEL_MAX, SEUIL_GEL_MS, type MessageDeGel } from '../../../shared/gel-detector'

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
type CanalGel = {
  signalerGelRenderer?: (
    ms: number,
    etiquette?: string,
    detail?: { messages: MessageDeGel[] }
  ) => unknown
}

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
    // Un sous-bloc mesure DANS la vue (harnais ChatView) donne son nom : `vue-chat-fil`, pas `vue-chat`.
    const bloc = sousBlocDominant(id)
    const etiquette = `vue-${bloc}`.slice(0, 48)
    // Gel du FIL : il emporte ses messages les plus lourds (conv-1077). Chaque ligne du fil rend
    // AVANT la vue qui l'englobe (React appelle les Profiler internes d'abord) : ils sont deja notes.
    const messages = bloc === 'chat-fil' ? messagesLesPlusLourds() : []
    if (messages.length > 0) api.signalerGelRenderer(ms, etiquette, { messages })
    else api.signalerGelRenderer(ms, etiquette)
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
  const plusLourde = (ids: Array<[string, number]>): string =>
    ids.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  // Les sous-blocs (`chat-fil`) sont imbriques DANS leur vue (`chat`) : la vue cumule toujours au
  // moins autant qu'eux. On choisit donc parmi les vues de premier niveau, puis on descend.
  const racines = [...parVue].filter(
    ([id]) => ![...parVue.keys()].some((v) => id.startsWith(`${v}-`))
  )
  return sousBlocDominant(plusLourde(racines.length ? racines : [...parVue]), maintenant)
}

/**
 * LE SOUS-BLOC d'une vue qui a le plus rendu recemment (`chat-fil` dans `chat`), sinon la vue.
 * C'est ce qui rend utile le harnais pose DANS ChatView : 859 gels `vue-chat` ne disaient pas quel
 * bloc de la vue tenait le fil d'affichage.
 */
export function sousBlocDominant(id: string, maintenant: number = Date.now()): string {
  const parBloc = new Map<string, number>()
  for (const rendu of rendusRecents) {
    if (maintenant - rendu.a > FENETRE_RECENTE_MS || !rendu.id.startsWith(`${id}-`)) continue
    parBloc.set(rendu.id, (parBloc.get(rendu.id) ?? 0) + rendu.ms)
  }
  if (parBloc.size === 0) return id
  return [...parBloc].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}

/**
 * LE FIL MESURE MESSAGE PAR MESSAGE (conv-1077, 2026-10-22). `renderer:vue-chat-fil` = 28 gels pour
 * 62,4 s depuis le 15/10 (pire 7,6 s), mais le fil etait mesure D'UN BLOC : rien ne disait QUEL
 * message coutait. Chaque ligne (`ChatMessageRow`) note son propre rendu ici, dans un registre A PART
 * — le melanger a `rendusRecents` changerait le sous-bloc dominant des vues.
 * fix-ok: cause mesurée 2026-10-22 — sans ce registre, le gel du fil ne nomme aucun message (réinjection : 3 tests rouges).
 */
const rendusDeMessages: Array<Omit<MessageDeGel, 'rendus'> & { a: number }> = []

export function noterRenduMessage(
  rendu: Omit<MessageDeGel, 'rendus'>,
  maintenant: number = Date.now()
): void {
  if (!Number.isFinite(rendu.ms) || rendu.ms <= 0) return
  rendusDeMessages.push({ ...rendu, a: maintenant })
  while (rendusDeMessages.length > 0 && maintenant - rendusDeMessages[0].a > FENETRE_RECENTE_MS) {
    rendusDeMessages.shift()
  }
}

/** Les messages qui ont le plus rendu dans la fenetre recente, cumules par cle, du plus lourd. */
export function messagesLesPlusLourds(
  n: number = MESSAGES_DE_GEL_MAX,
  maintenant: number = Date.now()
): MessageDeGel[] {
  const parCle = new Map<string, MessageDeGel>()
  for (const r of rendusDeMessages) {
    if (maintenant - r.a > FENETRE_RECENTE_MS) continue
    const deja = parCle.get(r.cle)
    if (deja) {
      deja.ms += r.ms
      deja.rendus += 1
      deja.taille = r.taille
    } else parCle.set(r.cle, { cle: r.cle, role: r.role, taille: r.taille, ms: r.ms, rendus: 1 })
  }
  return [...parCle.values()]
    .map((m) => ({ ...m, ms: Math.round(m.ms) }))
    .sort((a, b) => b.ms - a.ms || a.cle.localeCompare(b.cle))
    .slice(0, n)
}

/** Vide le registre — reserve aux tests, pour qu’une mesure ne fuite pas dans la suivante. */
export function oublierRendusRecents(): void {
  rendusRecents.length = 0
  rendusDeMessages.length = 0
}
