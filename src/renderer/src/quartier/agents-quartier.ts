/**
 * LES VRAIS AGENTS DU QUARTIER : un tanuki par fil, jamais une démonstration.
 *
 * Deux sources, et elles ne disent pas la même chose :
 *  - les RÉSUMÉS de fils (`os:conversations`) disent CE QUI EST : un tour tourne, une question attend,
 *    un tour a échoué. C'est la vérité au démarrage et après un trou, mais ils ne disent pas quel
 *    outil tourne ;
 *  - les ÉVÉNEMENTS du pilote (`pilot:event`) disent CE QUI SE PASSE : l'outil de l'instant. Ce sont
 *    eux qui envoient un tanuki à la bibliothèque ou à la machine.
 *
 * Les règles de présence sont celles de `grill/fond-accueil-atelier-des-agents.md` :
 *  - D-2 : un personnage par fil, même s'il lance un run ;
 *  - D-4 : un agent qui a fini sans rien demander reste 15 min au repos, puis part ;
 *  - D7 : une question reste en or et un échec en rouge jusqu'à l'ouverture du fil ;
 *  - D9 : si le fil repart, le même personnage retourne au travail ; ouvrir le fil le libère ;
 *  - D14 (revue le 2026-11-02) : une réflexion courte le laisse à son dernier poste ; une
 *    longue l'envoie en pause, une activité parmi plusieurs (voir `quartier-marche.ts`).
 *
 * Le module ne dépend ni de React ni de la scène : la partie décisive est faite de fonctions pures,
 * et la scène lit la liste à chaque image.
 */
import { metierDeLOutil, type Metier } from './quartier-metiers'
import { POSES_PLANTE, SURSAUT, type Consigne, type Pose } from './quartier-marche'
import type { AgentAPublier } from '../../../shared/quartier-presence'

export type PhaseAgent = 'travail' | 'reflexion' | 'attente' | 'plante' | 'fini'

export interface AgentQuartier {
  id: string
  titre: string
  phase: PhaseAgent
  metier: Metier | null
  /** Les actions encore ouvertes : tant qu'il y en a une, il travaille. */
  actions: readonly string[]
  /** Depuis quand il est dans cette phase. */
  depuis: number
  /** Son dernier événement : une lecture des résumés partie avant le début du tour ne le chasse pas. */
  vuLe?: number
  /** Fil marqué privé (D6) : son tanuki part dans le village commun sans titre. */
  prive?: boolean
}

/** La part d'un résumé de fil qui décide de la présence d'un agent. */
export interface ResumeFil {
  id: string
  title?: string
  updatedAt?: number
  hasStreamingTurn?: boolean
  lastAssistantAsksUser?: boolean
  lastAssistantStatus?: string
  /** Fil mis de côté par l'utilisateur : il n'a plus de personnage (voir `setInactive`). */
  inactive?: boolean
  /** Fil marqué privé (voir `setPrive`, D6) : son tanuki part au village sans titre. */
  prive?: boolean
}

export interface EvenementPilote {
  kind: string
  conversationId?: string
  actionId?: string
  name?: string
  args?: unknown
}

export const REPOS_MS = 15 * 60_000
/**
 * Les visages du bain et de l'échec : content les deux premières minutes après la fin, puis endormi pour
 * le reste de son repos (rien ne tourne plus pour lui) ; à l'échec, un sursaut de quelques secondes avant sa pose.
 */
export const JOIE_MS = 2 * 60_000
export const SURSAUT_MS = 6_000
/** Au-delà, une question ou un échec restés sans suite ne sont plus de l'actualité : ils encombreraient. */
export const SIGNAL_MAX_MS = 12 * 60 * 60_000
/**
 * Un agent ne part en pause qu'après ce temps sans action. Mesuré sur 400 tours : la moitié des
 * attentes entre deux outils dure moins de 9 s ; en dessous, il reste à son poste et continue son geste.
 */
export const PAUSE_APRES_MS = 10_000
/** Le pic mesuré sur ce poste : 15 personnages en même temps (`grill/agent-hq-japon-town.md`). */
export const AGENTS_MAX = 15
/** Le temps qu'un résumé peut avoir de retard sur le pilote : une lecture lancée juste avant le tour. */
export const RETARD_RESUMES_MS = 10_000

const ORDRE: Readonly<Record<PhaseAgent, number>> = {
  attente: 0,
  plante: 1,
  travail: 2,
  reflexion: 3,
  fini: 4
}

function nouveau(id: string, titre: string, phase: PhaseAgent, maintenant: number): AgentQuartier {
  return { id, titre, phase, metier: null, actions: [], depuis: maintenant }
}

const auTravail = (a: AgentQuartier | undefined): boolean =>
  a?.phase === 'travail' || a?.phase === 'reflexion'

/**
 * La marque « privé » suit le RÉSUMÉ, à chaque lecture : démarquer le fil doit la retirer, pas
 * seulement la poser (D6). Le titre ne vient que des résumés, qui portent la marque en
 * même temps : un agent né d'un événement du pilote n'a pas encore de titre à divulguer.
 */
function selonLaMarque(a: AgentQuartier, r: ResumeFil): AgentQuartier {
  const suite = { ...a }
  if (r.prive) suite.prive = true
  else delete suite.prive
  return suite
}

/**
 * Recale la carte des agents sur les résumés. Les fils sans tour en cours se décident ici : c'est la
 * seule source qui sait qu'une question est restée ouverte.
 *
 * `vus` : quand l'utilisateur a ouvert chaque fil. Un fil ouvert depuis sa dernière écriture ne garde
 * plus de personnage au repos ni de signal (D7, D9).
 */
export function appliquerResumes(
  carte: ReadonlyMap<string, AgentQuartier>,
  resumes: readonly ResumeFil[],
  maintenant: number,
  vus: ReadonlyMap<string, number> = new Map()
): Map<string, AgentQuartier> {
  const suivante = new Map<string, AgentQuartier>()
  for (const r of resumes) {
    if (r.inactive) continue
    const a = carte.get(r.id)
    const titre = r.title ?? a?.titre ?? ''
    const poser = (agent: AgentQuartier): void => {
      suivante.set(r.id, selonLaMarque(agent, r))
    }
    if (r.hasStreamingTurn) {
      poser(
        a && auTravail(a)
          ? { ...a, titre }
          : { ...nouveau(r.id, titre, 'reflexion', maintenant), metier: a?.metier ?? null }
      )
      continue
    }
    if (a && auTravail(a) && maintenant - (a.vuLe ?? 0) < RETARD_RESUMES_MS) {
      poser({ ...a, titre })
      continue
    }
    const ecrit = r.updatedAt ?? 0
    if (ecrit <= (vus.get(r.id) ?? 0)) continue
    const age = maintenant - ecrit
    const phase = phaseSansTour(r, age)
    if (!phase) continue
    // La phase date de l'écriture du fil, pas de sa lecture : un échec retrouvé au démarrage de l'app ne
    // fait pas sursauter, une fin vieille de dix minutes montre déjà le tanuki endormi.
    poser(
      a?.phase === phase
        ? { ...a, titre, actions: [] }
        : {
            ...nouveau(r.id, titre, phase, ecrit > 0 ? Math.min(ecrit, maintenant) : maintenant),
            metier: a?.metier ?? null
          }
    )
  }
  return suivante
}

function phaseSansTour(r: ResumeFil, age: number): PhaseAgent | null {
  if (r.lastAssistantAsksUser) return age < SIGNAL_MAX_MS ? 'attente' : null
  if (r.lastAssistantStatus === 'failed' || r.lastAssistantStatus === 'interrupted')
    return age < SIGNAL_MAX_MS ? 'plante' : null
  if (r.lastAssistantStatus === 'completed') return age < REPOS_MS ? 'fini' : null
  return null
}

/** Un événement du pilote : l'outil de l'instant, et la fin du tour avant que les résumés ne la disent. */
export function appliquerEvenement(
  carte: ReadonlyMap<string, AgentQuartier>,
  e: EvenementPilote,
  maintenant: number
): Map<string, AgentQuartier> {
  const suivante = new Map(carte)
  const id = e.conversationId
  if (!id) return suivante
  const a = carte.get(id)
  const base = { ...(a ?? nouveau(id, '', 'reflexion', maintenant)), vuLe: maintenant }
  if (e.kind === 'command' && e.name) {
    const metier = metierDeLOutil(e.name, e.args)
    if (!metier) {
      suivante.set(id, base)
      return suivante
    }
    const actions = e.actionId ? [...base.actions, e.actionId] : base.actions
    const phase = 'travail' as const
    suivante.set(id, {
      ...base,
      phase,
      metier,
      actions,
      depuis: base.phase === phase && base.metier === metier ? base.depuis : maintenant
    })
    return suivante
  }
  if (e.kind === 'result') {
    if (!a) return suivante
    const actions = a.actions.filter((x) => x !== e.actionId)
    suivante.set(
      id,
      actions.length > 0
        ? { ...base, actions }
        : {
            ...base,
            actions,
            phase: 'reflexion',
            depuis: a.phase === 'reflexion' ? a.depuis : maintenant
          }
    )
    return suivante
  }
  if (e.kind === 'error') {
    suivante.set(id, { ...base, phase: 'plante', actions: [], depuis: maintenant })
    return suivante
  }
  if (e.kind === 'done' || e.kind === 'cancellation') {
    // Les résumés diront si c'était une question : d'ici là, il a fini.
    suivante.set(id, { ...base, phase: 'fini', actions: [], depuis: maintenant })
    return suivante
  }
  // Le fil repart (delta, raisonnement) : le même personnage se relève (D9).
  suivante.set(
    id,
    auTravail(a) ? base : { ...base, phase: 'reflexion', actions: [], depuis: maintenant }
  )
  return suivante
}

/** Ce que la marche doit faire de ce tanuki à cet instant. */
/** FNV-1a sur 32 bits, comme agents-collegues.ts : le même identifiant donne toujours le même nombre. */
function empreinteId(texte: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Un agent planté pleure, fume ou boit (demande de l’utilisateur) : la pose est tirée de son
 * identifiant, donc il garde la même tant qu'il est planté, et plusieurs plantés varient.
 */
// fix-ok: 'pl' était figée dans consigneDe (grep : seul site de production) ; la pose dérive maintenant de l'id.
export function poseDePlantage(id: string): Pose {
  return POSES_PLANTE[empreinteId(id) % POSES_PLANTE.length]
}

export function consigneDe(a: AgentQuartier, maintenant: number): Consigne {
  switch (a.phase) {
    case 'travail':
      return { metier: a.metier, pose: '', partir: false }
    case 'reflexion':
      // Réfléchir longtemps, c'est une pause : méditer au dojo, boire le thé, ratisser… La marche choisit
      // laquelle (qui remplace la seule salle de méditation du 2026-11-01). Une pensée de
      // quelques secondes ne le fait pas traverser la scène.
      return maintenant - a.depuis > PAUSE_APRES_MS
        ? { metier: 'pause', pose: '', partir: false }
        : { metier: a.metier, pose: '', partir: false }
    case 'attente':
      return { metier: null, pose: 'at', partir: false }
    case 'plante':
      return {
        metier: null,
        pose: maintenant - a.depuis < SURSAUT_MS ? SURSAUT : poseDePlantage(a.id),
        partir: false
      }
    case 'fini':
      return { metier: 'bain', pose: maintenant - a.depuis < JOIE_MS ? 'ba' : 'bz', partir: false }
  }
}

/** Ceux qui ont une place sur scène : ce qui appelle l'utilisateur d'abord. */
export function agentsEnScene(carte: ReadonlyMap<string, AgentQuartier>): AgentQuartier[] {
  return [...carte.values()]
    .sort((a, b) => ORDRE[a.phase] - ORDRE[b.phase] || a.depuis - b.depuis)
    .slice(0, AGENTS_MAX)
}

/* ---------------------------------------------------------------- *
 * Le registre vivant : une seule abonnement, pour toute la session.
 * ---------------------------------------------------------------- */
interface ApiAgents {
  conversations?: () => Promise<ResumeFil[]>
  onPilotEvent?: (rappel: (e: EvenementPilote) => void) => () => void
  onAppEvent?: (rappel: (e: { type: string; scope?: string }) => void) => () => void
}

/** Les résumés se relisent au plus souvent toutes les 4 s : ils couvrent tous les fils du poste. */
const ECART_RELECTURE_MS = 4_000
const RELECTURE_MS = 20_000

let agents: ReadonlyMap<string, AgentQuartier> = new Map()
let instantane: readonly AgentQuartier[] = []
const vus = new Map<string, number>()
const abonnes = new Set<() => void>()
let demarre = false
let derniereLecture = 0
let lecturePrevue: ReturnType<typeof setTimeout> | null = null

function publier(carte: ReadonlyMap<string, AgentQuartier>): void {
  agents = carte
  instantane = agentsEnScene(carte)
  for (const abonne of abonnes) abonne()
  envoyerPresenceBientot()
}

const api = (): ApiAgents | undefined => (window as unknown as { api?: ApiAgents }).api

/** Un événement du pilote : c'est par ici qu'il entre dans le registre. */
export function recevoirEvenementPilote(e: EvenementPilote): void {
  const inconnu = Boolean(e.conversationId) && !agents.has(e.conversationId ?? '')
  publier(appliquerEvenement(agents, e, Date.now()))
  if (inconnu || e.kind === 'done' || e.kind === 'error' || e.kind === 'cancellation')
    relireBientot()
}

async function relire(): Promise<void> {
  const lire = api()?.conversations
  if (!lire) return
  derniereLecture = Date.now()
  try {
    publier(appliquerResumes(agents, await lire(), Date.now(), vus))
  } catch {
    // Une lecture ratée laisse la scène telle quelle : la prochaine la recalera.
  }
}

function relireBientot(): void {
  if (lecturePrevue !== null) return
  const attente = Math.max(0, derniereLecture + ECART_RELECTURE_MS - Date.now())
  lecturePrevue = setTimeout(() => {
    lecturePrevue = null
    void relire()
  }, attente)
}

/** Lance l'écoute, une fois : les tours continuent pendant qu'on est sur une autre vue. */
export function demarrerAgentsQuartier(): void {
  if (demarre || typeof window === 'undefined') return
  const a = api()
  if (!a?.onPilotEvent) return
  demarre = true
  a.onPilotEvent(recevoirEvenementPilote)
  a.onAppEvent?.((e) => {
    if (e.type === 'refresh' && e.scope === 'conversations') relireBientot()
  })
  window.addEventListener('autowin:open-conversation', (e) => {
    const id = (e as CustomEvent<unknown>).detail
    if (typeof id !== 'string') return
    vus.set(id, Date.now())
    const a2 = agents.get(id)
    if (a2 && !auTravail(a2)) {
      const suivante = new Map(agents)
      suivante.delete(id)
      publier(suivante)
    }
  })
  setInterval(() => {
    if (!document.hidden) void relire()
  }, RELECTURE_MS)
  void relire()
}

/* ---------------------------------------------------------------- *
 * La présence du poste dans le village commun.
 * ---------------------------------------------------------------- */

/** Les changements de 2 s sont regroupés : un tour envoie des dizaines d'événements par seconde. */
export const ENVOI_PRESENCE_MS = 2_000

/** Ce qui part au processus principal : brut, il le filtre avant toute écriture sur le partage. */
export function agentAPublier(a: AgentQuartier): AgentAPublier {
  return {
    id: a.id,
    titre: a.titre,
    phase: a.phase,
    metier: a.metier,
    depuis: a.depuis,
    ...(a.prive ? { prive: true } : {})
  }
}

let envoiPresencePrevu: ReturnType<typeof setTimeout> | null = null
let dernierEnvoiPresence = ''

/**
 * Envoie l'instantané de la scène au processus principal, au plus une fois par `ENVOI_PRESENCE_MS`,
 * et seulement s'il a changé : un morceau de texte ne change ni la phase ni le poste d'un tanuki.
 */
function envoyerPresenceBientot(): void {
  if (envoiPresencePrevu !== null) return
  envoiPresencePrevu = setTimeout(() => {
    envoiPresencePrevu = null
    if (typeof window === 'undefined') return
    const envoyer = (
      window as unknown as { api?: { quartierPresence?: (a: AgentAPublier[]) => Promise<void> } }
    ).api?.quartierPresence
    if (!envoyer) return
    const liste = instantane.map(agentAPublier)
    const corps = JSON.stringify(liste)
    if (corps === dernierEnvoiPresence) return
    dernierEnvoiPresence = corps
    envoyer(liste).catch(() => {
      // Le prochain changement renverra : la présence ne doit jamais gêner la scène.
      dernierEnvoiPresence = ''
    })
  }, ENVOI_PRESENCE_MS)
}

export function lireAgentsQuartier(): readonly AgentQuartier[] {
  return instantane
}

export function abonnerAgentsQuartier(rappel: () => void): () => void {
  abonnes.add(rappel)
  return () => abonnes.delete(rappel)
}
