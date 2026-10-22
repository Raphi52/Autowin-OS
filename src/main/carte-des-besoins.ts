/**
 * CARTE DES BESOINS — le calcul du lot 1 (conv-1089, 2026-10-22).
 *
 * Il tourne dans le processus PRINCIPAL parce que c'est là que vivent tous les fils (~20 Mo le
 * 2026-10-22, 940 conversations) : les envoyer à la vue pour qu'elle calcule aurait fait passer tout
 * l'historique par l'IPC à chaque ouverture. La vue ne reçoit que la projection.
 *
 * AUCUNE règle neuve : l'état d'une demande est celui de la carte du fil (`carteDuFil`), le projet
 * est celui de la barre latérale (`groupeDe`), le fil relu est celui que l'affichage relit
 * (`hydrateStoredAssistant`). La carte ne peut donc pas dire autre chose que le fil ouvert.
 *
 * Lot 2 : QUI A PROMPTÉ vient de `besoins.jsonl` (identité git relevée au tour) ; une demande plus
 * ancienne que le journal reçoit l'identité git ACTUELLE du dossier de son fil, marquée déduite.
 */
import { carteDuFil } from '../renderer/src/components/carte-du-fil'
import {
  hydrateStoredAssistant,
  type StoredAssistantMessage
} from '../renderer/src/components/chat-view-model'
import type { Msg } from '../renderer/src/components/chat-view-types'
import { groupeDe } from '../renderer/src/components/conversation-groups'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  DemandeurAuCompte,
  DemandeurDeLaCarte,
  NatureDuProjet,
  ProjetDeLaCarte,
  RunBloqueDeLaCarte,
  StatutDemande
} from '../shared/carte-des-besoins'
import { dossierDeTravailDuTour } from './bascule-dossier-conversation'
import { cleDuJournal, type EntreeDuJournal, type IdentiteGit } from './journal-des-besoins'

/** Le message tel qu'il est stocké — le strict nécessaire, pour rester testable sans le store. */
export type MessageStockePourLaCarte = Partial<StoredAssistantMessage> & {
  role: string
  content?: string
  messageId?: string
  orientation?: boolean
  ts?: number
}

export interface ConversationPourLaCarte {
  id: string
  title: string
  projectPath?: string
  categorie?: string
  autoKaizen?: unknown
  runPaths?: readonly string[]
  messages: readonly MessageStockePourLaCarte[]
}

export interface RunPourLaCarte {
  subject: string
  session: string
  path: string
  mtime: number
  summary: { status: string }
  blocked: boolean
  conversationId?: string
}

const MAX_CONSTAT = 160

function borner(texte: string, max: number): string {
  return texte.length > max ? `${texte.slice(0, max - 1)}…` : texte
}

/**
 * Le fil stocké relu comme l'affichage le relit. La coupe des réponses aux consignes écrites pendant
 * un tour (`couperAuxConsignes` de ChatView) est volontairement absente : une consigne n'est jamais
 * une étape de la carte, et les deux moitiés d'une réponse coupée tombent dans la MÊME étape.
 */
export function filPourLaCarte(messages: readonly MessageStockePourLaCarte[]): Msg[] {
  return messages.map((m): Msg => {
    if (m.role === 'user')
      return {
        role: 'user',
        content: m.content ?? '',
        ...(m.messageId ? { messageId: m.messageId } : {}),
        ...(typeof m.ts === 'number' ? { ts: m.ts } : {}),
        ...(m.orientation ? { orientation: true } : {})
      } as Msg
    return {
      ...hydrateStoredAssistant({ ...m, content: m.content ?? '' } as StoredAssistantMessage),
      ...(m.messageId ? { messageId: m.messageId } : {})
    }
  })
}

/** Les demandes RÉELLES d'un fil : ni le compactage, ni l'étape « à venir » proposée par l'agent. */
export function demandesDuFil(conversation: ConversationPourLaCarte): DemandeDeLaCarte[] {
  const { etapes } = carteDuFil({ fil: filPourLaCarte(conversation.messages) })
  const demandes: DemandeDeLaCarte[] = []
  for (const etape of etapes) {
    if (etape.rang === null || etape.compactage || etape.statut === 'a-venir') continue
    demandes.push({
      conversationId: conversation.id,
      conversationTitre: conversation.title,
      rang: etape.rang,
      ...(etape.messageId ? { messageId: etape.messageId } : {}),
      titre: etape.titre,
      statut: etape.statut,
      constat: borner(etape.constat, MAX_CONSTAT),
      ...(etape.debut === undefined ? {} : { debut: etape.debut })
    })
  }
  return demandes
}

function demandeurDe(
  identite: IdentiteGit,
  origine: DemandeurDeLaCarte['origine']
): DemandeurDeLaCarte {
  return {
    cle: (identite.email ?? identite.nom).toLowerCase(),
    nom: identite.nom,
    ...(identite.email ? { email: identite.email } : {}),
    origine
  }
}

/**
 * Le dossier où git est interrogé pour un fil : celui où ses tours TRAVAILLENT
 * (`dossierDeTravailDuTour`, le même que celui du journal), donc la même identité que ses commits.
 */
export function dossierGitDuFil(
  conversation: Pick<ConversationPourLaCarte, 'projectPath'>,
  dossierParDefaut: string | undefined,
  dossierExiste?: (chemin: string) => boolean
): string | undefined {
  const dossier = dossierDeTravailDuTour(
    conversation.projectPath,
    dossierParDefaut ?? '',
    dossierExiste
  )
  return dossier || undefined
}

/**
 * Pose sur une demande QUI a prompté et ce que l'agent a déclaré. Copie, jamais mutation : les
 * demandes viennent de la mémoire du calculateur, que le journal ne doit pas figer.
 */
export function enrichirDemande(
  demande: DemandeDeLaCarte,
  entree: EntreeDuJournal | undefined,
  identiteDeduite: IdentiteGit | null | undefined
): DemandeDeLaCarte {
  const demandeur = entree?.demandeur
    ? demandeurDe(entree.demandeur, 'journal')
    : identiteDeduite
      ? demandeurDe(identiteDeduite, 'git-du-dossier')
      : undefined
  if (!demandeur && !entree?.besoin) return demande
  return {
    ...demande,
    ...(demandeur ? { demandeur } : {}),
    ...(entree?.besoin ? { besoin: { ...entree.besoin } } : {})
  }
}

function comptesVides(): Record<StatutDemande, number> {
  return { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
}

/** La conversation d'un run : celle qu'il nomme, celle dont il porte l'id de session, ou celle qui l'a attaché. */
function conversationDuRun(
  run: RunPourLaCarte,
  parId: ReadonlyMap<string, ConversationPourLaCarte>,
  parChemin: ReadonlyMap<string, ConversationPourLaCarte>
): ConversationPourLaCarte | undefined {
  return (
    (run.conversationId ? parId.get(run.conversationId) : undefined) ??
    parId.get(run.session) ??
    parChemin.get(run.path)
  )
}

/**
 * Assemble la carte. `demandesParConversation` est fourni par l'appelant pour qu'il puisse garder en
 * cache les fils qui n'ont pas bougé (`demandesDuFil` est le seul calcul coûteux).
 */
export function assemblerLaCarte(entree: {
  conversations: readonly ConversationPourLaCarte[]
  demandesParConversation: ReadonlyMap<string, readonly DemandeDeLaCarte[]>
  runs: readonly RunPourLaCarte[]
  runsNonExamines?: number
  /** Le dépôt de la barre du haut : même repli que la barre latérale pour un fil sans dossier. */
  dossierParDefaut?: string
  /** `besoins.jsonl` relu (lot 2) ; absent = aucune demande journalisée. */
  journal?: ReadonlyMap<string, EntreeDuJournal>
  /** Identité git ACTUELLE par dossier (`dossierGitDuFil`), pour les demandes antérieures au journal. */
  identitesParDossier?: ReadonlyMap<string, IdentiteGit | null>
  calculeeA: number
  dureeMs: number
}): CarteDesBesoins {
  const projets = new Map<string, ProjetDeLaCarte>()
  const projetDe = (conversation: ConversationPourLaCarte | undefined): ProjetDeLaCarte => {
    const groupe = conversation
      ? groupeDe(conversation, entree.dossierParDefaut)
      : { key: 'divers', label: 'Divers', kind: 'divers' as const }
    const existant = projets.get(groupe.key)
    if (existant) return existant
    const neuf: ProjetDeLaCarte = {
      cle: groupe.key,
      libelle: groupe.label,
      nature: groupe.kind as NatureDuProjet,
      conversations: 0,
      demandes: [],
      runsBloques: [],
      comptes: comptesVides()
    }
    projets.set(groupe.key, neuf)
    return neuf
  }
  const activite = (projet: ProjetDeLaCarte, instant: number | undefined): void => {
    if (instant === undefined || !Number.isFinite(instant)) return
    if (projet.derniereActivite === undefined || instant > projet.derniereActivite)
      projet.derniereActivite = instant
  }

  const parId = new Map<string, ConversationPourLaCarte>()
  const parChemin = new Map<string, ConversationPourLaCarte>()
  for (const conversation of entree.conversations) {
    parId.set(conversation.id, conversation)
    for (const chemin of conversation.runPaths ?? []) parChemin.set(chemin, conversation)
  }

  const comptes = comptesVides()
  let total = 0
  let journalisees = 0
  const demandeurs = new Map<string, DemandeurAuCompte>()
  for (const conversation of entree.conversations) {
    const demandes = entree.demandesParConversation.get(conversation.id) ?? []
    // Un fil sans aucune demande (vide, ou fait seulement de consignes) n'ouvre pas de projet.
    if (demandes.length === 0) continue
    const projet = projetDe(conversation)
    projet.conversations += 1
    const dossierGit = dossierGitDuFil(conversation, entree.dossierParDefaut)
    const identiteDeduite = dossierGit ? entree.identitesParDossier?.get(dossierGit) : undefined
    for (const brute of demandes) {
      const journalisee = brute.messageId
        ? entree.journal?.get(cleDuJournal(conversation.id, brute.messageId))
        : undefined
      const demande = enrichirDemande(brute, journalisee, identiteDeduite)
      if (demande.demandeur?.origine === 'journal') journalisees += 1
      if (demande.demandeur) {
        const connu = demandeurs.get(demande.demandeur.cle)
        if (connu) connu.demandes += 1
        else
          demandeurs.set(demande.demandeur.cle, {
            cle: demande.demandeur.cle,
            nom: demande.demandeur.nom,
            ...(demande.demandeur.email ? { email: demande.demandeur.email } : {}),
            demandes: 1
          })
      }
      projet.demandes.push(demande)
      projet.comptes[demande.statut] += 1
      comptes[demande.statut] += 1
      total += 1
      activite(projet, demande.debut)
    }
  }

  let bloques = 0
  for (const run of entree.runs) {
    if (!run.blocked) continue
    const conversation = conversationDuRun(run, parId, parChemin)
    const projet = projetDe(conversation)
    const bloque: RunBloqueDeLaCarte = {
      sujet: run.subject,
      statut: run.summary.status,
      chemin: run.path,
      mtime: run.mtime,
      ...(conversation
        ? { conversationId: conversation.id, conversationTitre: conversation.title }
        : {})
    }
    projet.runsBloques.push(bloque)
    bloques += 1
    activite(projet, run.mtime)
  }

  const plusRecentDAbord = (a?: number, b?: number): number =>
    (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY)
  for (const projet of projets.values()) {
    // Tri STABLE : à date égale ou absente, l'ordre des fils (le plus récent d'abord) est gardé.
    projet.demandes.sort((a, b) => plusRecentDAbord(a.debut, b.debut))
    projet.runsBloques.sort((a, b) => plusRecentDAbord(a.mtime, b.mtime))
  }

  return {
    projets: [...projets.values()].sort((a, b) =>
      plusRecentDAbord(a.derniereActivite, b.derniereActivite)
    ),
    comptes,
    demandes: total,
    runsBloques: bloques,
    conversationsLues: entree.conversations.length,
    demandeurs: [...demandeurs.values()].sort((a, b) => b.demandes - a.demandes),
    demandesJournalisees: journalisees,
    ...(entree.runsNonExamines ? { runsNonExamines: entree.runsNonExamines } : {}),
    calculeeA: entree.calculeeA,
    dureeMs: entree.dureeMs
  }
}

/** `git config` lancés ensemble pour relever les identités des dossiers. */
const GITS_EN_PARALLELE = 6

/** Fils recalculés entre deux pauses rendues à la boucle d'événements du processus principal. */
const FILS_PAR_PAQUET = 20

/**
 * Le calcul AVEC sa mémoire. Mesuré le 2026-10-22 sur le poste : 921 fils, 4 795 demandes, 2,2 s à
 * froid dans un seul bloc — de quoi figer toute l'application, dont les tours de chat en cours.
 * D'où deux règles : un fil qui n'a pas bougé (même `updatedAt`, même nombre de messages) n'est pas
 * recalculé, et le calcul rend la main tous les `FILS_PAR_PAQUET` fils. Deux ouvertures simultanées
 * partagent le même calcul.
 */
export function creerCalculateurDeCarte(deps: {
  lireConversations: () => readonly (ConversationPourLaCarte & { updatedAt?: number })[]
  lireRuns: () => Promise<readonly RunPourLaCarte[] & { horsFenetre?: number }>
  dossierParDefaut?: () => string | undefined
  /** Lot 2 : `besoins.jsonl` relu, et l'identité git d'un dossier (avec sa propre mémoire). */
  lireJournal?: () => ReadonlyMap<string, EntreeDuJournal>
  identiteDuDossier?: (dossier: string) => Promise<IdentiteGit | null>
  calculerDemandes?: (conversation: ConversationPourLaCarte) => DemandeDeLaCarte[]
  ceder?: () => Promise<void>
  maintenant?: () => number
}): { calculer: () => Promise<CarteDesBesoins> } {
  const calculerDemandes = deps.calculerDemandes ?? demandesDuFil
  const ceder = deps.ceder ?? (() => new Promise<void>((resolve) => setImmediate(resolve)))
  const maintenant = deps.maintenant ?? Date.now
  const memoire = new Map<string, { empreinte: string; demandes: DemandeDeLaCarte[] }>()
  let enCours: Promise<CarteDesBesoins> | null = null

  /** Un `git config` par DOSSIER distinct (une trentaine), jamais par demande ; échec = inconnu. */
  async function identitesDesFils(
    conversations: readonly ConversationPourLaCarte[],
    demandesParConversation: ReadonlyMap<string, readonly DemandeDeLaCarte[]>,
    dossierParDefaut: string | undefined
  ): Promise<Map<string, IdentiteGit | null>> {
    const identites = new Map<string, IdentiteGit | null>()
    const identiteDuDossier = deps.identiteDuDossier
    if (!identiteDuDossier) return identites
    const dossiers = new Set<string>()
    for (const conversation of conversations) {
      if (!demandesParConversation.get(conversation.id)?.length) continue
      const dossier = dossierGitDuFil(conversation, dossierParDefaut)
      if (dossier) dossiers.add(dossier)
    }
    // Par paquets : une première ouverture ne lance pas soixante `git` d'un coup.
    const liste = [...dossiers]
    for (let debut = 0; debut < liste.length; debut += GITS_EN_PARALLELE)
      await Promise.all(
        liste.slice(debut, debut + GITS_EN_PARALLELE).map(async (dossier) => {
          identites.set(dossier, await identiteDuDossier(dossier).catch(() => null))
        })
      )
    return identites
  }

  async function calculer(): Promise<CarteDesBesoins> {
    const debut = maintenant()
    const conversations = deps.lireConversations()
    const vivantes = new Set<string>()
    const demandesParConversation = new Map<string, DemandeDeLaCarte[]>()
    let recalcules = 0
    for (const conversation of conversations) {
      vivantes.add(conversation.id)
      const empreinte = `${conversation.updatedAt ?? ''}:${conversation.messages.length}`
      const connue = memoire.get(conversation.id)
      if (connue?.empreinte === empreinte) {
        demandesParConversation.set(conversation.id, connue.demandes)
        continue
      }
      const demandes = calculerDemandes(conversation)
      memoire.set(conversation.id, { empreinte, demandes })
      demandesParConversation.set(conversation.id, demandes)
      recalcules += 1
      if (recalcules % FILS_PAR_PAQUET === 0) await ceder()
    }
    // Un fil supprimé ne doit pas rester en mémoire pour toujours.
    for (const id of memoire.keys()) if (!vivantes.has(id)) memoire.delete(id)
    const runs = await deps.lireRuns()
    const dossierParDefaut = deps.dossierParDefaut?.()
    const identitesParDossier = await identitesDesFils(
      conversations,
      demandesParConversation,
      dossierParDefaut
    )
    return assemblerLaCarte({
      conversations,
      demandesParConversation,
      runs,
      ...(runs.horsFenetre ? { runsNonExamines: runs.horsFenetre } : {}),
      ...(dossierParDefaut ? { dossierParDefaut } : {}),
      ...(deps.lireJournal ? { journal: deps.lireJournal() } : {}),
      identitesParDossier,
      calculeeA: maintenant(),
      dureeMs: maintenant() - debut
    })
  }

  return {
    calculer: () => {
      enCours ??= calculer().finally(() => {
        enCours = null
      })
      return enCours
    }
  }
}
