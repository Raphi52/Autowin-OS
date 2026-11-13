/**
 * ARRIVÉ SUR MAIN — le travail d'un tour est-il réellement dans la branche principale ?
 *
 * Une orchestration « en attente de publication » est verte mais pas encore fusionnée : le Board ne
 * peut la dire prouvée que si son travail est arrivé. La preuve vient de l'état de publication que
 * l'app écrit pour chaque run (`worktrees/<dépôt>/.runs/<run>.json`), relié au tour par son `turnId`
 * (le même que celui du message de réponse). Un run « complete » dont le SHA de l'agent est la base
 * n'a rien apporté : il ne prouve rien.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConversationPourLaCarte, MessageStockePourLaCarte } from './carte-des-besoins'
import { dossierDeLectureDuFil } from '../conversations/bascule-dossier-conversation'
import { depotPrincipalSurDisque } from '../git/depot-git'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import type { StatutDemande } from '../../shared/carte-des-besoins'
import { interruptionSansDefaut } from '../../shared/arret-par-stop'
import {
  attendSeulementSaPublication,
  type OrchestrationOutcome
} from '../../shared/orchestration-outcome'

/**
 * Vrai = le travail du tour est arrivé ; faux = un run existe mais rien n'est arrivé ; inconnu = aucune
 * trace de run. Sans trace, le fil seul peut répondre (`filApres`) : un commit de ce fil sur main, daté
 * après la demande. Faux = aucun commit de ce fil après la demande ; inconnu = journal de main illisible.
 */
export type ArriveeDuTour = ((conversationId: string, turnId: string) => boolean | undefined) & {
  filApres?: (conversationId: string, depuis: number) => boolean | undefined
  /** Le dossier dont le journal de main a été lu : `filApres` ne répond que pour les fils de ce dépôt. */
  depotDuJournal?: string
}

/** Les seuls champs d'un run qui disent s'il a publié quelque chose. */
export interface RunPourArrivee {
  conversationId: string
  turnId: string
  publication?: string
  publicationAgentSha?: string
  baseSha?: string
}

/** Une lecture par tour : si un tour a plusieurs runs, l'un publié suffit à dire que son travail est arrivé. */
export function arriveesDepuisLesRuns(runs: readonly RunPourArrivee[]): ArriveeDuTour {
  const parTour = new Map<string, boolean>()
  for (const run of runs) {
    const cle = `${run.conversationId}|${run.turnId}`
    const arrive =
      run.publication === 'complete' &&
      typeof run.publicationAgentSha === 'string' &&
      run.publicationAgentSha !== run.baseSha
    parTour.set(cle, (parTour.get(cle) ?? false) || arrive)
  }
  return (conversationId, turnId) => parTour.get(`${conversationId}|${turnId}`)
}

/** Le marqueur de fil de la convention de commit : `type(zone): phrase (conv-NNN)`. */
const MARQUEUR_DE_FIL = /\((conv-\d+)\)/g
// fix-ok: cause mesurée — trois demandes sans aucune trace de run (une arrivée, deux absentes) ne se
// distinguaient pas : le journal de main est le seul signal ; `git log main --grep=(conv-` donne un commit
// du fil arrivé après la demande pour l'un, et aucun pour les deux autres (mesuré sur le dépôt réel).

/**
 * Le journal de `main` dit si un commit d'un fil est arrivé après une demande. Le marqueur désigne le FIL,
 * pas le message : sans trace de run, ce signal range la demande en « prouvé », et son constat dit que le lien
 * passe par le fil, pas par le tour qui l'a produit.
 * Une ligne du journal : date ISO de l'auteur, tabulation, sujet (`git log --format=%aI%x09%s`).
 */
export function filApresDesCommits(
  journal: string | undefined
): (conversationId: string, depuis: number) => boolean | undefined {
  // Journal non lu : l'arrivée reste inconnue, jamais « rien n'est arrivé ».
  if (journal === undefined) return () => undefined
  const datesParFil = new Map<string, number[]>()
  for (const ligne of journal.split('\n')) {
    const tabulation = ligne.indexOf('\t')
    if (tabulation < 0) continue
    const quand = Date.parse(ligne.slice(0, tabulation))
    if (Number.isNaN(quand)) continue
    for (const match of ligne.slice(tabulation + 1).matchAll(MARQUEUR_DE_FIL)) {
      const fil = match[1]
      if (fil) datesParFil.set(fil, [...(datesParFil.get(fil) ?? []), quand])
    }
  }
  return (conversationId, depuis) =>
    (datesParFil.get(conversationId) ?? []).some((quand) => quand > depuis)
}

/**
 * Le journal de `main` du dépôt où vit `dossier`. Lecture seule ; une erreur git remonte, et la lecture
 * des arrivées la traite comme un journal inconnu.
 */
export function lireLogDeMain(dossier: string): string {
  return execFileSync(
    'git',
    ['log', 'main', '--format=%aI%x09%s', '--fixed-strings', '--grep=(conv-'],
    { cwd: dossier, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }
  )
}

/** Les runs de tous les dépôts du dossier `worktrees` (un sous-dossier `.runs` par dépôt). */
export function lireLesRunsPublies(racineWorktrees: string): RunPourArrivee[] {
  if (!existsSync(racineWorktrees)) return []
  const runs: RunPourArrivee[] = []
  for (const depot of readdirSync(racineWorktrees)) {
    const dossier = join(racineWorktrees, depot, '.runs')
    if (!existsSync(dossier)) continue
    for (const fichier of readdirSync(dossier)) {
      if (!fichier.endsWith('.json')) continue
      const run = lireUnRun(join(dossier, fichier))
      if (run) runs.push(run)
    }
  }
  return runs
}

function lireUnRun(chemin: string): RunPourArrivee | undefined {
  let brut: unknown
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'))
  } catch {
    // Fichier en cours d'écriture ou illisible : il ne prouve rien pour l'instant, il n'est pas compté.
    return undefined
  }
  if (typeof brut !== 'object' || brut === null) return undefined
  const r = brut as Record<string, unknown>
  if (typeof r.conversationId !== 'string' || typeof r.turnId !== 'string') return undefined
  return {
    conversationId: r.conversationId,
    turnId: r.turnId,
    ...(typeof r.publication === 'string' ? { publication: r.publication } : {}),
    ...(typeof r.publicationAgentSha === 'string'
      ? { publicationAgentSha: r.publicationAgentSha }
      : {}),
    ...(typeof r.baseSha === 'string' ? { baseSha: r.baseSha } : {})
  }
}

/**
 * Le Board relit les runs à chaque calcul : une lecture sert `ttlMs` (30 s). Une publication qui vient
 * d'arriver peut donc tarder de 30 s à se voir, ce qui est sans conséquence pour une carte.
 */
export function creerLectureDesArrivees(
  racineWorktrees: string,
  options: { maintenant?: () => number; ttlMs?: number; lireLog?: () => string } = {}
): () => ArriveeDuTour {
  const maintenant = options.maintenant ?? Date.now
  const ttlMs = options.ttlMs ?? 30_000
  let cache: { quand: number; arrivee: ArriveeDuTour } | undefined
  return () => {
    const quand = maintenant()
    if (cache && quand - cache.quand < ttlMs) return cache.arrivee
    let runs: RunPourArrivee[] = []
    try {
      runs = lireLesRunsPublies(racineWorktrees)
    } catch (erreur) {
      // Dossier verrouillé ou illisible : aucune arrivée n'est prouvée pour ce calcul, et ce n'est pas
      // une raison de casser la carte (même traitement que l'index des fiches).
      console.warn(
        '[board] runs illisibles pour les arrivées :',
        erreur instanceof Error ? erreur.message : erreur
      )
    }
    // Journal de main illisible (git absent, dépôt introuvable) : le fil ne répond pas, il reste inconnu.
    let journal: string | undefined
    try {
      journal = options.lireLog?.()
    } catch (erreur) {
      console.warn(
        '[board] journal de main illisible pour les arrivées :',
        erreur instanceof Error ? erreur.message : erreur
      )
    }
    const tours = arriveesDepuisLesRuns(runs)
    const filApres = filApresDesCommits(journal)
    cache = {
      quand,
      arrivee: Object.assign(
        (conversationId: string, turnId: string) => tours(conversationId, turnId),
        {
          filApres
        }
      )
    }
    return cache.arrivee
  }
}

/** Une action d'orchestration d'une réponse : seuls les champs qui servent à l'arrivée sont lus. */
interface ActionDuFil {
  kind?: unknown
  name?: unknown
  ok?: unknown
  data?: unknown
}

/** Les réponses de l'assistant qui suivent le message de rang `rang`, jusqu'au message suivant de l'utilisateur. */
function reponsesDuSegment(
  messages: readonly MessageStockePourLaCarte[],
  rang: number
): MessageStockePourLaCarte[] {
  const reponses: MessageStockePourLaCarte[] = []
  for (let i = rang + 1; i < messages.length && messages[i]?.role !== 'user'; i++) {
    const message = messages[i]
    if (message?.role === 'assistant') reponses.push(message)
  }
  return reponses
}

/**
 * Une orchestration coupée par la limite d'usage ou par un arrêt voulu. Même lecture que la carte du
 * fil (`interruptionDeLOrchestration`) : une orchestration bloquée par le contrôle final n'est pas coupée.
 */
function estCoupee(action: ActionDuFil): boolean {
  if (action.name !== 'orchestrate') return false
  if (typeof action.data === 'string')
    return action.ok === false && interruptionSansDefaut(action.data) !== undefined
  const data = action.data as { error?: unknown; gateBlocked?: unknown } | undefined
  if (!data || data.gateBlocked === true || typeof data.error !== 'string') return false
  return interruptionSansDefaut(data.error) !== undefined
}

function estEnAttenteDePublication(action: ActionDuFil): boolean {
  if (action.name !== 'orchestrate' || typeof action.data !== 'object' || action.data === null)
    return false
  return attendSeulementSaPublication(action.data as OrchestrationOutcome)
}

/**
 * Le journal de main lu est celui d'UN dépôt (`depotDuJournal`, le dépôt de l'app) : il ne juge que les
 * fils qui y travaillent. Pour un fil rangé dans un autre projet ou hors de tout dépôt, il ne contient
 * pas les commits du fil : y lire « aucun commit après la demande » le refusait à tort.
 * Le dossier du fil suit la règle de ses tours (`dossierDeLectureDuFil`) : sans dossier utilisable, il
 * travaille dans le dépôt de l'app. Sinon on compare les dépôts PRINCIPAUX, lus sur disque sans lancer
 * git (la carte se calcule dans le fil principal) : une copie de fil posée sous le dossier de l'app peut
 * appartenir à un autre dépôt, ce qu'une comparaison de chemins ne verrait pas.
 */
// fix-ok: cause mesurée — `filApres` lisait le journal de main du seul dépôt de l'app pour TOUT fil : sur le
// rejeu des 1636 fils du poste, la demande d'un fil rangé hors de tout dépôt sortait « refusé — pas encore
// arrivé sur main » d'après un commit de ce fil antérieur à la demande dans le dépôt de l'app (5 tests rouges).
function travailleDansLeDepotDuJournal(
  conversation: ConversationPourLaCarte,
  depotDuJournal: string | undefined
): boolean {
  const dossierRange = dossierDeLectureDuFil(conversation.projectPath, '')
  if (!dossierRange) return true
  if (!depotDuJournal) return false
  const depotDuFil = depotPrincipalSurDisque(dossierRange)
  const depot = depotPrincipalSurDisque(depotDuJournal)
  return depotDuFil !== undefined && depot !== undefined && memeCheminSurDisque(depotDuFil, depot)
}

/**
 * « L'état suit le travail réel », pour les demandes dont le travail est en attente de publication ou
 * a été coupé :
 *  - arrivé sur main → prouvé, quel que soit le constat du fil ;
 *  - en attente, et une trace de run dit que rien n'est arrivé → refusé, même si une vérification verte a suivi ;
 *  - en attente, sans trace de run : le fil répond. Aucun commit du fil après la demande → refusé ; un commit
 *    arrivé après la demande → prouvé, avec un constat qui dit que le lien passe par le fil, pas par le tour ;
 *    journal illisible → sans preuve ;
 *  - coupé et pas arrivé → l'état du fil reste (« sans preuve » : une limite d'usage ou un arrêt voulu n'est pas un refus).
 * Une absence de trace n'est jamais lue comme « pas arrivé » : elle ne suffit pas à refuser.
 */
// fix-ok: cause mesurée — « en attente de publication » sort en état 'ok' (action-outcome-summary.ts:134-138)
// et le fil la range en preuve ; sans lire l'arrivée, les demandes dont aucun commit du fil n'est arrivé sur
// main restaient prouvées (mesuré : 0 commit de fil après la demande pour deux demandes), et une demande dont
// le travail est arrivé après coup, sans trace de run, restait refusée sans preuve (mesuré : 1 cas).
export function arbitrerParLArrivee(
  conversation: ConversationPourLaCarte,
  rang: number,
  statut: StatutDemande,
  constat: string,
  debut: number | undefined,
  arrivee: ArriveeDuTour | undefined
): { statut: StatutDemande; constat: string } {
  if (!arrivee || (statut !== 'prouve' && statut !== 'refuse' && statut !== 'sans-preuve'))
    return { statut, constat }
  const reponses = reponsesDuSegment(conversation.messages, rang)
  const actions = reponses
    .flatMap((message) => (message.parts ?? []) as unknown as readonly ActionDuFil[])
    .filter((action) => action.kind === 'action')
  const enAttente = actions.some(estEnAttenteDePublication)
  const coupee = actions.some(estCoupee)
  if (!enAttente && !coupee) return { statut, constat }
  const tours = reponses
    .map((message) => message.turnId)
    .filter((turnId): turnId is string => typeof turnId === 'string')
  const verdicts = tours.map((turnId) => arrivee(conversation.id, turnId))
  if (verdicts.includes(true)) return { statut: 'prouve', constat: 'arrivé sur main' }
  if (!enAttente || statut !== 'prouve') return { statut, constat }
  const refuse: { statut: StatutDemande; constat: string } = {
    statut: 'refuse',
    constat: 'en attente de publication — pas encore arrivé sur main'
  }
  // Une trace de run qui dit « rien n'est arrivé » tranche : le fil ne la rachète pas.
  if (verdicts.includes(false)) return refuse
  // Aucune trace de run : seul le fil peut répondre, par un commit de ce fil sur main après la demande.
  // fix-ok: cause mesurée — la règle « travail arrivé sur main → prouvé » contredit « sans lien → sans preuve » :
  // sur le rejeu des données réelles, deux demandes en attente sans trace de run sortaient sans preuve alors
  // qu'un commit du fil était arrivé après elles. Le constat garde le niveau de lien réel.
  const arrive =
    debut === undefined || !travailleDansLeDepotDuJournal(conversation, arrivee.depotDuJournal)
      ? undefined
      : arrivee.filApres?.(conversation.id, debut)
  if (arrive === false) return refuse
  if (arrive === true)
    return {
      statut: 'prouve',
      constat: 'arrivé sur main — un commit du fil est arrivé après la demande (lien par le fil)'
    }
  return {
    statut: 'sans-preuve',
    constat: 'en attente de publication — arrivée sur main inconnue'
  }
}
