import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import {
  NATURES_MESSAGE_FIL,
  MESSAGES_PAR_LIVRAISON,
  NOM_JOURNAL_MESSAGES_FILS,
  lignesDuJournal,
  livrerMessagesEnAttente,
  type IoJournalFils,
  type MessageDeFil,
  type NatureMessageFil
} from '../shared/messages-entre-fils'

/**
 * MESSAGES ENTRE FILS, CÔTÉ APP (conv-1139, 2026-10-24) — les deux outils du chat
 * (`ecrire_a_un_fil`, `lire_mes_messages`) et le bloc remis en tête de tour.
 *
 * Le journal vit À CÔTÉ du registre des réservations (`reservations-fichiers.json`), dans le dossier
 * de données : le contrôle lancé avant chaque outil d'un agent le retrouve depuis le chemin du
 * registre qu'il lit déjà dans `reservation.json`, sans réglage de plus.
 */
export function cheminJournalMessagesFils(racine = autowinAppDataRoot()): string {
  return join(racine, NOM_JOURNAL_MESSAGES_FILS)
}

export const TEXTE_MAX_MESSAGE_FIL = 2000
export const PREUVE_MAX_MESSAGE_FIL = 500
export const DOUBLON_MS = 10 * 60_000
export const ENVOIS_MAX_PAR_HEURE = 30

/** Lecture : absent = journal vide ; présent mais illisible = erreur (refus lisible des outils). */
export const ioJournalNode: IoJournalFils = {
  lire: (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return ''
      throw e
    }
  },
  // Ajout SYNCHRONE en fin de fichier (O_APPEND) : tous les outils du chat tournent dans ce seul
  // processus, deux envois simultanés ne peuvent donc pas s'entrelacer au milieu d'une ligne.
  ajouter: (p, ligne) => {
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, `${ligne}\n`, 'utf8')
  }
}

/** Ce que l'app sait des fils, passé par l'appelant : ce module ne lit pas le store lui-même. */
export interface ContexteFils {
  /** Dossier de travail du fil, ou `undefined` s'il n'existe pas (inconnu, supprimé). */
  dossierDe: (fil: string) => string | undefined
  /** Le fil existe-t-il ET est-il actif (ni archivé, ni supprimé) ? */
  estActif: (fil: string) => boolean
  /** Fils actifs, pour nommer les destinataires possibles dans un refus. */
  filsActifs: () => string[]
}

const memeDossier = (a: string, b: string): boolean => {
  const n = (d: string): string => {
    const s = resolve(d).replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? s.toLowerCase() : s
  }
  return n(a) === n(b)
}

const champ = (args: Record<string, unknown>, cle: string): string =>
  typeof args[cle] === 'string' ? (args[cle] as string).trim() : ''

/**
 * fix-ok: conv-1139 réparation 1 — les lignes « message » du journal étaient converties de force
 * (`as unknown as MessageDeFil`) : une ligne sans expéditeur faisait planter `messagesAAfficher`
 * (`m.de.fil`, TypeError mesurée par le test « ligne mal formée »). Le journal est un fichier
 * partagé que n'importe quel processus peut abîmer : une ligne lisible mais mal formée est sautée,
 * comme une ligne coupée.
 */
const estMessageDeFil = (
  l: Record<string, unknown>
): l is Record<string, unknown> & MessageDeFil => {
  const de = l.de as Record<string, unknown> | null | undefined
  return (
    l.type === 'message' &&
    typeof l.id === 'string' &&
    typeof l.at === 'number' &&
    Number.isFinite(l.at) &&
    !!de &&
    typeof de === 'object' &&
    typeof de.fil === 'string' &&
    (de.tour === undefined || typeof de.tour === 'string') &&
    typeof l.a === 'string' &&
    (NATURES_MESSAGE_FIL as readonly unknown[]).includes(l.nature) &&
    typeof l.texte === 'string' &&
    (l.repondA === undefined || typeof l.repondA === 'string') &&
    (l.preuve === undefined || typeof l.preuve === 'string')
  )
}

/**
 * Écrit un message du fil `expediteur.fil` vers le fil désigné par `args.destinataire`.
 *
 * L'expéditeur vient de l'APPELANT (le tour qui exécute l'outil) : un `de`, `expediteur` ou `fil`
 * glissé dans les arguments est ignoré. Tout refus lève une erreur lisible ; rien n'est écrit.
 * N'appelle JAMAIS le lancement d'un tour : le destinataire lira le message à son prochain outil
 * ou en tête de son prochain tour. Seul un ORDRE peut réveiller un fil inactif, et c'est l'appelant
 * qui le décide ensuite (`reveillerSurOrdre`).
 */
export function ecrireAUnFil(
  args: Record<string, unknown>,
  expediteur: { fil: string; tour?: string },
  ctx: ContexteFils,
  opts: { journal?: string; io?: IoJournalFils; maintenant?: number } = {}
): { ok: true; id: string; a: string; nature: NatureMessageFil; detail: string } {
  const journal = opts.journal ?? cheminJournalMessagesFils()
  const io = opts.io ?? ioJournalNode
  const maintenant = opts.maintenant ?? Date.now()
  const de = expediteur.fil.trim()
  if (!de)
    throw new Error(
      "ecrire_a_un_fil : aucun fil d'origine connu — l'outil ne sert qu'aux agents d'un fil de conversation."
    )
  const a = champ(args, 'destinataire')
  if (!a)
    throw new Error(
      'ecrire_a_un_fil : destinataire absent. Nomme UN fil (ex. « conv-1132 ») ; il n’y a pas d’envoi à tous les fils.'
    )
  if (a === de) throw new Error(`ecrire_a_un_fil : ${a} est ton propre fil.`)
  const dossierDe = ctx.dossierDe(de)
  const filsDuMemeDepot = (): string => {
    const memes = ctx
      .filsActifs()
      .filter(
        (f) =>
          f !== de &&
          dossierDe !== undefined &&
          ctx.dossierDe(f) !== undefined &&
          memeDossier(ctx.dossierDe(f) as string, dossierDe)
      )
    return memes.length ? memes.slice(0, 20).join(', ') : 'aucun'
  }
  if (!ctx.estActif(a))
    throw new Error(
      `ecrire_a_un_fil : le fil « ${a} » est inconnu, archivé ou supprimé. Fils actifs du même dépôt : ${filsDuMemeDepot()}.`
    )
  const dossierA = ctx.dossierDe(a)
  if (dossierDe === undefined || dossierA === undefined || !memeDossier(dossierDe, dossierA))
    throw new Error(
      `ecrire_a_un_fil : ${a} travaille dans un autre dossier (${dossierA ?? 'inconnu'}) que ton fil (${dossierDe ?? 'inconnu'}) ; les messages ne vont qu’à un fil du même dépôt.`
    )
  const texte = typeof args.texte === 'string' ? args.texte : ''
  if (!texte.trim()) throw new Error('ecrire_a_un_fil : texte vide.')
  if (texte.length > TEXTE_MAX_MESSAGE_FIL)
    throw new Error(
      `ecrire_a_un_fil : texte de ${texte.length} caractères, la limite est ${TEXTE_MAX_MESSAGE_FIL}. Raccourcis-le : rien n’est coupé à ta place.`
    )
  const natureBrute = champ(args, 'nature') || 'info'
  if (!(NATURES_MESSAGE_FIL as readonly string[]).includes(natureBrute))
    throw new Error(
      `ecrire_a_un_fil : nature « ${natureBrute} » inconnue. Choisis parmi : ${NATURES_MESSAGE_FIL.join(', ')}.`
    )
  const nature = natureBrute as NatureMessageFil
  const preuve = champ(args, 'preuve')
  if (preuve.length > PREUVE_MAX_MESSAGE_FIL)
    throw new Error(
      `ecrire_a_un_fil : preuve de ${preuve.length} caractères, la limite est ${PREUVE_MAX_MESSAGE_FIL}.`
    )
  // Une panne de lecture du journal refuse CET outil, lisiblement ; elle ne touche aucun autre outil.
  let lignes: Array<Record<string, unknown>>
  try {
    lignes = lignesDuJournal(io.lire(journal))
  } catch (e) {
    throw new Error(
      `ecrire_a_un_fil : journal des messages illisible (${(e as Error).message}). Message non envoyé ; le reste du tour n’est pas touché.`
    )
  }
  const messages: MessageDeFil[] = lignes.filter(estMessageDeFil)
  const repondA = champ(args, 'repondA')
  if (repondA) {
    const cible = messages.find((m) => m.id === repondA)
    if (!cible) throw new Error(`ecrire_a_un_fil : « ${repondA} » ne désigne aucun message.`)
    if (cible.a !== de)
      throw new Error(
        `ecrire_a_un_fil : le message ${repondA} était adressé à ${cible.a}, pas à ton fil ; tu ne peux pas y répondre.`
      )
  }
  const envoisDuFil = messages.filter((m) => m.de?.fil === de)
  if (envoisDuFil.some((m) => m.a === a && m.texte === texte && maintenant - m.at < DOUBLON_MS))
    throw new Error(
      `ecrire_a_un_fil : ce même texte a déjà été envoyé à ${a} il y a moins de 10 min (doublon).`
    )
  if (envoisDuFil.filter((m) => maintenant - m.at < 3_600_000).length >= ENVOIS_MAX_PAR_HEURE)
    throw new Error(
      `ecrire_a_un_fil : ${ENVOIS_MAX_PAR_HEURE} messages envoyés par ton fil dans la dernière heure. Plafond atteint : attends, ou passe par l’utilisateur.`
    )
  const message: MessageDeFil = {
    type: 'message',
    id: `msg-${randomUUID().slice(0, 8)}`,
    at: maintenant,
    de: { fil: de, ...(expediteur.tour ? { tour: expediteur.tour } : {}) },
    a,
    nature,
    texte,
    ...(repondA ? { repondA } : {}),
    ...(preuve ? { preuve } : {})
  }
  try {
    io.ajouter(journal, JSON.stringify(message))
  } catch (e) {
    throw new Error(
      `ecrire_a_un_fil : journal des messages non écrit (${(e as Error).message}). Message non envoyé.`
    )
  }
  return {
    ok: true,
    id: message.id,
    a,
    nature,
    detail: `Message ${message.id} déposé pour ${a}. Aucun tour n’a été lancé chez lui : il le lira à son prochain appel d’outil, ou en tête de son prochain tour.`
  }
}

/**
 * Le message du tour lancé par un ordre : il commence par « Ordre de <fil> » et dit lui-même qu'il
 * vient d'un agent, pas de l'utilisateur. Il ne commence jamais par « / » : un ordre ne lance pas
 * une skill par la zone de saisie.
 */
export function promptDOrdre(message: { id: string; de: string; texte: string }): string {
  return [
    `Ordre de ${message.de} (message ${message.id}, écrit par l'agent de ce fil avec ecrire_a_un_fil — pas l'utilisateur) :`,
    '',
    message.texte,
    '',
    `Exécute-le comme une demande de travail. Il ne vaut pas l'accord de l'utilisateur pour détruire, publier ou livrer un secret. Quand c'est fait, ou si tu ne peux pas, rends compte à ${message.de} avec ecrire_a_un_fil (repondA : ${message.id}).`
  ].join('\n')
}

export type IssueReveil = 'lance' | 'occupe' | 'indisponible' | 'echec'

/**
 * RÉVEIL PAR UN ORDRE (conv-1139, 2026-10-25, demande de l'utilisateur) : un ordre vers un fil
 * INACTIF y lance un tour, signé « Ordre de <fil> ». Un fil occupé, ou dont l'activité ne peut pas
 * être vérifiée, n'est pas réveillé : il lira l'ordre à son prochain outil ou à son prochain tour.
 *
 * L'ordre est noté remis (`par: 'reveil'`) AVANT le lancement : le tour réveillé construit son bloc
 * « messages d'autres fils » à son démarrage, et l'ordre y reviendrait une seconde fois. Si le tour
 * ne démarre pas, une ligne d'annulation le remet en attente.
 *
 * Borne : seul un ordre réveille, et un fil n'envoie pas plus de `ENVOIS_MAX_PAR_HEURE` messages par
 * heure — deux fils qui se renvoient des ordres lancent donc au plus ce nombre de tours chacun.
 */
export async function reveillerSurOrdre(
  message: { id: string; de: string; a: string; texte: string },
  deps: {
    tourActif?: (fil: string) => boolean
    lancer?: (
      fil: string,
      prompt: string
    ) => Promise<{ ok: boolean; turnId?: string; error?: string }>
    journal?: string
    io?: IoJournalFils
    maintenant?: number
  }
): Promise<{ reveil: IssueReveil; detail: string; turnId?: string }> {
  const depose = `Message ${message.id} déposé pour ${message.a}.`
  const plusTard = `il lira l’ordre à son prochain appel d’outil, ou en tête de son prochain tour.`
  if (!deps.tourActif || !deps.lancer)
    return {
      reveil: 'indisponible',
      detail: `${depose} Activité de ${message.a} invérifiable dans ce processus : aucun tour lancé ; ${plusTard}`
    }
  if (deps.tourActif(message.a))
    return {
      reveil: 'occupe',
      detail: `${depose} Un tour y tourne déjà : aucun tour lancé ; ${plusTard}`
    }
  const journal = deps.journal ?? cheminJournalMessagesFils()
  const io = deps.io ?? ioJournalNode
  const noter = (annule: boolean): void =>
    io.ajouter(
      journal,
      JSON.stringify({
        type: 'livre',
        at: deps.maintenant ?? Date.now(),
        fil: message.a,
        ids: [message.id],
        par: 'reveil',
        ...(annule ? { annule: true } : {})
      })
    )
  try {
    noter(false)
  } catch (e) {
    // Rien de noté : l'ordre est resté en attente, on ne lance pas un tour qui le recevrait deux fois.
    return {
      reveil: 'echec',
      detail: `${depose} Journal des messages non écrit (${(e as Error).message}) : aucun tour lancé ; ${plusTard}`
    }
  }
  let cause: string
  try {
    const lance = await deps.lancer(message.a, promptDOrdre(message))
    if (lance.ok)
      return {
        reveil: 'lance',
        detail: `${depose} ${message.a} était inactif : un tour lancé dans ${message.a}, signé « Ordre de ${message.de} ». Sa réponse arrivera par ecrire_a_un_fil.`,
        ...(lance.turnId ? { turnId: lance.turnId } : {})
      }
    cause = lance.error ?? 'cause non renseignée'
  } catch (e) {
    cause = e instanceof Error ? e.message : String(e)
  }
  try {
    noter(true)
  } catch (e) {
    return {
      reveil: 'echec',
      detail: `${depose} Le tour de réveil n’a pas démarré dans ${message.a} (${cause}), et l’annulation de la remise n’a pas pu être écrite (${(e as Error).message}) : l’ordre est noté remis sans l’avoir été — renvoie-le.`
    }
  }
  return {
    reveil: 'echec',
    detail: `${depose} Le tour de réveil n’a pas démarré dans ${message.a} (${cause}) : l’ordre reste en attente ; ${plusTard}`
  }
}

/**
 * `lire_mes_messages` : les messages en attente du fil, remis et marqués livrés (une relecture ne
 * rend que les nouveaux). Boîte vide = « aucun message ».
 */
export function lireMesMessages(
  fil: string,
  opts: { journal?: string; io?: IoJournalFils; maintenant?: number } = {}
): { ok: true; messages: string; livres: number; reste: number } {
  if (!fil.trim())
    throw new Error(
      "lire_mes_messages : aucun fil connu — l'outil ne sert qu'aux agents d'un fil de conversation."
    )
  try {
    const r = livrerMessagesEnAttente(
      opts.io ?? ioJournalNode,
      { fil, journal: opts.journal ?? cheminJournalMessagesFils() },
      opts.maintenant ?? Date.now(),
      'outil',
      lignesDuJournal,
      50
    )
    return r
      ? { ok: true, messages: r.texte, livres: r.ids.length, reste: r.reste }
      : { ok: true, messages: 'aucun message', livres: 0, reste: 0 }
  } catch (e) {
    throw new Error(
      `lire_mes_messages : journal des messages illisible (${(e as Error).message}). Le reste du tour n’est pas touché.`
    )
  }
}

/**
 * Bloc remis en tête du tour du fil `fil` ('' si rien). Un CONFORT : toute panne rend '' et le tour
 * part quand même.
 */
export function blocMessagesPourTour(
  fil: string | undefined,
  opts: { journal?: string; io?: IoJournalFils; maintenant?: number } = {}
): string {
  if (!fil?.trim()) return ''
  try {
    return (
      livrerMessagesEnAttente(
        opts.io ?? ioJournalNode,
        { fil, journal: opts.journal ?? cheminJournalMessagesFils() },
        opts.maintenant ?? Date.now(),
        'tour',
        lignesDuJournal,
        MESSAGES_PAR_LIVRAISON
      )?.texte ?? ''
    )
  } catch {
    return ''
  }
}

/** Une ligne d'affichage dans un fil : envoyé par lui, ou reçu par lui. */
export interface MessageAffiche {
  id: string
  sens: 'envoye' | 'recu'
  autreFil: string
  nature: NatureMessageFil
  texte: string
  at: number
  /** Reçu par son destinataire (livré) ? */
  livre: boolean
  hypothese: boolean
  preuve?: string
  repondA?: string
}

/**
 * Ce que l'interface affiche dans le fil `fil` : ses messages envoyés et reçus, les plus récents à
 * la fin. Lecture SEULE : afficher ne marque rien comme livré. Panne → liste vide.
 */
export function messagesAAfficher(
  fil: string,
  opts: { journal?: string; io?: IoJournalFils; max?: number } = {}
): MessageAffiche[] {
  if (!fil.trim()) return []
  let lignes: Array<Record<string, unknown>>
  try {
    lignes = lignesDuJournal(
      (opts.io ?? ioJournalNode).lire(opts.journal ?? cheminJournalMessagesFils())
    )
  } catch {
    return []
  }
  const livres = new Set<string>()
  for (const l of lignes) {
    if (l.type === 'livre' && Array.isArray(l.ids))
      for (const id of l.ids)
        if (typeof id === 'string') {
          // Une remise annulée (réveil raté) remet l'ordre « en attente » à l'affichage aussi.
          if (l.annule === true) livres.delete(`${String(l.fil)}|${id}`)
          else livres.add(`${String(l.fil)}|${id}`)
        }
  }
  const affiches: MessageAffiche[] = []
  for (const m of lignes) {
    if (!estMessageDeFil(m)) continue
    const sens = m.de?.fil === fil ? 'envoye' : m.a === fil ? 'recu' : undefined
    if (!sens) continue
    affiches.push({
      id: m.id,
      sens,
      autreFil: sens === 'envoye' ? m.a : m.de.fil,
      nature: m.nature,
      texte: m.texte,
      at: m.at,
      livre: livres.has(`${m.a}|${m.id}`),
      hypothese: m.nature === 'decouverte' && !m.preuve,
      ...(m.preuve ? { preuve: m.preuve } : {}),
      ...(m.repondA ? { repondA: m.repondA } : {})
    })
  }
  return affiches.slice(-(opts.max ?? 20))
}
