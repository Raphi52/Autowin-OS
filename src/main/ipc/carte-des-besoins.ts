/**
 * LE CANAL DE LA CARTE DES BESOINS (conv-1089, 2026-10-22) — lecture seule, aucun appel de modèle.
 *
 * La vue demande la carte ; le processus principal la calcule à partir des fils qu'il a déjà en
 * mémoire et des runs du scan borné de `get_state` (`runsWithGate`), puis ne renvoie que la
 * projection (~1,5 Mo mesurés pour 4 795 demandes), jamais l'historique.
 *
 * Lot 2 : il relit aussi `besoins.jsonl` (qui a prompté, ligne de besoin) et, pour les demandes
 * antérieures au journal, l'identité git actuelle du dossier de chaque fil.
 *
 * Work items (conv-1127, 2026-10-23) : trois canaux de plus, pour lier un prompt à une task.
 * `os:carte:lierWorkItem` et `os:carte:delierWorkItem` écrivent dans `liens-work-items.jsonl`, sur ce
 * poste ; `os:carte:verifierMentions` lit les fiches que des prompts nomment (`#1234`). Les trois ne
 * reçoivent du fournisseur de tickets que sa LECTURE (`get`) : aucune écriture chez lui n'est
 * possible d'ici. Le calcul de la carte, lui, ne lit que le fichier — jamais le réseau.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { creerCalculateurDeCarte, type ConversationPourLaCarte } from '../carte-des-besoins'
import { creerIdentitesEnCache, type EntreeDuJournal } from '../journal-des-besoins'
import {
  creerLiensWorkItems,
  detacher,
  etatVide,
  rattacherALaMain,
  verifierLesMentions,
  type EtatDesLiens
} from '../liens-work-items'
import type { BilanDesMentions, ResultatDuRattachement } from '../../shared/carte-des-besoins'
import type { TicketItem, TicketSourceProfile } from '../../shared/tickets'
import type { TicketGetRequest } from '../ticket-providers/provider-contract'
import type { AutowinOS } from '../os'

/** La lecture des fiches, et elle seule : le type n'offre aucune écriture chez le fournisseur. */
export interface LectureDesTickets {
  listSources: () => readonly TicketSourceProfile[]
  get: (request: TicketGetRequest) => Promise<TicketItem>
}

const BILAN_VIDE: BilanDesMentions = {
  lues: 0,
  liees: 0,
  introuvables: 0,
  injoignable: false,
  restantes: 0
}

/** La demande nommée par la vue existe-t-elle vraiment dans ce fil ? (id de message, ou `rang:N`) */
function demandeExiste(
  conversations: readonly ConversationPourLaCarte[],
  conversationId: unknown,
  demande: unknown
): boolean {
  if (typeof conversationId !== 'string' || typeof demande !== 'string') return false
  const fil = conversations.find((c) => c.id === conversationId)
  if (!fil) return false
  const rang = /^rang:(\d+)$/.exec(demande)
  if (rang) return fil.messages[Number(rang[1])]?.role === 'user'
  return fil.messages.some((m) => m.role === 'user' && m.messageId === demande)
}

const objet = (valeur: unknown): Record<string, unknown> =>
  valeur && typeof valeur === 'object' && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : {}

export function registerCarteDesBesoinsIpc({
  os,
  journal,
  racineDesLiens,
  tickets
}: {
  os: Pick<AutowinOS, 'conversations' | 'runsWithGate' | 'executionWorkspace'>
  journal?: { lire: () => ReadonlyMap<string, EntreeDuJournal> }
  /** Dossier de `liens-work-items.jsonl` (conv-1127) ; absent = aucun lien gardé. */
  racineDesLiens?: string
  tickets?: LectureDesTickets
}): void {
  const identiteDuDossier = creerIdentitesEnCache()
  const liens = racineDesLiens ? creerLiensWorkItems({ racine: racineDesLiens }) : null
  // Le type du store et celui de la carte décrivent le même JSON ; seul le typage des parts diffère.
  const lireConversations = (): readonly (ConversationPourLaCarte & { updatedAt?: number })[] =>
    os.conversations.list() as unknown as readonly (ConversationPourLaCarte & {
      updatedAt?: number
    })[]
  const lireLiens = (): EtatDesLiens => {
    try {
      return liens ? liens.lire() : etatVide()
    } catch (erreur) {
      // Un fichier de liens illisible prive la carte de ses tasks, pas de la carte.
      console.warn('[besoins] liens des work items illisibles :', erreur)
      return etatVide()
    }
  }
  const calculateur = creerCalculateurDeCarte({
    lireConversations,
    lireRuns: () => os.runsWithGate(),
    dossierParDefaut: () => os.executionWorkspace,
    ...(journal
      ? {
          lireJournal: () => {
            try {
              return journal.lire()
            } catch (erreur) {
              // Un journal illisible prive la carte des demandeurs relevés, pas de la carte.
              console.warn('[besoins] journal illisible :', erreur)
              return new Map<string, EntreeDuJournal>()
            }
          }
        }
      : {}),
    lireLiens,
    identiteDuDossier
  })
  const lecture = tickets
    ? {
        sources: () => tickets.listSources(),
        lireFiche: (source: TicketSourceProfile, id: string) => tickets.get({ source, id })
      }
    : null

  ipcMain.handle('os:carteDesBesoins', (event) => {
    assertTrustedRendererSender(event, 'CarteDesBesoins')
    return calculateur.calculer()
  })

  ipcMain.handle(
    'os:carte:lierWorkItem',
    async (event, brute: unknown): Promise<ResultatDuRattachement> => {
      assertTrustedRendererSender(event, 'CarteDesBesoins')
      const cible = objet(brute)
      if (!liens || !lecture)
        return {
          ok: false,
          raison: 'Rattachement indisponible : la source de tickets n’est pas câblée.'
        }
      if (!demandeExiste(lireConversations(), cible.conversationId, cible.demande))
        return { ok: false, raison: 'Cette demande n’existe plus dans son fil.' }
      return rattacherALaMain(
        { ...lecture, etat: lireLiens(), ajouter: liens.ajouter },
        {
          conversationId: cible.conversationId,
          demande: cible.demande,
          saisie: cible.saisie,
          sourceId: cible.sourceId
        }
      )
    }
  )

  ipcMain.handle('os:carte:delierWorkItem', (event, brute: unknown) => {
    assertTrustedRendererSender(event, 'CarteDesBesoins')
    const cible = objet(brute)
    if (!liens) return { ok: false, raison: 'Liens indisponibles sur ce poste.' }
    if (!demandeExiste(lireConversations(), cible.conversationId, cible.demande))
      return { ok: false, raison: 'Cette demande n’existe plus dans son fil.' }
    return detacher(
      { ajouter: liens.ajouter },
      {
        conversationId: cible.conversationId,
        demande: cible.demande,
        sourceId: cible.sourceId,
        id: cible.id
      }
    )
  })

  // Aucun argument : les numéros à lire viennent des fils, jamais de la vue.
  ipcMain.handle('os:carte:verifierMentions', async (event): Promise<BilanDesMentions> => {
    assertTrustedRendererSender(event, 'CarteDesBesoins')
    if (!liens || !lecture) return BILAN_VIDE
    const carte = await calculateur.calculer()
    return verifierLesMentions(
      { ...lecture, etat: lireLiens(), ajouter: liens.ajouter },
      carte.projets.flatMap((p) => p.demandes)
    )
  })
}
