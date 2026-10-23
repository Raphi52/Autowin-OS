import {
  MESSAGES_DE_GEL_MAX,
  SEUIL_GEL_MS,
  type DeclencheurDeListe,
  type ListeDeGel,
  type MessageDeGel
} from '../../../shared/gel-detector'

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
    detail?: { messages: MessageDeGel[] } | DetailDeListe
  ) => unknown
}
type DetailDeListe = { liste: ListeDeGel }

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
    // Gel de la LISTE : le rendu qui vient de se clore (`noterRendu`, appelé juste avant par
    // VueMesuree) — ses lignes redessinées et ce qui l'a déclenché (conv-1115).
    const liste = bloc === VUE_LISTE ? dernierPassageDeListe() : undefined
    if (messages.length > 0) api.signalerGelRenderer(ms, etiquette, { messages })
    else if (liste) api.signalerGelRenderer(ms, etiquette, { liste })
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
  // AVANT le filtre de durée : un rendu de la liste trop court pour compter (0 ms) clôt quand même
  // son passage, sinon ses lignes seraient attribuées au rendu suivant.
  if (id === VUE_LISTE) cloreRenduListe(maintenant)
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

/**
 * LA LISTE DES CONVERSATIONS MESURÉE LIGNE PAR LIGNE (conv-1115, 2026-10-23).
 * `renderer:vue-chat-liste` = 18 gels pour 73 s depuis le 20/10 (pire 12,9 s), et aucun ne disait
 * combien de lignes la liste avait redessinées ni quelle donnée avait changé : le diagnostic /gel n'a
 * pas pu trancher entre une liste remplacée en entier et une machine saturée.
 *
 * Un PASSAGE = ce qui se passe entre deux rendus de la vue `chat-liste` : chaque ligne qui se
 * redessine s'y note (`LigneConversation`), ChatView y pose ses déclencheurs, et le Profiler de la
 * liste le clôt (`noterRendu`). Les lignes notent pendant le RENDU : elles passent toutes avant la
 * clôture, que React appelle à la validation du rendu.
 */
export const VUE_LISTE = 'chat-liste'
type Passage = { a: number; lignes: number; rendus: number; declencheurs: DeclencheurDeListe[] }
let passeEnCours = { ids: new Set<string>(), rendus: 0, declencheurs: [] as DeclencheurDeListe[] }
const passagesDeListe: Passage[] = []
/** Assez pour couvrir le pire gel mesuré (12,9 s) et sa fenêtre ; borné en nombre quoi qu'il arrive. */
const GARDE_PASSAGES_MS = 60_000
const PASSAGES_MAX = 200

/** Une ligne de la liste se redessine (appelé dans le rendu de `LigneConversation`). */
export function noterLigneListe(id: string): void {
  passeEnCours.ids.add(id)
  passeEnCours.rendus += 1
}

/**
 * Les données de la liste qui ont changé depuis son dernier rendu VALIDÉ. ChatView les calcule
 * pendant son rendu : un second rendu sans validation (StrictMode) les recalcule à l'identique.
 */
export function noterDeclencheursListe(declencheurs: DeclencheurDeListe[]): void {
  passeEnCours.declencheurs = declencheurs
}

/**
 * Les données de la liste qui diffèrent (par identité) de son dernier rendu validé. Pure.
 * Aucun rendu validé = `montage` ; rien de changé = `hors-liste`.
 */
export function declencheursDeListe(
  avant: Partial<Record<DeclencheurDeListe, unknown>> | null,
  apres: Partial<Record<DeclencheurDeListe, unknown>>
): DeclencheurDeListe[] {
  if (!avant) return ['montage']
  const changes = (Object.keys(apres) as DeclencheurDeListe[]).filter(
    (nom) => !Object.is(avant[nom], apres[nom])
  )
  return changes.length > 0 ? changes : ['hors-liste']
}

function cloreRenduListe(maintenant: number): void {
  passagesDeListe.push({
    a: maintenant,
    lignes: passeEnCours.ids.size,
    rendus: passeEnCours.rendus,
    declencheurs: passeEnCours.declencheurs
  })
  passeEnCours = { ids: new Set(), rendus: 0, declencheurs: [] }
  while (
    passagesDeListe.length > PASSAGES_MAX ||
    (passagesDeListe.length > 0 && maintenant - passagesDeListe[0].a > GARDE_PASSAGES_MS)
  ) {
    passagesDeListe.shift()
  }
}

function enListeDeGel(passages: Passage[]): ListeDeGel | undefined {
  if (passages.length === 0) return undefined
  const frequence = new Map<DeclencheurDeListe, number>()
  for (const p of passages)
    for (const d of p.declencheurs) frequence.set(d, (frequence.get(d) ?? 0) + 1)
  return {
    lignes: passages.reduce((n, p) => n + p.lignes, 0),
    rendus: passages.reduce((n, p) => n + p.rendus, 0),
    passages: passages.length,
    declencheurs: [...frequence]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([d]) => d)
  }
}

/** Le dernier rendu clos de la liste — celui que le Profiler vient de mesurer. */
export function dernierPassageDeListe(): ListeDeGel | undefined {
  const dernier = passagesDeListe[passagesDeListe.length - 1]
  return dernier ? enListeDeGel([dernier]) : undefined
}

/**
 * LE DÉTAIL JOINT À UNE TÂCHE LONGUE (main.tsx) quand la vue qui la domine est la liste : tous ses
 * rendus pendant la tâche et la fenêtre récente qui la précède. La fenêtre part du DÉBUT de la tâche
 * (`dureeMs` avant) : un rendu de 12 s validé tôt serait sinon hors d'une fenêtre fixe de 2 s.
 * `undefined` pour toute autre vue — le gel s'écrit alors comme avant.
 */
export function detailDeGelPourVue(
  vue: string | undefined,
  dureeMs: number,
  maintenant: number = Date.now()
): DetailDeListe | undefined {
  if (vue !== VUE_LISTE) return undefined
  const depuis = maintenant - Math.max(0, dureeMs) - FENETRE_RECENTE_MS
  const liste = enListeDeGel(passagesDeListe.filter((p) => p.a >= depuis && p.a <= maintenant))
  return liste ? { liste } : undefined
}

/** Vide le registre — reserve aux tests, pour qu’une mesure ne fuite pas dans la suivante. */
export function oublierRendusRecents(): void {
  rendusRecents.length = 0
  rendusDeMessages.length = 0
  passagesDeListe.length = 0
  passeEnCours = { ids: new Set(), rendus: 0, declencheurs: [] }
}
