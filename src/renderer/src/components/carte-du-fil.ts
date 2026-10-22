/**
 * CARTE DU FIL (conv-1059, 2026-10-22) — le socle PUR de la ligne de métro qui REMPLACE le carnet.
 *
 * Pourquoi : le carnet (conv-1038) recopiait les rubriques de la dernière clôture, déjà affichée en
 * bas du fil. La carte montre ce que le défilement ne montre pas : le CHEMIN entier du fil, une
 * étape par demande, et ce que chacune a PROUVÉ.
 *
 * La couleur suit la PREUVE, jamais l'impression : vert seulement si une vérification (`verify`) ou
 * une orchestration a passé ; un tour fini sans aucune vérification reste « sans preuve »
 * (auto-déclaré). Les issues sont lues par `verifyOutcomeSummary`/`orchestrateOutcomeSummary`, les
 * mêmes que les pastilles du fil : la carte ne peut pas dire autre chose que le message.
 *
 * Rien n'est inventé : les données sont celles que relisait déjà le carnet (`carnet-du-fil.ts` :
 * compactage, question ouverte ; `chat-auto-mode.ts` : rubriques de clôture, lecture des demandes ;
 * traces de fichiers du fil).
 */
import type { Msg, AsstMsg } from './chat-view-types'
import { lectureDeLaDemande, lignesDeRubrique } from './chat-auto-mode'
import {
  orchestrateOutcomeSummary,
  verifyOutcomeSummary,
  type OutcomeSummary
} from './action-outcome-summary'
import { compactageDuFil, questionOuverte } from './carnet-du-fil'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'

export type StatutEtape = 'prouve' | 'refuse' | 'en-cours' | 'sans-preuve' | 'a-venir'

export const LIBELLES_STATUT: Record<StatutEtape, string> = {
  prouve: 'prouvé',
  refuse: 'refusé',
  'en-cours': 'en cours',
  'sans-preuve': 'sans preuve',
  'a-venir': 'à venir'
}

export interface EtapeCarte {
  /** Stable d'un rendu à l'autre (rang du message), `a-venir` pour l'étape proposée. */
  cle: string
  /** Rang du message de l'utilisateur dans le fil ENTIER ; `null` pour l'étape à venir. */
  rang: number | null
  /** Le message où le clic ramène : la demande, ou la réponse qui propose l'étape à venir. */
  cible: number
  messageId?: string
  titre: string
  statut: StatutEtape
  /** Le constat qui justifie la couleur : « npm test → exit 0 », « tour arrêté avant la fin »… */
  constat: string
  debut?: number
  /** Somme des coûts CONNUS (reçus en direct) ; absent si aucun n'est connu. */
  coutUsd?: number
  fichiers: string[]
  compactage: boolean
  /** Avant le dernier compactage : l'agent ne relit plus cette étape. */
  horsMemoire: boolean
  /** Quelque chose s'y est passé après ton dernier passage. */
  nouvelle: boolean
  /** Le fil attend ta réponse à une question à choix posée dans cette étape. */
  question: boolean
}

export interface Carte {
  etapes: EtapeCarte[]
  /** Clé de la dernière étape partie avant ton passage — seulement s'il y a du neuf depuis. */
  tuEtaisLa: string | null
  prouvees: number
  /** Étapes réelles, hors étape à venir. */
  total: number
}

const MAX_TITRE = 120

function nettoyer(ligne: string): string {
  const nue = ligne
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*(?:[-*•–—]|\d+[.)])\s+/u, '')
    .replace(/^\s*#{1,6}\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return nue.length > MAX_TITRE ? `${nue.slice(0, MAX_TITRE - 1)}…` : nue
}

function premiereLigne(texte: string): string {
  return nettoyer(texte.split(/\r?\n/u).find((ligne) => ligne.trim() !== '') ?? '')
}

function texteDe(message: AsstMsg): string {
  return (message.parts ?? [])
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('\n')
}

function estFini(message: AsstMsg): boolean {
  return message.status !== 'streaming' && message.done !== false
}

function instantDe(message: Msg): number | undefined {
  const brut = message as { ts?: unknown; debutDuTour?: unknown }
  const instant = message.role === 'assistant' ? (brut.debutDuTour ?? brut.ts) : brut.ts
  return typeof instant === 'number' && Number.isFinite(instant) ? instant : undefined
}

function estCompactage(message: Msg): boolean {
  const contenu = (message as { content?: unknown }).content
  return (
    message.role === 'user' && typeof contenu === 'string' && contenu.trim() === COMPACT_REQUEST
  )
}

/** La première ligne de « Recommandé » de la dernière réponse FINIE avant `rang`. */
function recommandeAvant(fil: readonly Msg[], rang: number): string | null {
  for (let i = rang - 1; i >= 0; i -= 1) {
    const message = fil[i]
    if (message.role !== 'assistant' || !estFini(message as AsstMsg)) continue
    const ligne = lignesDeRubrique(texteDe(message as AsstMsg), 'Recommandé', 'exacte')
      .map(nettoyer)
      .find((texte) => texte !== '' && texte !== '---')
    return ligne ?? null
  }
  return null
}

/**
 * La DERNIÈRE issue de chaque vérification DISTINCTE (une commande `verify` = une clé, toutes les
 * orchestrations = une clé). Une même commande rouge puis verte est la boucle normale : verte. Deux
 * commandes différentes ne se rachètent pas l'une l'autre (conv-76 : `typecheck exit 1` puis
 * `npm test exit 0` ne prouvent PAS l'étape).
 */
function issuesDuSegment(reponses: readonly AsstMsg[]): OutcomeSummary[] {
  const issues = new Map<string, OutcomeSummary>()
  for (const reponse of reponses)
    for (const part of reponse.parts ?? []) {
      if (part.kind !== 'action') continue
      const issue = verifyOutcomeSummary(part) ?? orchestrateOutcomeSummary(part)
      // `refused` : rien n'a été vérifié (vérification impossible, run réutilisé) — ni preuve ni échec.
      if (!issue || issue.state === 'refused') continue
      const commande = (part.data as { command?: unknown } | undefined)?.command
      const cle = part.name === 'verify' ? `verify:${String(commande ?? '')}` : part.name
      issues.delete(cle)
      issues.set(cle, issue)
    }
  return [...issues.values()]
}

const BLOCAGE_DECLARE = /^.*(?:⛔\s*Bloqué|⚠️\s*Non résolu).*$/mu

function statutDuSegment(
  reponses: readonly AsstMsg[],
  auBoutDuFil: boolean
): { statut: StatutEtape; constat: string } {
  if (reponses.some((reponse) => !estFini(reponse)))
    return { statut: 'en-cours', constat: 'l’agent travaille' }
  const derniere = reponses.at(-1)
  if (!derniere)
    return auBoutDuFil
      ? { statut: 'en-cours', constat: 'en attente de la réponse' }
      : { statut: 'sans-preuve', constat: 'aucune réponse' }
  if (derniere.status === 'failed' || derniere.error)
    return {
      statut: 'refuse',
      constat: derniere.error ? `tour en échec : ${nettoyer(derniere.error)}` : 'tour en échec'
    }
  if (derniere.status === 'cancelled' || derniere.status === 'interrupted')
    return { statut: 'refuse', constat: 'tour arrêté avant la fin' }
  const issues = issuesDuSegment(reponses)
  const echec = issues.find((issue) => issue.state === 'failed')
  if (echec) return { statut: 'refuse', constat: echec.label }
  const blocage = BLOCAGE_DECLARE.exec(texteDe(derniere))?.[0]
  if (blocage) return { statut: 'refuse', constat: nettoyer(blocage) }
  const preuve = issues.at(-1)
  if (preuve) return { statut: 'prouve', constat: preuve.label }
  return { statut: 'sans-preuve', constat: 'fini sans vérification' }
}

export function carteDuFil(entree: {
  fil: readonly Msg[]
  /** Repère « non lu » lu AVANT d'ouvrir le fil (`conversation-seen.ts`) ; absent = fil déjà vu. */
  vueA?: number
  traces?: readonly { timestamp: string; paths: readonly string[] }[]
}): Carte {
  const { fil, vueA } = entree
  const rangs: number[] = []
  for (let rang = 0; rang < fil.length; rang += 1) {
    const message = fil[rang]
    if (message.role !== 'user' || (message as { orientation?: boolean }).orientation) continue
    if (estCompactage(message) || lectureDeLaDemande(fil, rang)) rangs.push(rang)
  }

  const compactage = compactageDuFil(fil)
  const coupure = compactage?.etat === 'fait' ? compactage.laisses : -1
  const ouverte = questionOuverte(fil) !== null

  const etapes: EtapeCarte[] = rangs.map((rang, k) => {
    const fin = rangs[k + 1] ?? fil.length
    const segment = fil.slice(rang + 1, fin)
    const reponses = segment.filter((m): m is AsstMsg => m.role === 'assistant') as AsstMsg[]
    const auBoutDuFil = k === rangs.length - 1
    const message = fil[rang]
    const lecture = lectureDeLaDemande(fil, rang)
    const titre = estCompactage(message)
      ? 'Compactage du fil'
      : lecture?.genre === 'accord'
        ? (() => {
            const suite = recommandeAvant(fil, rang)
            return suite ? `Suite : ${suite}` : 'Suite acceptée'
          })()
        : premiereLigne(lecture?.texte ?? '')
    const lu = statutDuSegment(reponses, auBoutDuFil)
    const statut = lu.statut
    let constat = lu.constat
    if (estCompactage(message) && statut === 'sans-preuve') constat = 'l’agent repart de ce résumé'
    const question = auBoutDuFil && ouverte
    if (question && statut !== 'refuse') constat = 'une question t’attend'
    const instants = [message, ...segment]
      .map(instantDe)
      .filter((instant): instant is number => instant !== undefined)
    const couts = reponses
      .map((reponse) => reponse.coutUsd)
      .filter((cout): cout is number => typeof cout === 'number' && Number.isFinite(cout))
    return {
      cle: `etape:${rang}`,
      rang,
      cible: rang,
      ...(message.messageId ? { messageId: message.messageId } : {}),
      titre: titre || 'Demande',
      statut,
      constat,
      ...(instants.length > 0 ? { debut: instants[0] } : {}),
      ...(couts.length > 0
        ? { coutUsd: Math.round(couts.reduce((a, b) => a + b, 0) * 10_000) / 10_000 }
        : {}),
      fichiers: [],
      compactage: estCompactage(message),
      horsMemoire: rang < coupure,
      nouvelle: vueA !== undefined && instants.some((instant) => instant > vueA),
      question
    }
  })

  // Chaque fichier rejoint la dernière étape partie avant son écriture.
  for (const trace of entree.traces ?? []) {
    const instant = Date.parse(trace.timestamp)
    if (!Number.isFinite(instant)) continue
    const etape = etapes.filter((e) => e.debut !== undefined && e.debut <= instant).at(-1)
    if (!etape) continue
    for (const chemin of trace.paths)
      if (!etape.fichiers.includes(chemin)) etape.fichiers.push(chemin)
  }

  const derniere = etapes.at(-1)
  const dernierMessage = fil.at(-1)
  if (
    derniere &&
    derniere.statut !== 'en-cours' &&
    !derniere.question &&
    dernierMessage?.role === 'assistant'
  ) {
    const suite = recommandeAvant(fil, fil.length)
    if (suite && !/aucune suite/iu.test(suite))
      etapes.push({
        cle: 'a-venir',
        rang: null,
        cible: fil.length - 1,
        titre: suite,
        statut: 'a-venir',
        constat: 'proposé par l’agent — rien n’est lancé',
        fichiers: [],
        compactage: false,
        horsMemoire: false,
        nouvelle: false,
        question: false
      })
  }

  const reelles = etapes.filter((etape) => etape.statut !== 'a-venir')
  const vues = reelles.filter((etape) => etape.debut !== undefined && etape.debut <= (vueA ?? -1))
  const tuEtaisLa =
    vueA !== undefined && reelles.some((etape) => etape.nouvelle)
      ? (vues.at(-1)?.cle ?? null)
      : null

  return {
    etapes,
    tuEtaisLa,
    prouvees: reelles.filter((etape) => etape.statut === 'prouve').length,
    total: reelles.length
  }
}
